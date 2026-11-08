import {networkIndex,otherEnd,type RoadNetwork} from './roadNetwork.ts';
import {locateRoad,locationSegment,type RoadLocation} from './roadLocation.ts';
import {routePoints,shortestRoute,returningRoute,type DirectedRoad,type RoutePoint} from './roadRouting.ts';
import {followNetworkRoute} from './networkDriving.ts';
import {createSeededRandom} from './seededRandom.ts';
import type {CarSnapshot} from '../types/game.ts';
import {observeDriving,relativePosition,carBox,drivingFootprintOnRoad,type DrivingObservation,type DrivingCar} from './drivingObservation.ts';
import {makeLocalDriving,stepLocalDriving,type LocalDrivingState} from './localDriving.ts';
import {localCorridorClear} from './localDriving.ts';
import {chooseObservedExit} from './suspectEscapeChoice.ts';
import type {SuspectDifficulty} from './gameConfig.ts';
import {turnaroundAreaClear} from './safeTurnaround.ts';

export interface NetworkDriver {
 location?:RoadLocation;route:DirectedRoad[];points:RoutePoint[];progress:{index:number};nextPlan:number;
 random:()=>number;goal:string;goalKey?:string;blocked:boolean;laneOffset:number;lastTime:number;
 local:LocalDrivingState;observation?:DrivingObservation;
 threatFor?:number;escapeNode?:string;
 blockedRoads?:Record<string,number>;
 turnaround?:{start:DrivingCar;elapsed:number;checkIn:number;clear:boolean};
 turnaroundCooldown?:number;turnaroundReason?:string;turnaroundStopping?:boolean;
}
export const makeNetworkDriver=(seed:string):NetworkDriver=>({route:[],points:[],progress:{index:0},nextPlan:0,random:createSeededRandom(seed),goal:'',blocked:false,laneOffset:0,lastTime:0,local:makeLocalDriving()});

export function localNetworkControl(network:RoadNetwork,state:NetworkDriver,car:DrivingCar,neighbors:DrivingCar[],time:number,grip:number,control:{speed:number;yawError:number},dt:number,allowOvertake=false){
 if(!state.observation||time-state.observation.at>=.15||time<state.observation.at)state.observation=observeDriving(network,car,neighbors,time);
 return stepLocalDriving(state.local,{network,car,observation:state.observation,dt,grip,...control,nearJunction:state.location?.nearJunction,roadOffset:state.location?.offset,allowOvertake});
}
function installRoute(network:RoadNetwork,state:NetworkDriver,route:DirectedRoad[],car:CarSnapshot){
 state.route=route;state.points=routePoints(network,route);state.progress.index=0;
 // The initial location belongs to the first road, even if the future route loops.
 const end=networkIndex(network).nodes.get(route[0].to)!;
 let best=Infinity;for(let i=0;i<state.points.length-1;i++){
  const p=state.points[i],d=Math.hypot(p.x-car.x,p.z-car.z);if(d<best){best=d;state.progress.index=i;}
  if(Math.hypot(p.x-end.x,p.z-end.z)<end.radius+1)break;
 }
 state.blocked=false;
}
export function escapeRoute(network:RoadNetwork,state:NetworkDriver,car:CarSnapshot,time:number,grip:number,laneOffset=0,neighbors?:DrivingCar[],difficulty:SuspectDifficulty='basic',laneTarget?:number){
 const dt=Math.max(0,Math.min(.1,time-state.lastTime));state.lastTime=time;
 state.location=locateRoad(network,car,state.location);
 if(neighbors&&(!state.observation||time-state.observation.at>=.15||time<state.observation.at))state.observation=observeDriving(network,{...car,model:'suspect'},neighbors,time);
 state.threatFor=state.observation?.cars.length?(state.threatFor??0)+dt:0;
 const currentEdge=networkIndex(network).edges.get(state.location.edge)!;
 const p=state.points[state.progress.index],q=state.points[state.progress.index+1];
 const wrongDirection=p&&q&&((q.x-p.x)*-Math.sin(car.yaw)+(q.z-p.z)*-Math.cos(car.yaw))<-.5*Math.hypot(q.x-p.x,q.z-p.z)&&Math.abs(car.speed)<5&&time>=state.nextPlan;
 const canChoose=difficulty!=='basic'&&(state.threatFor??0)>=(difficulty==='advanced'?.8:1.4)&&currentEdge.length-state.location.distance<75&&currentEdge.length-state.location.distance>28&&state.escapeNode!==state.location.to&&time>=state.nextPlan;
 if(!state.points.length||state.progress.index>state.points.length-35||time>=state.nextPlan&&state.blocked||canChoose||wrongDirection){
  const index=networkIndex(network),location=state.location;
  const route:DirectedRoad[]=[{edge:location.edge,from:location.from,to:location.to}];
  let last=route[0];
  for(let i=0;i<14;i++){
   const choices=index.exits.get(last.to)!.filter(e=>e.id!==last.edge);
   if(!choices.length)break;
   const weighted=choices.flatMap(e=>e.biome==='city'?[e]:[e,e]);
   const edge=i===0&&canChoose&&state.observation?chooseObservedExit(network,last.to,choices,state.observation,difficulty,state.random)!:weighted[Math.floor(state.random()*weighted.length)];
   last={edge:edge.id,from:last.to,to:otherEnd(edge,last.to)};route.push(last);
  }
  installRoute(network,state,route,car);state.nextPlan=time+2;
  if(canChoose)state.escapeNode=location.to;
 }
 const normalLane=Math.min(2.7,currentEdge.width/4),limit=currentEdge.width/2-2;
 let wanted=Math.max(-limit-normalLane,Math.min(limit-normalLane,laneTarget===undefined?laneOffset:laneTarget-normalLane));
 if(state.observation&&wanted&&!localCorridorClear({network,car:{...car,model:'suspect'},observation:state.observation,dt,grip,speed:car.speed,yawError:0},wanted+normalLane-state.location.offset,Math.max(15,Math.abs(car.speed))))wanted=0;
 if(state.local.mode==='passing')wanted=state.local.offset;
 state.laneOffset+=Math.max(-dt*.8,Math.min(dt*.8,wanted-state.laneOffset));
 const control=followNetworkRoute(car,state.points,state.progress,grip,state.laneOffset);
 if(neighbors){const local=localNetworkControl(network,state,{...car,model:'suspect'},neighbors,time,grip,control,dt);control.speed=local.speed;control.yawError=local.yawError;}
 state.blocked=control.deviation>20||state.local.mode==='blocked';
 if(state.blocked)control.speed=0;
 return control;
}

/** Follow a reachable road corridor; missing routes brake rather than cross scenery. */
export function chaseRoute(network:RoadNetwork,state:NetworkDriver,car:DrivingCar,target:CarSnapshot,time:number,grip:number,gap=15,neighbors:DrivingCar[]=[],allowOvertake=false,allowTurnaround=false,targetLocation?:RoadLocation){
 state.location=locateRoad(network,car,state.location);const goal=targetLocation??locateRoad(network,target),location=state.location;
 const dt=Math.max(0,Math.min(.1,time-state.lastTime));state.lastTime=time;
 if(state.turnaround&&!allowTurnaround){state.turnaround=undefined;state.turnaroundCooldown=time+10;state.turnaroundReason='取消迴轉，先安全停下';state.turnaroundStopping=true;}
 if(state.turnaroundStopping){
  if(Math.hypot(car.speed,car.lateralSpeed)<.4){state.turnaroundStopping=false;state.location=undefined;state.points=[];state.goalKey='';state.nextPlan=time;}
  return {speed:0,yawError:0,remaining:0,deviation:0,arrived:false};
 }
 if(!state.turnaround&&allowTurnaround&&time>=(state.turnaroundCooldown??0)&&location.edge===goal.edge&&location.from!==goal.from&&!location.nearJunction
   &&relativePosition(car,target).forward< -8&&Math.hypot(car.x-target.x,car.z-target.z)<80&&Math.abs(car.speed)<1.2&&Math.abs(car.lateralSpeed)<.5){
  const edge=networkIndex(network).edges.get(location.edge)!,line=locationSegment(network,location).yaw;
  const heading=Math.atan2(Math.sin(car.yaw-line),Math.cos(car.yaw-line));
  if(edge.width>=20&&location.offset>=2&&location.offset<=3.5&&Math.abs(heading)<.15){
   if(turnaroundAreaClear(network,car,neighbors)){
    state.turnaround={start:{...car},elapsed:0,checkIn:0,clear:true};state.turnaroundReason='通道安全，低速迴轉重新追趕';
   }else state.turnaroundCooldown=time+1;
  }
 }
 if(state.turnaround){
  const turn=state.turnaround;turn.elapsed+=dt;turn.checkIn-=dt;
  if(turn.checkIn<=0){turn.clear=turnaroundAreaClear(network,turn.start,neighbors);turn.checkIn=.1;}
  const rotation=Math.atan2(Math.sin(car.yaw-turn.start.yaw),Math.cos(car.yaw-turn.start.yaw));
  if(!turn.clear||turn.elapsed>30||!drivingFootprintOnRoad(network,carBox(car,.1))){
   state.turnaround=undefined;state.turnaroundCooldown=time+10;state.turnaroundReason='迴轉空間受阻，停下並重新規劃';state.turnaroundStopping=true;state.blocked=true;
   return {speed:0,yawError:0,remaining:0,deviation:0,arrived:false};
  }
  if(rotation>=2.8){
   state.turnaround=undefined;state.turnaroundCooldown=time+10;state.turnaroundReason='已完成迴轉，重新追蹤';state.turnaroundStopping=true;state.location=undefined;state.points=[];state.goalKey='';state.nextPlan=time;
   return {speed:0,yawError:0,remaining:0,deviation:0,arrived:false};
  }
  return {speed:1.5*Math.sqrt(grip),yawError:Math.atan2(Math.sin(turn.start.yaw+Math.PI-car.yaw),Math.cos(turn.start.yaw+Math.PI-car.yaw)),remaining:0,deviation:0,arrived:false};
 }
 const sameDirection=location.edge===goal.edge&&location.from===goal.from;
 // A small overshoot calls for braking; require a larger gap to start a loop
 // than to retain one, so noisy positioning does not repeatedly swap routes.
 const alreadyBehind=state.goalKey===`${goal.edge}:${goal.from}:behind`;
 const behind=sameDirection&&goal.distance<location.distance-(alreadyBehind?5:12);
 // Direction and which side of the unit the goal is on both affect the route.
 // Keep the edge-only goal for diagnostics and compatibility.
 const goalKey=`${goal.edge}:${goal.from}:${behind?'behind':'ahead'}`;
 if(time>=state.nextPlan&&(!state.points.length||goalKey!==state.goalKey||state.progress.index>state.points.length-25||state.blocked)){
  const first={edge:location.edge,from:location.from,to:location.to},last={edge:goal.edge,from:goal.from,to:goal.to};
  let route:DirectedRoad[]|null;
  if(first.edge===last.edge&&first.from===last.from&&!behind)route=[first];
  else{
   const excluded=new Set([first.edge,last.edge,...Object.entries(state.blockedRoads??{}).filter(([,until])=>until>time).map(([edge])=>edge)]);
   const middle=first.edge===last.edge&&first.from!==last.from?returningRoute(network,first.to,excluded):shortestRoute(network,first.to,last.from,excluded);
   route=middle?[first,...middle,last]:null;
  }
  if(route){
   try{installRoute(network,state,route,car);state.goal=goal.edge;state.goalKey=goalKey;}
   catch(error){
    // A graph connection may still contain a junction U-turn that our lane
    // geometry cannot drive. Brake and report blocked rather than crash or
    // silently generate an impossible curve.
    if(!(error instanceof Error)||!error.message.includes('U-turn requires a separate maneuver'))throw error;
    state.points=[];state.blocked=true;
   }
  }else{state.points=[];state.blocked=true;}
  state.nextPlan=time+.75;
 }
 state.laneOffset=state.local.offset;
 const control=followNetworkRoute(car,state.points,state.progress,grip,state.laneOffset,4);
 const same=location.edge===goal.edge&&location.from===goal.from;
 // Gap following applies only while directly following on this road. When a
 // target is behind, a loop must first leave the road; braking against the
 // negative direct separation would otherwise prevent the loop from starting.
 if(same&&state.route.length===1){const separation=goal.distance-location.distance;control.speed=Math.min(control.speed,Math.max(0,target.speed+(separation-gap)*.6));}
 const wasLocallyBlocked=state.local.mode==='blocked';
 const local=localNetworkControl(network,state,car,neighbors,time,grip,control,dt,allowOvertake);
 if(local.blocked&&!wasLocallyBlocked&&networkIndex(network).edges.get(location.edge)!.length-location.distance<28){
  const next=state.route[state.route.findIndex(step=>step.edge===location.edge)+1];
  if(next&&next.edge!==goal.edge){state.blockedRoads??={};state.blockedRoads[next.edge]=time+15;state.nextPlan=time;}
 }
 control.speed=local.speed;control.yawError=local.yawError;
 state.blocked=state.points.length===0||control.deviation>20||local.blocked;
 if(state.blocked)control.speed=0;
 return {...control,arrived:!state.blocked&&same&&state.route.length===1&&Math.abs(goal.distance-location.distance-gap)<5&&Math.abs(car.speed-target.speed)<3};
}
