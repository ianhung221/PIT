import type {RoadNetwork} from './roadNetwork.ts';
import {boxesOverlap,carBox,drivingFootprintOnRoad,drivingPoint,nearbyDrivingObjects,type DrivingCar} from './drivingObservation.ts';

const staticAreas=new WeakMap<DrivingCar,{network:RoadNetwork;count:number;boxes:{x:number;z:number;yaw:number;halfX:number;halfZ:number}[];clear:boolean}>();

/** Conservative rectangle covering a slow left U-turn from the normal lane.
 * Radius and padding deliberately overestimate the measured wheel-driven path;
 * an unavailable or occupied area is rejected rather than forcing a turn. */
export function turnaroundAreaClear(network:RoadNetwork,start:DrivingCar,neighbors:DrivingCar[]){
 let cached=staticAreas.get(start);
 if(!cached||cached.network!==network||cached.count!==network.objects.length){
  const base=carBox(start,.35),radius=Math.hypot(base.halfX,base.halfZ)+.55,objects=nearbyDrivingObjects(network,start,32),boxes=[];
  let clear=true;
  for(let side=-9;side<=.001;side+=1)for(let forward=-2;forward<=4;forward+=1){
   const p=drivingPoint(start,side,forward),box={...p,yaw:start.yaw,halfX:radius,halfZ:radius};boxes.push(box);
   if(!drivingFootprintOnRoad(network,box)||objects.some(o=>boxesOverlap(box,o)))clear=false;
  }
  cached={network,count:network.objects.length,boxes,clear};staticAreas.set(start,cached);
 }
 if(!cached.clear)return false;
 const others=neighbors.flatMap(other=>{
  const padding=.35+Math.hypot(other.speed,other.lateralSpeed)*.5;
  return Array.from({length:9},(_,t)=>({...carBox(other,padding),...drivingPoint(other,other.lateralSpeed*t,other.speed*t)}));
 });
 // Relative to the starting car, physical probes at 1–1.5 m/s stayed inside
 // side [-8.4,0] and forward [-1.2,3.1] on dry and snowy roads.
 for(const box of cached.boxes)if(others.some(o=>boxesOverlap(box,o)))return false;
 return true;
}
