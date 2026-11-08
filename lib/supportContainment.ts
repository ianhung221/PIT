import type { CarSnapshot, GeneratedRoad, RadioFeedback } from "../types/game.ts";
import { SUSPECT, VEHICLES } from "./gameConfig.ts";
import { normalizeAngle } from "./gameRules.ts";
import { closestRoadSegment } from "./proceduralMap.ts";
import {locateRoad,locationSegment} from './roadLocation.ts';
import {boxesOverlap,carBox,drivingFootprintOnRoad,nearbyDrivingObjects,observeDriving} from './drivingObservation.ts';
import {networkIndex} from './roadNetwork.ts';
import {parkingRecoveryClear,parkingRecoveryControl} from './parkingRecovery.ts';
import type {DrivingCar} from './drivingObservation.ts';
import {localCorridorClear} from './localDriving.ts';

type Point = { x: number; z: number };
export interface BlockadeState {
  phase: "waiting" | "approaching" | "holding" | "missed";
  elapsed: number;
  slowFor: number;
  fastFor: number;
  reason: string;
  anchor: (Point & { yaw: number; index: number; side: number; front: number; rear: number }) | null;
  stages: [number, number];
  settled: [number, number];
  blockedFor: [number, number];
  frontUnit:0|1;
  available:[boolean,boolean];
  playerCovered:[boolean,boolean];
  parkingWait?:number;
  parkingAttempts?:number;
  parkingRecovery?:{phase:'shift'|'align';sideSign:number;elapsed:number;checkIn:number;clear:boolean};
  shoulderRecovery?:{x:number;z:number;elapsed:number};
  shoulderAttempts?:number;
}
export const makeBlockade = (): BlockadeState => ({ phase: "waiting", elapsed: 0, slowFor: 0, fastFor: 0, reason: "", anchor: null, stages: [0, 0], settled: [0, 0], blockedFor: [0, 0],frontUnit:0,available:[true,true],playerCovered:[false,false] });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const planar = (car: CarSnapshot) => Math.hypot(car.speed, car.lateralSpeed);
export function blockadeLocal(origin: Point & { yaw: number }, point: Point) {
  const dx = point.x - origin.x, dz = point.z - origin.z;
  return { side: dx * Math.cos(origin.yaw) - dz * Math.sin(origin.yaw), forward: -dx * Math.sin(origin.yaw) - dz * Math.cos(origin.yaw) };
}
function pointAt(origin: Point & { yaw: number }, side: number, forward: number): Point {
  return { x: origin.x + Math.cos(origin.yaw) * side - Math.sin(origin.yaw) * forward, z: origin.z - Math.sin(origin.yaw) * side - Math.cos(origin.yaw) * forward };
}
function extent(yaw: number, length: number, width: number) {
  return { side: Math.abs(Math.sin(yaw)) * length / 2 + Math.abs(Math.cos(yaw)) * width / 2,
    forward: Math.abs(Math.cos(yaw)) * length / 2 + Math.abs(Math.sin(yaw)) * width / 2 };
}
function playerCoverage(suspect:CarSnapshot,player:CarSnapshot,yaw:number):[boolean,boolean]{
  const p=blockadeLocal({...suspect,yaw},player),box=carBox(player);
  const minimum=extent(player.yaw-yaw,box.halfZ*2,box.halfX*2).forward+extent(suspect.yaw-yaw,SUSPECT.length,SUSPECT.width).forward;
  const aligned=Math.abs(Math.sin(player.yaw-yaw))<.25&&Math.abs(p.side)<.8&&planar(player)<.65;
  return [aligned&&p.forward-minimum>=0&&p.forward-minimum<1.5,aligned&&-p.forward-minimum>=0&&-p.forward-minimum<1.5];
}

// One geometric standard for radio arrival and mission victory, regardless of Q4.
export function containmentPose(unit: 0 | 1, car: CarSnapshot, suspect: CarSnapshot, roadYaw: number,front=unit===0) {
  const local = blockadeLocal({ ...suspect, yaw: roadYaw }, car);
  const dimensions = unit === 0 ? VEHICLES.patrol : VEHICLES.suv;
  const minimumGap = extent(suspect.yaw - roadYaw, SUSPECT.length, SUSPECT.width).forward
    + extent(car.yaw - roadYaw, dimensions.length, dimensions.width).forward;
  const gap = (front ? local.forward : -local.forward) - minimumGap;
  return gap >= .12 && gap <= 1.25 && Math.abs(local.side) < .8
    && Math.abs(normalizeAngle(roadYaw - car.yaw)) < .25 && planar(car) < .65 && planar(suspect) < 1.2;
}
function inRoad(road: GeneratedRoad, point: Point, yaw: number, index: number, unit: number) {
  if(road.network){
    const box=carBox({...point,yaw,speed:0,lateralSpeed:0,model:unit===0?'patrol':'suv'},.35);
    const location=locateRoad(road.network,{...point,yaw}),edge=networkIndex(road.network).edges.get(location.edge)!;
    const paved=drivingFootprintOnRoad(road.network,box);
    // This map already has solid flat ground beside the paving. Local parking
    // may use its narrow shoulder; physical objects remain authoritative.
    const shoulder=location.deviation+Math.max(box.halfX,box.halfZ)<edge.width/2+3;
    return (paved||shoulder)&&!nearbyDrivingObjects(road.network,point,8).some(o=>boxesOverlap(box,o));
  }
  const i = closestRoadSegment(road, point.x, point.z, index), segment = road.segments[i];
  const dimensions = unit === 0 ? VEHICLES.patrol : VEHICLES.suv;
  const half = extent(yaw - segment.yaw, dimensions.length, dimensions.width).side;
  const local = blockadeLocal(segment, point);
  return Math.abs(local.side) + half + .35 < Math.min(segment.startWidth ?? segment.width, segment.endWidth ?? segment.width) / 2;
}

/** Select once per attempt. A rotating suspect cannot flip the chosen passing side. */
export function planBlockade(road: GeneratedRoad, index: number, suspect: CarSnapshot, supports: CarSnapshot[], player: CarSnapshot,frontUnit:0|1=0,yawOverride?:number) {
  const yaw = yawOverride??(road.network?locationSegment(road.network,locateRoad(road.network,suspect)).yaw:road.segments[index].yaw);
  const targetExtent = extent(suspect.yaw - yaw, SUSPECT.length, SUSPECT.width);
  const origin = { x: suspect.x, z: suspect.z, yaw, index };
  const covered=playerCoverage(suspect,player,yaw);
  const frontModel=frontUnit===0?VEHICLES.patrol:VEHICLES.suv,rearModel=frontUnit===0?VEHICLES.suv:VEHICLES.patrol;
  const front = targetExtent.forward + frontModel.length / 2 + .8;
  const rear = targetExtent.forward + rearModel.length / 2 + .8;
  const passing = targetExtent.side + frontModel.width / 2 + 1.1;
  const currentSide = blockadeLocal(origin, supports[frontUnit]).side;
  const alreadyAhead=blockadeLocal(origin,supports[frontUnit]).forward>front+2;
  const sides = [passing, -passing].sort((a, b) => Math.abs(a - currentSide) - Math.abs(b - currentSide));
  for (const side of sides) {
    let clear = true;
    for (let forward = -10; !covered[0]&&!alreadyAhead&&forward <= 14; forward += 2) {
      const p = pointAt(origin, side, forward);
      if (!inRoad(road, p, yaw, index, frontUnit)) { clear = false; break; }
      const relative = blockadeLocal({ ...p, yaw }, player);
      if (Math.abs(relative.side) < 2.7 && Math.abs(relative.forward) < 5) { clear = false; break; }
    }
    if (clear && (covered[0]||inRoad(road, pointAt(origin, 0, front), yaw, index, frontUnit)) && (covered[1]||inRoad(road, pointAt(origin, 0, -rear), yaw, index, 1-frontUnit))) {
      return { ...origin, side, front, rear };
    }
  }
  return null;
}

export function missBlockade(state: BlockadeState, reason: string) {
  state.phase = "missed"; state.elapsed = 0; state.slowFor = 0; state.fastFor = 0;
  state.anchor = null; state.settled = [0, 0]; state.reason = reason;
}
/** A nearby unit should hold position during a brief replan around a slow
 * target, instead of following a road loop away from the incident. */
export function waitForBlockadeRetry(state:BlockadeState,car:CarSnapshot,suspect:CarSnapshot){
  return state.phase==='missed'&&planar(suspect)<4.2&&Math.hypot(car.x-suspect.x,car.z-suspect.z)<55;
}
export function stepBlockade(state: BlockadeState, input: { road: GeneratedRoad; index: number; suspect: CarSnapshot; supports: CarSnapshot[]; player: CarSnapshot; dt: number;available?:[boolean,boolean] }) {
  const { suspect, supports, dt } = input;
  state.elapsed += dt;
  const speed = planar(suspect);
  const stable=!suspect.pose||suspect.pose.groundedWheels>=3&&suspect.pose.angularSpeed<.65&&Math.abs(suspect.lateralSpeed)<1.5;
  state.slowFor = speed < 4.2&&stable ? state.slowFor + dt : 0;
  const availability=input.available??[true,true];
  if(state.available.some((a,i)=>a!==availability[i])&&state.anchor)missBlockade(state,'單位車況改變，重新分工');
  state.available=[...availability];
  state.fastFor = speed > 7 ? state.fastFor + dt : 0;
  if (state.phase === "missed") {
    if (state.elapsed <= 3) return;
    if (speed >= 4.2) { Object.assign(state, makeBlockade()); return; }
  }
  if (state.phase === "waiting" || state.phase === "missed") {
    if (state.slowFor < .35) return;
    if(!availability.some(Boolean)){missBlockade(state,'沒有可用後援');return;}
    if (supports.some((car,i) => availability[i]&&Math.hypot(car.x - suspect.x, car.z - suspect.z) > 65)) {
      missBlockade(state, "後援距離過遠"); return;
    }
    let anchor = planBlockade(input.road, input.index, suspect, supports, input.player);
    state.frontUnit=0;
    if(input.road.network){
      const roadYaw=locationSegment(input.road.network,locateRoad(input.road.network,suspect)).yaw;
      let cost=Infinity;anchor=null;
      for(const frontUnit of [0,1] as const)for(const yaw of [roadYaw,roadYaw+Math.PI]){
        const covered=playerCoverage(suspect,input.player,yaw);
        if(!availability[frontUnit]&&!covered[0])continue;
        const candidate=planBlockade(input.road,input.index,suspect,supports,input.player,frontUnit,yaw);if(!candidate)continue;
        let score=availability[1-frontUnit]||covered[1]?0:1000;
        for(let unit=0;unit<2;unit++)if(availability[unit]&&!covered[unit===frontUnit?0:1]){
          const car=supports[unit],local=blockadeLocal(candidate,car),target=unit===frontUnit?candidate.front:-candidate.rear;
          score+=Math.hypot(local.side,local.forward-target)+Math.abs(normalizeAngle(car.yaw-yaw))*8;
          if(unit===frontUnit&&local.forward<candidate.front)score+=12;
        }
        if(score<cost){cost=score;anchor=candidate;state.frontUnit=frontUnit;}
      }
    }
    if (!anchor) { missBlockade(state, "沒有安全進場通道"); return; }
    state.anchor = anchor; state.phase = "approaching"; state.elapsed = 0;
    state.playerCovered=playerCoverage(suspect,input.player,anchor.yaw);
    const frontPosition = blockadeLocal(anchor, supports[state.frontUnit]);
    state.stages = [0,0];state.stages[state.frontUnit]=frontPosition.forward > anchor.front + 2 ? 2 : frontPosition.forward > -6 && Math.abs(frontPosition.side - anchor.side) < 1 ? 1 : 0;
    state.settled = [0, 0]; state.blockedFor = [0, 0];state.parkingWait=0;state.parkingAttempts=0;state.parkingRecovery=undefined;state.shoulderRecovery=undefined;state.shoulderAttempts=0;
    return;
  }
  if (!state.anchor) return;
  const covered=playerCoverage(suspect,input.player,state.anchor.yaw);
  if(covered.some((c,i)=>c!==state.playerCovered[i])){missBlockade(state,'玩家守位改變，重新分工');return;}
  if (state.fastFor > .65 || Math.hypot(suspect.x - state.anchor.x, suspect.z - state.anchor.z) > 7) {
    missBlockade(state, "嫌犯已離開封鎖位置"); return;
  }
  // A slow target may drift after the anchor was chosen. Revalidate the
  // parking geometry against its current body instead of aiming at stale slots.
  if(stable&&speed<1.2&&Math.hypot(suspect.x-state.anchor.x,suspect.z-state.anchor.z)>.75){
    if(state.stages[state.frontUnit]<2){missBlockade(state,'嫌犯位置改變，重新檢查進場通道');return;}
    const refreshed=planBlockade(input.road,input.index,suspect,supports,input.player,state.frontUnit,state.anchor.yaw);
    if(!refreshed){missBlockade(state,'嫌犯位置改變，沒有安全進場通道');return;}
    state.anchor=refreshed;state.settled=[0,0];
  }
  if (state.blockedFor.some(t => t > 5) || (state.phase === "approaching" && state.elapsed > 35+(state.parkingAttempts?15:0)+(state.shoulderAttempts?10:0))) {
    missBlockade(state, "進場受阻或未能及時就位"); return;
  }
  const held = state.settled.every((t,i) => !availability[i]||state.playerCovered[i===state.frontUnit?0:1]||t > .8);
  if (held && state.phase !== "holding") { state.phase = "holding"; state.elapsed = 0; }
  if (!held && state.phase === "holding" && state.elapsed > .6) { state.phase = "approaching"; state.elapsed = 0; }
}

/** Low-speed local manoeuvre; ordinary road pursuit and wall recovery remain separate. */
export function blockadeControl(state: BlockadeState, unit: 0 | 1, car: CarSnapshot, suspect: CarSnapshot, neighbors: CarSnapshot[], road: GeneratedRoad, dt: number, grip: number) {
  const a = state.anchor;
  if (!a || !state.available[unit] || (state.phase !== "approaching" && state.phase !== "holding")) return null;
  const frontUnit=state.frontUnit,front=unit===frontUnit;
  if(state.playerCovered[front?0:1])return {speed:0,yawError:0,arrived:false,modeChanged:false};
  const local = blockadeLocal(a, car);
  const model=unit===0?'patrol':'suv';
  const network=road.network,drivingCar={...car,model} as DrivingCar;
  if(front&&state.stages[unit]===2&&network&&!state.shoulderRecovery&&!state.shoulderAttempts&&state.blockedFor[unit]>1&&planar(car)<.5&&!drivingFootprintOnRoad(network,carBox(drivingCar,.2))){
    const observation=observeDriving(network,drivingCar,neighbors as DrivingCar[],0);
    const input={network,car:drivingCar,observation,dt,grip,speed:2,yawError:0};
    state.shoulderAttempts=1;
    if(localCorridorClear(input,0,4,true))state.shoulderRecovery={x:car.x,z:car.z,elapsed:0};
  }
  if(front&&state.shoulderRecovery&&network){
    const recovery=state.shoulderRecovery;recovery.elapsed+=dt;
    const observation=observeDriving(network,drivingCar,neighbors as DrivingCar[],recovery.elapsed);
    const input={network,car:drivingCar,observation,dt,grip,speed:2,yawError:0};
    if(Math.hypot(car.x-recovery.x,car.z-recovery.z)>=3.5||recovery.elapsed>10||!localCorridorClear(input,0,2,true)){
      state.shoulderRecovery=undefined;state.blockedFor[unit]=0;return {speed:0,yawError:0,arrived:false,modeChanged:false};
    }
    state.settled[unit]=0;state.blockedFor[unit]=0;
    return {speed:-1.5*Math.sqrt(grip),yawError:0,arrived:false,modeChanged:false};
  }
  if(front&&state.stages[unit]===3&&!state.parkingRecovery&&(state.parkingAttempts??0)<5){
    const yawError=Math.abs(normalizeAngle(car.yaw-a.yaw));
    const stalled=(Math.abs(local.side)>1.2||yawError>.25)&&Math.abs(local.side)<5.5&&Math.abs(local.forward-a.front)<1.3&&planar(car)<.7;
    state.parkingWait=stalled?(state.parkingWait??0)+dt:0;
    if((state.parkingWait??0)>1.2){
      state.parkingWait=0;state.parkingAttempts=(state.parkingAttempts??0)+1;
      if(parkingRecoveryClear(road,a,{...car,model},neighbors as DrivingCar[])){
        state.parkingAttempts=5; // At most one physical correction; rejected checks are bounded too.
        state.parkingRecovery={phase:Math.abs(local.side)>1.2?'shift':'align',sideSign:Math.sign(local.side),elapsed:0,checkIn:0,clear:true};
      }
    }
  }
  if(front&&state.parkingRecovery){
    const recovery=state.parkingRecovery;recovery.elapsed+=dt;recovery.checkIn-=dt;
    if(recovery.checkIn<=0){recovery.clear=parkingRecoveryClear(road,a,{...car,model},neighbors as DrivingCar[]);recovery.checkIn=.1;}
    if(!recovery.clear||recovery.elapsed>15){state.parkingRecovery=undefined;state.blockedFor[unit]=5;return {speed:0,yawError:0,arrived:false,modeChanged:false};}
    const correction=parkingRecoveryControl(a,car,recovery.phase,recovery.sideSign);
    if(recovery.phase==='shift'&&correction.side*recovery.sideSign<=1)recovery.phase='align';
    else if(recovery.phase==='align'&&Math.abs(normalizeAngle(a.yaw-car.yaw))<.12){state.parkingRecovery=undefined;return {speed:0,yawError:0,arrived:false,modeChanged:false};}
    state.settled[unit]=0;
    return {speed:correction.speed,yawError:correction.yawError,arrived:false,modeChanged:false};
  }
  const finalForward = front ? a.front : -a.rear;
  const final = pointAt(a, 0, finalForward);
  const stage = state.stages[unit];
  const frontClear = state.playerCovered[0]||state.stages[frontUnit] >= 2;
  let target = front
    ? pointAt(a, stage === 0 || stage === 1 ? a.side : 0, stage === 0 ? -8 : stage === 1 ? a.front + 4 : stage === 2 ? a.front + 9 : a.front)
    : pointAt(a, 0, frontClear ? -a.rear : -a.rear - 6);
  let distance = Math.hypot(target.x - car.x, target.z - car.z);
  if (front && stage < 3 && distance < 1.2) {
    state.stages[frontUnit]++; target = pointAt(a, state.stages[frontUnit] === 1 ? a.side : 0, state.stages[frontUnit] === 1 ? a.front + 4 : state.stages[frontUnit] === 2 ? a.front + 9 : a.front);
    distance = Math.hypot(target.x - car.x, target.z - car.z);
  }
  const targetLocal = blockadeLocal(a, target);
  const reverse = (!front || state.stages[frontUnit] === 3 || state.stages[frontUnit] === 0)
    && local.forward > targetLocal.forward + .25;
  // Follow the final parking axis while there is still room to straighten.
  // Aiming at an ever-closer point previously left an oblique chassis which
  // only the removed in-place yaw motor could correct after stopping.
  const finalApproach = !front || state.stages[frontUnit] === 3;
  const targetYaw = finalApproach
    ? a.yaw + Math.atan(local.side / 2) * (reverse ? -1 : 1)
    : distance < .65 ? a.yaw : Math.atan2(-(target.x - car.x), -(target.z - car.z)) + (reverse ? Math.PI : 0);
  const yawError = normalizeAngle(targetYaw - car.yaw);
  let speed = Math.min(reverse ? 2.8 : 6, distance * 1.1, Math.sqrt(Math.max(0, distance - .25) * 5 * grip)) * clamp(1 - Math.abs(yawError) / .85, .16, 1) * (reverse ? -1 : 1);
  if(road.network&&!drivingFootprintOnRoad(road.network,carBox({...car,model:unit===0?'patrol':'suv'},.2)))speed=Math.sign(speed)*Math.min(Math.abs(speed),3);
  let blocked = false;
  // Project both car footprints along our actual motion, including a swept stopping margin.
  for (const other of neighbors) {
    const relative = blockadeLocal(car, other);
    const otherExtent = extent(other.yaw - car.yaw, 4.6, 2.15);
    const ahead = relative.forward * (reverse ? -1 : 1);
    const clearance = ahead - 2.3 - otherExtent.forward;
    if (ahead > 0 && Math.abs(relative.side) < 1.075 + otherExtent.side + .25) {
      const limit = Math.sqrt(Math.max(0, clearance - .3) * 8 * grip);
      speed = Math.sign(speed) * Math.min(Math.abs(speed), limit);
      if (clearance < .5) blocked = true;
    }
  }
  const projected = { x: car.x - Math.sin(car.yaw) * speed * .5, z: car.z - Math.cos(car.yaw) * speed * .5 };
  if (!inRoad(road, projected, car.yaw, a.index, unit)) { speed = 0; blocked = true; }
  state.blockedFor[unit] = blocked && distance > 1.2 ? state.blockedFor[unit] + dt : 0;
  const arrived = (!front ? frontClear : state.stages[frontUnit] === 3)
    && Math.hypot(final.x - car.x, final.z - car.z) < 1.05 && containmentPose(unit, car, suspect, a.yaw,front);
  state.settled[unit] = arrived ? state.settled[unit] + dt : 0;
  if (arrived) speed = 0;
  return { speed, yawError: arrived ? normalizeAngle(a.yaw - car.yaw) : yawError, arrived, modeChanged: false };
}

export function blockadeFeedback(state: BlockadeState): Pick<RadioFeedback, "phase" | "message"> {
  if (state.phase === "waiting") return { phase: "executing", message: "已待命，等待嫌犯減速；不需再次下令" };
  if (state.phase === "missed") return { phase: "unable", message: `錯過封鎖時機：${state.reason}；繼續追蹤並保持待命` };
  if (state.phase === "holding") return { phase: "completed", message: "可用單位已就位，持續守位；仍須確認所有出口是否受控" };
  const front=`0${state.frontUnit+2}`,rear=`0${3-state.frontUnit}`;
  return { phase: "executing", message: state.stages[state.frontUnit] < 2 ? `${front} 沿安全側進場，${rear} 保留通道` : `${front} 前封停車中，另一方向正在補位` };
}
