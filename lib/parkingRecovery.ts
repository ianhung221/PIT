import type {CarSnapshot,GeneratedRoad} from '../types/game.ts';
import {boxesOverlap,carBox,drivingFootprintOnRoad,drivingPoint,nearbyDrivingObjects,type DrivingCar} from './drivingObservation.ts';
import {locateRoad} from './roadLocation.ts';
import {networkIndex} from './roadNetwork.ts';

/** Conservative clearance envelope for a bounded forward parking correction. */
export function parkingRecoveryClear(road:GeneratedRoad,anchor:{x:number;z:number;yaw:number},car:DrivingCar,neighbors:DrivingCar[]){
 const network=road.network;if(!network)return false;
 if(Math.abs(Math.atan2(Math.sin(car.yaw-anchor.yaw),Math.cos(car.yaw-anchor.yaw)))>.65)return false;
 const dx=car.x-anchor.x,dz=car.z-anchor.z,side=dx*Math.cos(anchor.yaw)-dz*Math.sin(anchor.yaw);
 const forward=-dx*Math.sin(anchor.yaw)-dz*Math.cos(anchor.yaw);
 const minSide=Math.min(side,0)-.35,maxSide=Math.max(side,0)+.35;
 const sideSteps=Math.max(1,Math.ceil((maxSide-minSide)/1.2)),forwardSteps=8;
 const objects=nearbyDrivingObjects(network,car,32),others=neighbors.flatMap(other=>[0,2,4].map(t=>({...carBox(other,.35),...drivingPoint(other,other.lateralSpeed*t,other.speed*t)})));
 for(let i=0;i<=sideSteps;i++)for(let j=0;j<=forwardSteps;j++)for(const turn of [-.65,0,.65]){
  const p=drivingPoint(anchor,minSide+(maxSide-minSide)*i/sideSteps,forward+16*j/forwardSteps);
  const box=carBox({...car,...p,yaw:anchor.yaw+turn},.35);
  const paved=drivingFootprintOnRoad(network,box);
  // Match the existing local parking limit on the map's flat shoulder.
  // Real walls and other physical objects remain independent blockers.
  const location=paved?null:locateRoad(network,box),edge=location?networkIndex(network).edges.get(location.edge):null;
  const shoulder=!!location&&!!edge&&edge.width>=10&&location.deviation+Math.max(box.halfX,box.halfZ)<edge.width/2+3;
  if(!paved&&!shoulder||objects.some(o=>boxesOverlap(box,o))||others.some(o=>boxesOverlap(box,o)))return false;
 }
 return true;
}
export function parkingRecoveryControl(anchor:{x:number;z:number;yaw:number},car:CarSnapshot,phase:'shift'|'align',sideSign:number){
 const dx=car.x-anchor.x,dz=car.z-anchor.z,side=dx*Math.cos(anchor.yaw)-dz*Math.sin(anchor.yaw);
 const target=phase==='shift'?anchor.yaw+sideSign*.5:anchor.yaw;
 return {side,speed:2,yawError:Math.atan2(Math.sin(target-car.yaw),Math.cos(target-car.yaw))};
}
