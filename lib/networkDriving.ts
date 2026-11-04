import type { CarSnapshot } from '../types/game.ts';
import type { RoutePoint } from './roadRouting.ts';
export interface RouteProgress { index: number }
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const angle=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const routeMetrics=new WeakMap<RoutePoint[],{segments:{dx:number;dz:number;length:number;length2:number}[];speeds:Map<string,number[]>}>();
function metrics(points:RoutePoint[]){
 let value=routeMetrics.get(points);if(value)return value;
 value={segments:points.slice(0,-1).map((a,i)=>{const dx=points[i+1].x-a.x,dz=points[i+1].z-a.z;return {dx,dz,length:Math.hypot(dx,dz),length2:dx*dx+dz*dz};}),speeds:new Map()};
 routeMetrics.set(points,value);return value;
}
/** Steering/speed targets only; the shared wheel physics still moves the chassis. */
export function followNetworkRoute(car:CarSnapshot,points:RoutePoint[],progress:RouteProgress,grip=1,laneOffset=0,cruiseBoost=0){
 if(points.length<2)return {speed:0,yawError:0,remaining:0,deviation:Infinity};
 const geometry=metrics(points);
 let nearest=progress.index,best=Infinity,along=0;
 for(let i=Math.max(0,progress.index-2);i<Math.min(points.length-1,progress.index+35);i++){
  const a=points[i],{dx,dz,length2:len2}=geometry.segments[i];
  const t=len2?clamp(((car.x-a.x)*dx+(car.z-a.z)*dz)/len2,0,1):0;
  const distance=(car.x-a.x-dx*t)**2+(car.z-a.z-dz*t)**2;
  if(distance<best){best=distance;nearest=i;along=t;}
 }
 progress.index=nearest;
 best=Math.sqrt(best);
 let remainingLook=clamp(3+Math.abs(car.speed)*.5,4,17),target=points[points.length-1];
 for(let i=nearest;i<points.length-1;i++){
  const a=points[i],b=points[i+1],start=i===nearest?along:0,length=geometry.segments[i].length*(1-start);
  if(remainingLook<=length){const t=start+(1-start)*remainingLook/Math.max(.001,length);target={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,speed:a.speed};break;}
  remainingLook-=length;
 }
 const pace=(p:RoutePoint)=>p.speed+(p.speed>=14?cruiseBoost:0);
 const key=`${grip}:${cruiseBoost}`,speeds=geometry.speeds.get(key)??[];
 if(!geometry.speeds.has(key))geometry.speeds.set(key,speeds);
 if(speeds[nearest]===undefined){
  let planned=pace(points[nearest]),distance=0;
  for(let i=nearest;i<points.length-1&&distance<260;i++){
   planned=Math.min(planned,Math.sqrt((pace(points[i])*Math.sqrt(grip))**2+2*3*grip*distance));
   distance+=geometry.segments[i].length;
  }
  speeds[nearest]=planned;
 }
 let speed=speeds[nearest];
 const last=points[points.length-1],remaining=Math.hypot(car.x-last.x,car.z-last.z);
 if(nearest>points.length-8)speed=Math.min(speed,Math.sqrt(Math.max(0,remaining-2)*4));
 if(points[nearest].speed>=14&&target.speed>=14&&laneOffset){const a=points[nearest],b=points[nearest+1],length=Math.hypot(b.x-a.x,b.z-a.z);if(length>.01)target={...target,x:target.x-(b.z-a.z)/length*laneOffset,z:target.z+(b.x-a.x)/length*laneOffset};}
 const yawError=angle(Math.atan2(-(target.x-car.x),-(target.z-car.z))-car.yaw);
 speed=Math.min(speed,Math.max(3,12/(1+Math.abs(yawError)*3))+(Math.abs(yawError)<.12?25:0));
 if(best>12)speed=Math.min(speed,5);
 return {speed,yawError,remaining,deviation:best};
}
