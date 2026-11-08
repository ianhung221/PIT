import type {RoadNetwork} from './roadNetwork.ts';
import {boxesOverlap,carBox,drivingFootprintOnRoad,drivingPoint,relativePosition,type DrivingCar,type DrivingObservation} from './drivingObservation.ts';
import {locateRoad} from './roadLocation.ts';

export interface LocalDrivingState {
 mode:'following'|'waiting'|'passing'|'braking'|'reversing'|'recovering'|'blocked';
 elapsed:number;stalled:number;attempts:number;offset:number;passSide:number;clearFor:number;
 lastX:number;lastZ:number;progress:number;reason:string;
 passPoint?:{x:number;z:number};
 passVehicleId?:string;passSpeed?:number;
 overtaking?:boolean;
 scan?:{age:number;x:number;z:number;yaw:number;turn:number;observation:DrivingObservation;clearance:number;leadSpeed:number;leadCar?:DrivingCar;reach:number};
}
export const makeLocalDriving=():LocalDrivingState=>({mode:'following',elapsed:0,stalled:0,attempts:0,offset:0,passSide:0,clearFor:0,lastX:NaN,lastZ:NaN,progress:0,reason:''});
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export interface LocalDrivingInput {network:RoadNetwork;car:DrivingCar;observation:DrivingObservation;dt:number;grip:number;speed:number;yawError:number;allowPass?:boolean;allowOvertake?:boolean;nearJunction?:boolean;roadYaw?:number;roadOffset?:number}

/** Validate the whole lateral transition, not just the proposed endpoint. */
export function localCorridorClear(input:LocalDrivingInput,side:number,distance:number,reverse=false){
 const {car,network,observation}=input,steps=Math.ceil(distance/.75);
 const body=carBox(car,.2),others=observation.cars.map(c=>carBox(c,.35));
 const shoulderRecovery=reverse&&!drivingFootprintOnRoad(network,body)?locateRoad(network,car):null;
 for(let i=1;i<=steps;i++){
  const d=distance*i/steps,t=Math.min(1,d/Math.max(10,Math.abs(car.speed)*1.2)),smooth=t*t*(3-2*t);
  const p=drivingPoint(car,side*smooth,d*(reverse?-1:1));
  const derivative=t<1?side*6*t*(1-t)/Math.max(10,Math.abs(car.speed)*1.2):0;
  const footprint={...body,...p,yaw:car.yaw-Math.atan(derivative)*(reverse?-1:1)};
  const onRoad=drivingFootprintOnRoad(network,footprint);
  // A car already pushed onto the flat shoulder may retreat locally to rejoin.
  // Normal passing must remain paved; real barriers and other cars still block both.
  const safeShoulder=shoulderRecovery&&shoulderRecovery.deviation<12&&locateRoad(network,footprint,shoulderRecovery).deviation<=shoulderRecovery.deviation+.5;
  if(!onRoad&&!safeShoulder||observation.objects.some(o=>boxesOverlap(footprint,o)))return false;
  const horizon=Math.min(2,d/Math.max(4,Math.abs(car.speed)));
  if(observation.cars.some((c,index)=>{
   const predicted=drivingPoint(c,c.lateralSpeed*horizon,c.speed*horizon);
   return boxesOverlap(footprint,{...others[index],...predicted})||boxesOverlap(footprint,others[index]);
  }))return false;
 }
 return true;
}

/** Behaviour changes target pedals through the existing driver; never moves a body. */
export function stepLocalDriving(state:LocalDrivingState,input:LocalDrivingInput){
 const {car,observation,dt,grip}=input;state.elapsed+=dt;
 const moved=Number.isFinite(state.lastX)?Math.hypot(car.x-state.lastX,car.z-state.lastZ):0;state.lastX=car.x;state.lastZ=car.z;
 if(moved<2)state.progress+=moved;
 if(state.progress>12){state.attempts=0;state.progress=0;}
 const switchTo=(mode:LocalDrivingState['mode'],reason:string)=>{if(state.mode!==mode){state.mode=mode;state.elapsed=0;}state.reason=reason;};
 const forward=Math.max(0,car.speed),braking=forward*forward/(2*4*Math.max(.25,grip));
 let clearance=Infinity,leadSpeed=0,leadCar:DrivingCar|undefined;
 // Sample along the desired heading arc. Static/dynamic geometry uses actual footprints.
 const reach=Math.min(75,Math.max(12,braking+forward*.8+8));
 if(state.scan)state.scan.age+=dt;
 const scan=state.scan;
 const reusable=scan&&scan.age<.05&&scan.observation===observation&&Math.abs(scan.yaw-car.yaw)<.03&&Math.abs(scan.turn-input.yawError)<.03&&reach<=scan.reach+1;
 if(reusable){
  const travelled=relativePosition({x:scan.x,z:scan.z,yaw:scan.yaw},car).forward;
  clearance=scan.clearance===Infinity?Infinity:Math.max(0,scan.clearance-travelled);
  leadSpeed=scan.leadSpeed;leadCar=scan.leadCar;
 }else{
 const body=carBox(car,.2),others=observation.cars.map(c=>carBox(c,.2));
 // Conservatively discard footprints that cannot intersect any sampled arc.
 // The arc's centre can deviate sideways by at most sin(.55 / 2) * reach;
 // the summed half-extents cover both rotated boxes and safety padding.
 const candidates=<T extends {x:number;z:number;halfX:number;halfZ:number}>(items:T[])=>items.filter(box=>{
  const p=relativePosition(car,box),margin=body.halfX+body.halfZ+box.halfX+box.halfZ;
  return p.forward>=-margin&&p.forward<=reach+margin&&Math.abs(p.side)<=reach*Math.sin(.275)+margin;
 });
 const possibleObjects=candidates(observation.objects);
 const possibleCars=candidates(others.map((box,index)=>({...box,index})));
 if(possibleCars.length||possibleObjects.length)for(let d=1;d<=reach;d+=1){
  const turn=clamp(input.yawError,-.55,.55)*Math.min(1,d/Math.max(8,forward));
  const angle=car.yaw+turn*.5,box={...body,x:car.x-Math.sin(angle)*d,z:car.z-Math.cos(angle)*d,yaw:car.yaw+turn};
  let hit:DrivingCar|undefined,objectHit=false;
  for(const other of possibleCars)if(boxesOverlap(box,other)){hit=observation.cars[other.index];break;}
  if(!hit)for(const object of possibleObjects)if(boxesOverlap(box,object)){objectHit=true;break;}
  if(hit||objectHit){clearance=d;leadCar=hit;leadSpeed=hit?Math.max(0,hit.speed*Math.cos(hit.yaw-car.yaw)):0;break;}
 }
 state.scan={age:0,x:car.x,z:car.z,yaw:car.yaw,turn:input.yawError,observation,clearance,leadSpeed,leadCar,reach};
 }
 let speed=input.speed,yawError=input.yawError;
 if(clearance<Infinity)speed=Math.min(speed,Math.max(0,leadSpeed+Math.sqrt(Math.max(0,clearance-2)*6*grip)));
 const obstructed=clearance<Math.max(18,braking+forward*.8+12)&&leadSpeed<Math.max(2,input.speed*(input.allowOvertake?.98:.7));
 const wantsMove=input.speed>1;
 state.stalled=wantsMove&&Math.abs(car.speed)<.8&&moved<dt*.7?state.stalled+dt:Math.max(0,state.stalled-dt*2);
 if(state.mode==='following'&&obstructed)switchTo('waiting','前方受阻，減速觀察');
 if(state.mode==='waiting'){
  state.clearFor=obstructed?0:state.clearFor+dt;
  if(state.clearFor>.6)switchTo('following','通道已清空');
  else if(wantsMove&&state.elapsed>.65&&(leadSpeed<2||input.allowOvertake&&leadCar?.id)&&Math.abs(input.yawError)<.12&&input.allowPass!==false&&!input.nearJunction&&Math.abs(car.speed)<(input.allowOvertake?22:15)){
   // Route points already include the normal lane offset; this is a relative shift.
   const side=[-4.2,4.2].find(s=>localCorridorClear(input,s,Math.max(26,clearance+12)));
   if(side!==undefined){state.passSide=side;state.passVehicleId=leadCar?.id;state.passSpeed=leadSpeed;state.overtaking=!!input.allowOvertake;state.passPoint=drivingPoint(car,0,clearance+3);state.clearFor=0;switchTo('passing','通道可用，繞過前車');}
  }
 }
 if(state.mode==='passing'){
  const moving=state.passVehicleId?observation.cars.find(c=>c.id===state.passVehicleId):undefined;
  if(moving){state.passPoint={x:moving.x,z:moving.z};state.passSpeed=Math.max(0,moving.speed);}
  if(state.overtaking&&!input.allowOvertake&&localCorridorClear(input,-state.offset,16)){
   state.overtaking=false;state.passVehicleId=undefined;state.passPoint=undefined;state.clearFor=2;state.reason='接替完成或收到新指令，安全回到隊形';
  }
  const blockedAhead=state.passPoint&&relativePosition(car,state.passPoint).forward>-6;
  state.clearFor=blockedAhead?0:state.clearFor+dt;
  if(state.clearFor>.4&&localCorridorClear(input,-state.offset,16)){state.passSide=0;if(Math.abs(state.offset)<.1)switchTo('following','回到追蹤路線');}
  speed=Math.min(speed,input.allowOvertake?Math.max(7*Math.sqrt(grip),(state.passSpeed??0)+4*Math.sqrt(grip)):7*Math.sqrt(grip));
 }
 const wanted=state.mode==='passing'?state.passSide:0;
 state.offset+=clamp(wanted-state.offset,-dt*1.5,dt*1.5);
 if(state.stalled>2.2&&state.attempts<2&&['following','waiting','passing'].includes(state.mode))switchTo('braking','受阻，確認倒車空間');
 if(state.stalled>2.2&&state.attempts>=2&&['following','waiting','passing'].includes(state.mode))switchTo('blocked','多次嘗試仍受阻，等待或重新找路');
 if(state.mode==='braking'){
  speed=0;
  if(state.elapsed>.4&&Math.abs(car.speed)<.5){
   if(localCorridorClear(input,0,4,true)){state.attempts++;state.stalled=0;switchTo('reversing','低速倒車離障');}
   else switchTo('blocked','後方無安全空間，等待通道');
  }
 }
 if(state.mode==='reversing'){
  speed=localCorridorClear(input,0,2,true)?-2*Math.sqrt(grip):0;
  yawError=0;
  if(state.elapsed>1.5||speed===0)switchTo('recovering','重新對準可用路線');
 }
 if(state.mode==='recovering'){
  speed=Math.min(speed,3*Math.sqrt(grip));
  if(state.elapsed>.5&&Math.abs(input.yawError)<.5&&car.speed>1)switchTo('following','重新跟隨路線');
  else if(state.elapsed>3)switchTo(state.attempts>=2?'blocked':'waiting','重新評估通道');
 }
 if(state.mode==='blocked'){
  speed=0;state.offset=0;
  // The forward scan follows the newly requested turn, so a clear alternate
  // route can release a wait even while the old straight-ahead route is blocked.
  if(!obstructed&&clearance>10){state.clearFor+=dt;if(state.clearFor>1){state.stalled=0;switchTo('recovering','通道恢復，低速重新對準路線');}}
  else state.clearFor=0;
 }
 return {speed,yawError,laneOffset:state.offset,blocked:state.mode==='blocked',mode:state.mode,clearance,reason:state.reason};
}
