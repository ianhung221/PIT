import type { CarSnapshot, GeneratedRoad, RadioFeedback } from "../types/game.ts";
import { SUSPECT, VEHICLES } from "./gameConfig.ts";
import { normalizeAngle } from "./gameRules.ts";
import { closestRoadSegment } from "./proceduralMap.ts";
import {locateRoad,locationSegment} from './roadLocation.ts';
import {boxesOverlap,carBox,drivingFootprintOnRoad,nearbyDrivingObjects,observeDriving,localIncidentFootprintClear} from './drivingObservation.ts';
import {networkIndex} from './roadNetwork.ts';
import {parkingRecoveryClear,parkingRecoveryControl} from './parkingRecovery.ts';
import type {DrivingCar} from './drivingObservation.ts';
import {localCorridorClear} from './localDriving.ts';
import {createIncidentSearch,advanceIncidentSearch,interleaveIncidentSearches,driveIncidentManeuver,type IncidentManeuver} from './incidentManeuver.ts';

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
  playerAtAssignment?:Point;
  targetHeadingAtAssignment?:number;
  frontDistance?:number;
  advancingFor?:number;
  // Per-unit feasibility is separate from vehicle health and actual arrival.
  assigned?:[boolean,boolean];
  nearby?:[boolean,boolean];
  parkingDirection?:[{stage:string;reverse:boolean}|null,{stage:string;reverse:boolean}|null];
  maneuvers?:[IncidentManeuver|null,IncidentManeuver|null];
  planning?:[boolean,boolean];
  maneuverAttempts?:[number,number];
  planningSpent?:[number,number];
  sceneStableFor?:[number,number];
  approachProgress?:[{best:number;wait:number}|null,{best:number;wait:number}|null];
  parkingGoal?:[(Point&{yaw:number})|null,(Point&{yaw:number})|null];
  failedParkingGoals?:[(Point&{yaw:number})[],(Point&{yaw:number})[]];
  parkingWait?:number;
  parkingAttempts?:number;
  parkingRecovery?:{phase:'shift'|'align';sideSign:number;elapsed:number;checkIn:number;clear:boolean};
  shoulderRecovery?:{x:number;z:number;elapsed:number};
  shoulderAttempts?:number;
}
export const makeBlockade = (): BlockadeState => ({ phase: "waiting", elapsed: 0, slowFor: 0, fastFor: 0, reason: "", anchor: null, stages: [0, 0], settled: [0, 0], blockedFor: [0, 0],frontUnit:0,available:[true,true],playerCovered:[false,false] });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const planar = (car: CarSnapshot) => Math.hypot(car.speed, car.lateralSpeed);
type PendingManeuver={search:ReturnType<typeof createIncidentSearch>;car:DrivingCar;goal:Point&{yaw:number};neighbors:DrivingCar[];elapsed:number};
const searches=new WeakMap<BlockadeState,[PendingManeuver|null,PendingManeuver|null]>();
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
  const aligned=planar(player)<.65&&Math.abs(p.side)<box.halfZ+SUSPECT.width/2&&controlsDeparture(player,suspect);
  return [aligned&&p.forward-minimum>=0&&p.forward-minimum<1.5,aligned&&-p.forward-minimum>=0&&-p.forward-minimum<1.5];
}

// One geometric standard for radio arrival and mission victory, regardless of Q4.
export function containmentPose(unit: 0 | 1, car: CarSnapshot, suspect: CarSnapshot, roadYaw: number,front=unit===0) {
  const local = blockadeLocal({ ...suspect, yaw: roadYaw }, car);
  const dimensions = unit === 0 ? VEHICLES.patrol : VEHICLES.suv;
  const minimumGap = extent(suspect.yaw - roadYaw, SUSPECT.length, SUSPECT.width).forward
    + extent(car.yaw - roadYaw, dimensions.length, dimensions.width).forward;
  const gap = (front ? local.forward : -local.forward) - minimumGap;
  return gap >= .12 && gap <= 1.25 && Math.abs(local.side) < .8 && controlsDeparture({...car,model:unit===0?'patrol':'suv'},suspect)
    && Math.abs(normalizeAngle(roadYaw - car.yaw)) < .25 && planar(car) < .65 && planar(suspect) < 1.2;
}
function inRoad(road: GeneratedRoad, point: Point, yaw: number, index: number, unit: number, incident?:Point) {
  if(road.network){
    const box=carBox({...point,yaw,speed:0,lateralSpeed:0,model:unit===0?'patrol':'suv'},.35);
    if(incident)return localIncidentFootprintClear(road.network,box,incident);
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
export function planBlockade(road: GeneratedRoad, index: number, suspect: CarSnapshot, supports: CarSnapshot[], player: CarSnapshot,frontUnit:0|1=0,yawOverride?:number,allowPartial=false) {
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
  let partial: (typeof origin & {side:number;front:number;rear:number;assigned:[boolean,boolean]}) | null = null;
  for (const side of sides) {
    let clear = true;
    for (let forward = -10; !covered[0]&&!alreadyAhead&&forward <= 14; forward += 2) {
      const p = pointAt(origin, side, forward);
      if (!inRoad(road, p, yaw, index, frontUnit,origin)) { clear = false; break; }
      const relative = blockadeLocal({ ...p, yaw }, player);
      if (Math.abs(relative.side) < 2.7 && Math.abs(relative.forward) < 5) { clear = false; break; }
    }
    const frontFeasible=covered[0]||clear&&inRoad(road, pointAt(origin, 0, front), yaw, index, frontUnit,origin);
    const rearFeasible=covered[1]||inRoad(road, pointAt(origin, 0, -rear), yaw, index, 1-frontUnit,origin);
    const assigned:[boolean,boolean]=frontUnit===0?[frontFeasible,rearFeasible]:[rearFeasible,frontFeasible];
    if (frontFeasible && rearFeasible) {
      return { ...origin, side, front, rear, assigned };
    }
    if(allowPartial&&(frontFeasible||rearFeasible)&&!partial)partial={...origin,side,front,rear,assigned};
  }
  return partial;
}

/** Partial control only: intercepts a short straight departure, not enclosure. */
export function controlsDeparture(car:DrivingCar,suspect:CarSnapshot){
 const obstacle=carBox(car),body=carBox({...suspect,model:'suspect'});
 if(boxesOverlap(obstacle,body))return false;
 // A rectangle translated along its own axis sweeps one longer rectangle.
 return boxesOverlap(obstacle,{...body,halfZ:body.halfZ+4});
}

export function missBlockade(state: BlockadeState, reason: string) {
  for(const pending of searches.get(state)??[])pending?.search.return(null);
  state.phase = "missed"; state.elapsed = 0; state.slowFor = 0; state.fastFor = 0;
  state.anchor = null; state.settled = [0, 0]; state.reason = reason;
  state.maneuvers=[null,null];state.planning=[false,false];state.approachProgress=[null,null];state.parkingGoal=[null,null];searches.delete(state);
}
/** A nearby unit should hold position during a brief replan around a slow
 * target, instead of following a road loop away from the incident. */
export function waitForBlockadeRetry(state:BlockadeState,car:CarSnapshot,suspect:CarSnapshot){
  return state.phase==='missed'&&planar(suspect)<4.2&&Math.hypot(car.x-suspect.x,car.z-suspect.z)<26;
}
export function stepBlockade(state: BlockadeState, input: { road: GeneratedRoad; index: number; suspect: CarSnapshot; supports: CarSnapshot[]; player: CarSnapshot; dt: number;available?:[boolean,boolean] }) {
  const { suspect, supports, dt } = input;
  // Search and wheel-driven manoeuvres have their own bounded lifetimes.
  // Counting them again made an arrival instantly expire before its dwell check.
  if(!state.planning?.some(Boolean)&&!state.maneuvers?.some(Boolean))state.elapsed += dt;
  const speed = planar(suspect);
  const stable=!suspect.pose||suspect.pose.groundedWheels>=3&&suspect.pose.angularSpeed<.65&&Math.abs(suspect.lateralSpeed)<1.5;
  state.slowFor = speed < 4.2&&stable ? state.slowFor + dt : 0;
  const availability=input.available??[true,true];
  // Road routing owns the outer approach. Handoff must occur inside the local
  // incident envelope (32 m including the whole chassis), not at the old 55 m.
  state.nearby=supports.map((car,i)=>availability[i]&&Math.hypot(car.x-suspect.x,car.z-suspect.z)<=(input.road.network?26:65)) as [boolean,boolean];
  if(state.available.some((a,i)=>a!==availability[i])&&state.anchor)missBlockade(state,'單位車況改變，重新分工');
  state.available=[...availability];
  state.fastFor = speed > 7 ? state.fastFor + dt : 0;
  if (state.phase === "missed") {
    if (state.elapsed <= 3) return;
    if (speed >= 4.2) { searches.delete(state);Object.assign(state, makeBlockade(),{maneuvers:[null,null],planning:[false,false],maneuverAttempts:[0,0],planningSpent:[0,0],sceneStableFor:[0,0],approachProgress:[null,null],parkingGoal:[null,null],failedParkingGoals:[[],[]]}); return; }
  }
  if (state.phase === "waiting" || state.phase === "missed") {
    if (state.slowFor < .35) return;
    if(!availability.some(Boolean)){missBlockade(state,'沒有可用後援');return;}
    if (!state.nearby.some(Boolean)) {
      missBlockade(state, "後援距離過遠"); return;
    }
    let anchor = planBlockade(input.road, input.index, suspect, supports, input.player);
    state.frontUnit=0;
    if(input.road.network){
      const targetYaw=suspect.yaw;
      let cost=Infinity;anchor=null;
      const yaw=targetYaw;
      for(const frontUnit of [0,1] as const){
        const covered=playerCoverage(suspect,input.player,yaw);
        if(!availability[frontUnit]&&!covered[0])continue;
        const candidate=planBlockade(input.road,input.index,suspect,supports,input.player,frontUnit,yaw,true);if(!candidate)continue;
        if(!candidate.assigned.some((assigned,i)=>assigned&&state.nearby![i]&&!covered[i===frontUnit?0:1]))continue;
        let score=availability[1-frontUnit]||covered[1]?0:1000;
        // Penalize a queue order that asks the trailing car to pass its waiting partner.
        const lead=supports[frontUnit],peer=supports[1-frontUnit];
        const destination=pointAt(candidate,0,candidate.front);
        const dx=destination.x-lead.x,dz=destination.z-lead.z;
        const length=Math.hypot(dx,dz);
        if(length>0&&availability[1-frontUnit]&&!covered[0]){
          const px=peer.x-lead.x,pz=peer.z-lead.z;
          const along=(px*dx+pz*dz)/length;
          if(along>0&&along<length&&Math.abs(px*dz-pz*dx)/length<3)score+=length;
        }
        for(let unit=0;unit<2;unit++)if(availability[unit]&&!covered[unit===frontUnit?0:1]){
          if(!candidate.assigned[unit]){score+=500;continue;}
          const car=supports[unit],local=blockadeLocal(candidate,car),target=unit===frontUnit?candidate.front:-candidate.rear;
          score+=Math.hypot(local.side,local.forward-target)+Math.abs(normalizeAngle(car.yaw-yaw))*8;
          if(unit===frontUnit&&local.forward<candidate.front)score+=12;
        }
        if(score<cost){cost=score;anchor=candidate;state.frontUnit=frontUnit;}
      }
    }
    if (!anchor) { missBlockade(state, "沒有安全進場通道"); return; }
    state.assigned=anchor.assigned;
    state.reason='';
    state.playerAtAssignment={x:input.player.x,z:input.player.z};
    state.targetHeadingAtAssignment=suspect.yaw;
    state.frontDistance=undefined;state.advancingFor=0;
    state.anchor = anchor; state.phase = "approaching"; state.elapsed = 0;
    state.parkingDirection=[null,null];
    state.playerCovered=playerCoverage(suspect,input.player,anchor.yaw);
    const frontPosition = blockadeLocal(anchor, supports[state.frontUnit]);
    state.stages = [0,0];state.stages[state.frontUnit]=frontPosition.forward > anchor.front + 2 ? 2 : frontPosition.forward > -6 && Math.abs(frontPosition.side - anchor.side) < 1 ? 1 : 0;
    state.settled = [0, 0]; state.blockedFor = [0, 0];state.parkingWait=0;state.parkingAttempts=0;state.parkingRecovery=undefined;state.shoulderRecovery=undefined;state.shoulderAttempts=0;
    return;
  }
  if (!state.anchor) return;
  if(input.road.network&&stable&&state.targetHeadingAtAssignment!==undefined&&Math.abs(normalizeAngle(suspect.yaw-state.targetHeadingAtAssignment))>.35){
    missBlockade(state,'嫌犯朝向改變，重新確認守位');return;
  }
  const lead=supports[state.frontUnit];
  const distance=Math.hypot(lead.x-suspect.x,lead.z-suspect.z);
  if(state.frontDistance===undefined||distance>state.frontDistance+.5)state.frontDistance=distance;
  if(distance<state.frontDistance-.5){
    state.frontDistance=distance;state.advancingFor=.8;
  }else state.advancingFor=Math.max(0,(state.advancingFor??0)-dt);
  const previousPlayer=state.playerAtAssignment;
  if(previousPlayer&&state.maneuverAttempts?.some(n=>n>=2)&&!state.settled.some(t=>t>.8)
    &&Math.hypot(input.player.x-previousPlayer.x,input.player.z-previousPlayer.z)>4){
    state.failedParkingGoals=[[],[]];state.maneuverAttempts=[0,0];state.planningSpent=[0,0];
    missBlockade(state,'玩家已移開，重新確認通道');return;
  }
  const covered=playerCoverage(suspect,input.player,state.anchor.yaw);
  if(covered.some((c,i)=>c!==state.playerCovered[i])){missBlockade(state,'玩家守位改變，重新分工');return;}
  if (state.fastFor > .65 || Math.hypot(suspect.x - state.anchor.x, suspect.z - state.anchor.z) > 7) {
    missBlockade(state, "嫌犯已離開封鎖位置"); return;
  }
  // A slow target may drift after the anchor was chosen. Revalidate the
  // parking geometry against its current body instead of aiming at stale slots.
  if(stable&&speed<1.2&&Math.hypot(suspect.x-state.anchor.x,suspect.z-state.anchor.z)>.75){
    if(state.stages[state.frontUnit]<2){missBlockade(state,'嫌犯位置改變，重新檢查進場通道');return;}
    const refreshed=planBlockade(input.road,input.index,suspect,supports,input.player,state.frontUnit,state.anchor.yaw,true);
    if(!refreshed){missBlockade(state,'嫌犯位置改變，沒有安全進場通道');return;}
    state.anchor=refreshed;state.assigned=refreshed.assigned;state.settled=[0,0];
    searches.delete(state);state.maneuvers=[null,null];state.planning=[false,false];state.parkingGoal=[null,null];state.approachProgress=[null,null];
  }
  const guarding=state.settled.some((t,i)=>availability[i]&&t>.8);
  const recovering=state.planning?.some(Boolean)||state.maneuvers?.some(Boolean);
  if (!guarding && !recovering && (state.blockedFor.some(t => t > 5) || (state.phase === "approaching" && state.elapsed > 35+(state.parkingAttempts?15:0)+(state.shoulderAttempts?10:0)))) {
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
  if(state.assigned?.[unit]===false)return {speed:0,yawError:0,arrived:false,modeChanged:false};
  if(state.nearby?.[unit]===false)return null;
  const frontUnit=state.frontUnit,front=unit===frontUnit;
  if(state.playerCovered[front?0:1])return {speed:0,yawError:0,arrived:false,modeChanged:false};
  const local = blockadeLocal(a, car);
  const model=unit===0?'patrol':'suv';
  const network=road.network,drivingCar={...car,model} as DrivingCar;
  if(front&&!state.parkingGoal?.[unit]&&state.stages[unit]===2&&network&&!state.shoulderRecovery&&!state.shoulderAttempts&&state.blockedFor[unit]>1&&planar(car)<.5&&!drivingFootprintOnRoad(network,carBox(drivingCar,.2))){
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
  if(front&&!state.parkingGoal?.[unit]&&state.stages[unit]===3&&!state.parkingRecovery&&(state.parkingAttempts??0)<5){
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
  const frontClear = state.playerCovered[0]||state.assigned?.[frontUnit]===false||!state.available[frontUnit]||state.nearby?.[frontUnit]===false||state.stages[frontUnit] >= 2;
  if(network&&(front||frontClear)){
    state.maneuvers??=[null,null];state.planning??=[false,false];state.maneuverAttempts??=[0,0];state.approachProgress??=[null,null];
    state.planningSpent??=[0,0];state.sceneStableFor??=[0,0];
    const changing=neighbors.some(c=>Math.hypot(c.x-car.x,c.z-car.z)<16&&(planar(c)>.65||(c.pose?.angularSpeed??0)>.4));
    state.sceneStableFor[unit]=changing?0:state.sceneStableFor[unit]+dt;
    let pending=searches.get(state);if(!pending){pending=[null,null];searches.set(state,pending);}
    state.parkingGoal??=[null,null];
    state.failedParkingGoals??=[[],[]];
    let goal=state.parkingGoal[unit]??{...final,yaw:a.yaw};
    const distance=Math.hypot(goal.x-car.x,goal.z-car.z);
    const progress=state.approachProgress[unit]??{best:distance,wait:0};state.approachProgress[unit]=progress;
    if(distance<progress.best-.2){progress.best=distance;progress.wait=0;}else progress.wait+=dt;
    const stop={speed:0,yawError:0,arrived:false,modeChanged:false};
    const isAtSlot=state.parkingGoal[unit]
      ?distance<.7&&Math.abs(normalizeAngle(goal.yaw-car.yaw))<.25&&planar(car)<.65&&planar(suspect)<1.2
      :containmentPose(unit,car,suspect,a.yaw,front);
    if(state.parkingGoal[unit]&&isAtSlot&&!controlsDeparture(drivingCar,suspect)){
      state.settled[unit]=0;state.reason=`0${unit+2} 已接近，但尚未控制逃離方向`;
      return stop;
    }
    if(state.parkingGoal[unit]&&isAtSlot){
      state.maneuvers[unit]=null;state.planning[unit]=false;pending[unit]=null;
      state.settled[unit]+=dt;state.blockedFor[unit]=0;if(front)state.stages[unit]=3;return {...stop,arrived:true};
    }
    // Do not drive toward a slot already occupied by the player's angled car.
    // Brake and plan from the waiting position, before close contact removes
    // the clearance needed to begin a swept manoeuvre.
    if(!isAtSlot)state.settled[unit]=0;
    const goalBlocked=neighbors.some(c=>boxesOverlap(carBox({...drivingCar,...goal},.35),carBox(c as DrivingCar,.2)));
    if(!front&&!isAtSlot&&goalBlocked&&!pending[unit]&&!state.maneuvers[unit])progress.wait=Math.max(progress.wait,2+dt);
    if(!isAtSlot&&!pending[unit]&&!state.maneuvers[unit]&&progress.wait>2&&planar(car)<.2&&state.sceneStableFor[unit]>=.5&&state.maneuverAttempts[unit]<2&&state.planningSpent[unit]<15){
      progress.wait=0;state.planning[unit]=true;
      const candidates=[0,-3.2,3.2,-5,5].map(side=>({...pointAt(a,side,finalForward),yaw:a.yaw}));
      const clear=candidates.filter(p=>{
        if(state.failedParkingGoals![unit].some(f=>Math.hypot(f.x-p.x,f.z-p.z)<.25&&Math.abs(normalizeAngle(f.yaw-p.yaw))<.1))return false;
        const box=carBox({...drivingCar,...p},.35);
        return controlsDeparture({...drivingCar,...p},suspect)&&localIncidentFootprintClear(network,box,a)&&!neighbors.some(c=>boxesOverlap(box,carBox(c as DrivingCar,.2)));
      });
      // A player's angled car may already occupy the nominal rear slot. Pick
      // an actually free adjacent direction rather than trying to park through it.
      const selected=clear.find(p=>p.x===goal.x&&p.z===goal.z)??clear.sort((p,q)=>Math.hypot(p.x-car.x,p.z-car.z)-Math.hypot(q.x-car.x,q.z-car.z))[0];
      if(!selected){state.maneuverAttempts[unit]++;state.planning[unit]=false;state.reason=`0${unit+2} 沒有可用補位空間`;return stop;}
      goal=selected;state.parkingGoal[unit]=selected;progress.best=Math.hypot(goal.x-car.x,goal.z-car.z);progress.wait=0;
      const ordered=[selected,...clear.filter(p=>p!==selected)].slice(0,5);
      pending[unit]={search:interleaveIncidentSearches(ordered.map(p=>createIncidentSearch(network,drivingCar,p,a,neighbors as DrivingCar[])),index=>state.failedParkingGoals![unit].push({...ordered[index]})),car:{...drivingCar},goal,neighbors:neighbors.map(c=>({...c})),elapsed:0};
    }
    const search=pending[unit];
    if(search){
      search.elapsed+=dt;state.planningSpent[unit]+=dt;
      const moved=(before:CarSnapshot,after:CarSnapshot,limit:number)=>Math.hypot(before.x-after.x,before.z-after.z)>limit||Math.abs(normalizeAngle(before.yaw-after.yaw))>.25;
      const stale=moved(search.car,car,.4)||Math.hypot(search.goal.x-goal.x,search.goal.z-goal.z)>.4||search.neighbors.some((c,i)=>!neighbors[i]||moved(c,neighbors[i],.7));
      if(stale||state.planningSpent[unit]>=15){search.search.return(null);pending[unit]=null;state.planning[unit]=false;progress.wait=0;state.sceneStableFor[unit]=0;state.reason=state.planningSpent[unit]>=15?`0${unit+2} 局部規劃預算已用盡，保持等待`:`0${unit+2} 規劃期間空間改變，先停下重新確認`;return stop;}
      const result=advanceIncidentSearch(search.search);
      if(result.done){
        state.maneuverAttempts[unit]++;state.maneuvers[unit]=result.plan;pending[unit]=null;state.planning[unit]=false;progress.wait=0;
        if(result.plan?.goal){state.parkingGoal[unit]=result.plan.goal;progress.best=Math.hypot(result.plan.goal.x-car.x,result.plan.goal.z-car.z);}
        if(!result.plan){state.parkingGoal[unit]=null;state.reason=`0${unit+2} 候選補位方向未找到路徑，保持等待`;}
      }
      state.blockedFor[unit]=0;return stop;
    }
    const maneuver=state.maneuvers[unit];
    if(maneuver){
      const control=driveIncidentManeuver(maneuver,network,drivingCar,a,neighbors as DrivingCar[],dt,grip);
      if(control.status==='driving'){state.blockedFor[unit]=0;return {...control,arrived:false,modeChanged:false};}
      state.maneuvers[unit]=null;progress.wait=0;
      if(control.status==='done'){if(front)state.stages[unit]=3;state.elapsed=0;}
      else {state.failedParkingGoals[unit].push({...goal});state.parkingGoal[unit]=null;state.reason=`0${unit+2} ${control.reason}，停止並檢查其他方向`;}
      return stop;
    }
    if(!isAtSlot&&(state.maneuverAttempts[unit]>=2||state.planningSpent[unit]>=15))return stop;
    // Stop before planning so the snapshot and the first path segment agree.
    if(!isAtSlot&&progress.wait>2)return stop;
  }
  let target = front
    ? pointAt(a, stage === 0 || stage === 1 ? a.side : 0, stage === 0 ? -8 : stage === 1 ? a.front + 4 : stage === 2 ? a.front + 9 : a.front)
    : pointAt(a, 0, frontClear ? -a.rear : -a.rear - 6);
  let distance = Math.hypot(target.x - car.x, target.z - car.z);
  if (front && stage < 3 && distance < 1.2) {
    state.stages[frontUnit]++; target = pointAt(a, state.stages[frontUnit] === 1 ? a.side : 0, state.stages[frontUnit] === 1 ? a.front + 4 : state.stages[frontUnit] === 2 ? a.front + 9 : a.front);
    distance = Math.hypot(target.x - car.x, target.z - car.z);
  }
  const targetLocal = blockadeLocal(a, target);
  const canReverse=!front || state.stages[frontUnit] === 3 || state.stages[frontUnit] === 0;
  const directionStage=front?String(state.stages[frontUnit]):frontClear?'final':'wait';
  state.parkingDirection??=[null,null];
  let direction=state.parkingDirection[unit];
  if(!direction||direction.stage!==directionStage){
    direction={stage:directionStage,reverse:canReverse&&local.forward>targetLocal.forward+.25};
    state.parkingDirection[unit]=direction;
  }
  // A lateral approach crosses the target's longitudinal coordinate before it
  // reaches the target. Keep that manoeuvre's gear until the waypoint is reached;
  // otherwise the .25 m threshold alternated pedals hundreds of times at rest.
  // Final parking can correct an actual overshoot, with a full metre hysteresis.
  if((!front||state.stages[frontUnit]===3)&&Math.abs(local.side)<1.2){
    if(local.forward>targetLocal.forward+1)direction.reverse=true;
    else if(local.forward<targetLocal.forward-1)direction.reverse=false;
  }
  const reverse=canReverse&&direction.reverse;
  // Follow the final parking axis while there is still room to straighten.
  // Aiming at an ever-closer point previously left an oblique chassis which
  // only the removed in-place yaw motor could correct after stopping.
  const finalApproach = !front || state.stages[frontUnit] === 3;
  const targetYaw = finalApproach
    ? a.yaw + Math.atan(local.side / 2) * (reverse ? -1 : 1)
    : distance < .65 ? a.yaw : Math.atan2(-(target.x - car.x), -(target.z - car.z)) + (reverse ? Math.PI : 0);
  const yawError = normalizeAngle(targetYaw - car.yaw);
  let speed = Math.min(reverse ? 2.8 : 6, distance * 1.1, Math.sqrt(Math.max(0, distance - .25) * 5 * grip)) * clamp(1 - Math.abs(yawError) / .85, .16, 1) * (reverse ? -1 : 1);
  if(!front&&!frontClear&&distance<1.2)speed=0;
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
  if (!inRoad(road, projected, car.yaw, a.index, unit,a)) { speed = 0; blocked = true; }
  // Waiting for the front unit to clear the entry is coordination, not a
  // failed parking attempt. Do not carry that waiting time into its turn.
  state.blockedFor[unit] = blocked && distance > 1.2 && (front||frontClear) ? state.blockedFor[unit] + dt : 0;
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
  const guarding=state.settled.findIndex((t,i)=>state.available[i]&&t>.8);
  if(guarding>=0)return {phase:'executing',message:`0${guarding+2} 已控制一個方向；其他出口尚待補位，不代表完成攔停`};
  if(state.reason&&state.maneuverAttempts?.some(attempts=>attempts>=2))
    return {phase:'unable',message:state.reason};
  const front=`0${state.frontUnit+2}`,rear=`0${3-state.frontUnit}`;
  if(state.playerCovered[0])return {phase:'executing',message:`玩家已守車頭，${rear} 負責車尾`};
  if(state.playerCovered[1])return {phase:'executing',message:`玩家已守車尾，${front} 負責車頭`};
  if((state.advancingFor??0)>0)return {phase:'executing',message:`${front} 正在接近嫌犯`};
  return { phase: "executing", message: state.stages[state.frontUnit] < 2 ? `已分派 ${front} 先行，${rear} 讓行` : `已分派 ${front} 停車，另一方向待確認` };
}
