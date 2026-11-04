import {networkIndex,otherEnd,type RoadNetwork} from './roadNetwork.ts';
import {locateRoad,type RoadLocation} from './roadLocation.ts';
import {routePoints,shortestRoute,returningRoute,type DirectedRoad,type RoutePoint} from './roadRouting.ts';
import {followNetworkRoute} from './networkDriving.ts';
import {createSeededRandom} from './seededRandom.ts';
import type {CarSnapshot} from '../types/game.ts';

export interface NetworkDriver {
 location?:RoadLocation;route:DirectedRoad[];points:RoutePoint[];progress:{index:number};nextPlan:number;
 random:()=>number;goal:string;blocked:boolean;laneOffset:number;lastTime:number;
}
export const makeNetworkDriver=(seed:string):NetworkDriver=>({route:[],points:[],progress:{index:0},nextPlan:0,random:createSeededRandom(seed),goal:'',blocked:false,laneOffset:0,lastTime:0});
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
export function escapeRoute(network:RoadNetwork,state:NetworkDriver,car:CarSnapshot,time:number,grip:number,laneOffset=0){
 state.location=locateRoad(network,car,state.location);
 if(!state.points.length||state.progress.index>state.points.length-35||time>=state.nextPlan&&state.blocked){
  const index=networkIndex(network),location=state.location;
  const route:DirectedRoad[]=[{edge:location.edge,from:location.from,to:location.to}];
  let last=route[0];
  for(let i=0;i<14;i++){
   const choices=index.exits.get(last.to)!.filter(e=>e.id!==last.edge);
   if(!choices.length)break;
   const weighted=choices.flatMap(e=>e.biome==='city'?[e]:[e,e]);
   const edge=weighted[Math.floor(state.random()*weighted.length)];
   last={edge:edge.id,from:last.to,to:otherEnd(edge,last.to)};route.push(last);
  }
  installRoute(network,state,route,car);state.nextPlan=time+2;
 }
 const dt=Math.max(0,Math.min(.1,time-state.lastTime));state.lastTime=time;
 const wanted=Math.max(-1.4,Math.min(1.4,laneOffset));state.laneOffset+=Math.max(-dt*.8,Math.min(dt*.8,wanted-state.laneOffset));
 const control=followNetworkRoute(car,state.points,state.progress,grip,state.laneOffset);
 state.blocked=control.deviation>20;
 if(state.blocked)control.speed=0;
 return control;
}

/** Follow a reachable road corridor; missing routes brake rather than cross scenery. */
export function chaseRoute(network:RoadNetwork,state:NetworkDriver,car:CarSnapshot,target:CarSnapshot,time:number,grip:number,gap=15,neighbors:CarSnapshot[]=[]){
 state.location=locateRoad(network,car,state.location);const goal=locateRoad(network,target),location=state.location;
 if(time>=state.nextPlan&&(!state.points.length||goal.edge!==state.goal||state.progress.index>state.points.length-25||state.blocked)){
  const first={edge:location.edge,from:location.from,to:location.to},last={edge:goal.edge,from:goal.from,to:goal.to};
  let route:DirectedRoad[]|null;
  if(first.edge===last.edge&&first.from===last.from)route=[first];
  else{
   const excluded=new Set([first.edge,last.edge]);
   const middle=first.edge===last.edge?returningRoute(network,first.to,excluded):shortestRoute(network,first.to,last.from,excluded);
   route=middle?[first,...middle,last]:null;
  }
  if(route){installRoute(network,state,route,car);state.goal=goal.edge;}else{state.points=[];state.blocked=true;}
  state.nextPlan=time+.75;
 }
 const index=networkIndex(network),edge=index.edges.get(location.edge)!;
 const slowObstacle=neighbors.some(other=>{
  const dx=other.x-car.x,dz=other.z-car.z,ahead=-dx*Math.sin(car.yaw)-dz*Math.cos(car.yaw),side=dx*Math.cos(car.yaw)-dz*Math.sin(car.yaw);
  return other!==target&&Math.abs(other.speed)<2&&ahead>-6&&ahead<55&&Math.abs(side)<5;
 });
 const opposing=neighbors.some(other=>Math.hypot(other.x-car.x,other.z-car.z)<65&&Math.cos(other.yaw-car.yaw)<-.4);
 const wantsPass=slowObstacle&&!opposing&&!location.nearJunction&&edge.width>=12&&Math.hypot(car.x-target.x,car.z-target.z)>30;
 const dt=Math.max(0,Math.min(.1,time-state.lastTime));state.lastTime=time;
 const wanted=wantsPass?-4:0;state.laneOffset+=Math.max(-dt*2,Math.min(dt*2,wanted-state.laneOffset));
 const control=followNetworkRoute(car,state.points,state.progress,grip,state.laneOffset,4);
 if(Math.abs(state.laneOffset)>.2)control.speed=Math.min(control.speed,10);
 const same=location.edge===goal.edge&&location.from===goal.from;
 if(same){const separation=goal.distance-location.distance;control.speed=Math.min(control.speed,Math.max(0,target.speed+(separation-gap)*.6));}
 state.blocked=state.points.length===0||control.deviation>20;
 if(state.blocked)control.speed=0;
 for(const other of neighbors){const dx=other.x-car.x,dz=other.z-car.z,ahead=-dx*Math.sin(car.yaw)-dz*Math.cos(car.yaw),side=Math.abs(dx*Math.cos(car.yaw)-dz*Math.sin(car.yaw));
  const margin=Math.abs(state.laneOffset)>.3?6:8;
  if(ahead>0&&side<2.5&&ahead<8+Math.max(0,car.speed)*.8)control.speed=Math.min(control.speed,Math.max(0,other.speed*Math.cos(other.yaw-car.yaw)+(ahead-margin)*.6));
 }
 return {...control,arrived:same&&Math.abs(goal.distance-location.distance-gap)<5&&Math.abs(car.speed-target.speed)<3};
}
