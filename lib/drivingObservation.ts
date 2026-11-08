import type { CarSnapshot } from '../types/game.ts';
import type { RoadNetwork } from './roadNetwork.ts';
import {networkGeometry,surfacePolygon} from './networkGeometry.ts';
import {VEHICLES,SUSPECT} from './gameConfig.ts';

export type DrivingCar=CarSnapshot & {model?:keyof typeof VEHICLES|'suspect';id?:string};
export interface DrivingBox {x:number;z:number;halfX:number;halfZ:number;yaw:number;id?:string}
export const dimensions=(car:DrivingCar)=>car.model==='suspect'?SUSPECT:VEHICLES[car.model??'patrol'];
export const carBox=(car:DrivingCar,padding=0):DrivingBox=>({x:car.x,z:car.z,yaw:car.yaw,halfX:dimensions(car).width/2+padding,halfZ:dimensions(car).length/2+padding});
export function drivingPoint(car:{x:number;z:number;yaw:number},side:number,forward:number){
 return {x:car.x+Math.cos(car.yaw)*side-Math.sin(car.yaw)*forward,z:car.z-Math.sin(car.yaw)*side-Math.cos(car.yaw)*forward};
}
export function relativePosition(car:{x:number;z:number;yaw:number},point:{x:number;z:number}){
 const dx=point.x-car.x,dz=point.z-car.z;
 return {side:dx*Math.cos(car.yaw)-dz*Math.sin(car.yaw),forward:-dx*Math.sin(car.yaw)-dz*Math.cos(car.yaw)};
}
/** Separating-axis footprint check, including the actual headings of both cars. */
export function boxesOverlap(a:DrivingBox,b:DrivingBox){
 const dx=b.x-a.x,dz=b.z-a.z,bound=a.halfX+a.halfZ+b.halfX+b.halfZ;
 if(Math.abs(dx)>=bound||Math.abs(dz)>=bound)return false;
 const ca=Math.cos(a.yaw),sa=Math.sin(a.yaw),cb=Math.cos(b.yaw),sb=Math.sin(b.yaw);
 const c=Math.abs(ca*cb+sa*sb),s=Math.abs(sa*cb-ca*sb);
 return Math.abs(dx*ca-dz*sa)<a.halfX+b.halfX*c+b.halfZ*s
  &&Math.abs(dx*sa+dz*ca)<a.halfZ+b.halfX*s+b.halfZ*c
  &&Math.abs(dx*cb-dz*sb)<b.halfX+a.halfX*c+a.halfZ*s
  &&Math.abs(dx*sb+dz*cb)<b.halfZ+a.halfX*s+a.halfZ*c;
}
const staticIndexes=new WeakMap<RoadNetwork,{count:number;cells:Map<string,DrivingBox[]>;surfaces:Map<string,ReturnType<typeof surfacePolygon>[]>}>();
function staticIndex(n:RoadNetwork){
 let index=staticIndexes.get(n);if(index&&index.count===n.objects.length)return index;
 const geometry=networkGeometry(n),cells=new Map<string,DrivingBox[]>();
 for(const object of [...geometry.walls,...n.objects]){
  const box={...object,yaw:0};
  for(let x=Math.floor((box.x-box.halfX)/64);x<=Math.floor((box.x+box.halfX)/64);x++)for(let z=Math.floor((box.z-box.halfZ)/64);z<=Math.floor((box.z+box.halfZ)/64);z++){
   const key=`${x},${z}`,list=cells.get(key)??[];list.push(box);cells.set(key,list);
  }
 }
 const surfaces=new Map<string,ReturnType<typeof surfacePolygon>[]>();
 for(const surface of geometry.surfaces){
  const poly=surfacePolygon(surface.section),xs=poly.map(p=>p.x),zs=poly.map(p=>p.z);
  for(let x=Math.floor(Math.min(...xs)/64);x<=Math.floor(Math.max(...xs)/64);x++)for(let z=Math.floor(Math.min(...zs)/64);z<=Math.floor(Math.max(...zs)/64);z++){
   const key=`${x},${z}`,list=surfaces.get(key)??[];list.push(poly);surfaces.set(key,list);
  }
 }
 index={count:n.objects.length,cells,surfaces};staticIndexes.set(n,index);return index;
}
export function nearbyDrivingObjects(n:RoadNetwork,car:{x:number;z:number},radius=80){
 const cells=staticIndex(n).cells,result=new Set<DrivingBox>();
 for(let x=Math.floor((car.x-radius)/64);x<=Math.floor((car.x+radius)/64);x++)for(let z=Math.floor((car.z-radius)/64);z<=Math.floor((car.z+radius)/64);z++)for(const box of cells.get(`${x},${z}`)??[])result.add(box);
 return [...result].filter(o=>Math.abs(o.x-car.x)<=radius+o.halfX&&Math.abs(o.z-car.z)<=radius+o.halfZ);
}
export function drivingFootprintOnRoad(n:RoadNetwork,box:DrivingBox){
 const cells=staticIndex(n).surfaces;
 return [-1,0,1].every(side=>[-1,0,1].every(forward=>{
  const p=drivingPoint(box,side*box.halfX,forward*box.halfZ);
  return (cells.get(`${Math.floor(p.x/64)},${Math.floor(p.z/64)}`)??[]).some(poly=>poly.every((a,i)=>{const b=poly[(i+1)%poly.length];return (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x)>=-1e-6;}));
 }));
}
function lineBlocked(a:{x:number;z:number},b:{x:number;z:number},box:DrivingBox){
 const start=relativePosition(box,a),end=relativePosition(box,b);let lo=0,hi=1;
 for(const [p,q,h] of [[start.side,end.side,box.halfX],[start.forward,end.forward,box.halfZ]]){
  const delta=q-p;
  if(Math.abs(delta)<1e-9){if(Math.abs(p)>h)return false;continue;}
  let t1=(-h-p)/delta,t2=(h-p)/delta;if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return false;
 }
 return hi>.01&&lo<.99;
}
export interface DrivingObservation {at:number;cars:DrivingCar[];objects:DrivingBox[]}
/** Position/velocity snapshots only: no input keys, future route or remote actors. */
export function observeDriving(n:RoadNetwork,car:DrivingCar,others:DrivingCar[],time:number,range=80):DrivingObservation{
 const objects=nearbyDrivingObjects(n,car,range);
 const cars=others.filter(other=>Math.hypot(other.x-car.x,other.z-car.z)<=range&&!objects.some(o=>lineBlocked(car,other,o))).map(c=>({...c}));
 return {at:time,cars,objects};
}
