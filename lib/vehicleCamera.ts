import type { VehicleId } from './gameConfig.ts';
import type { CarSnapshot,VehicleVector3 } from '../types/game.ts';
import { vehicleWorldPoint,rotateVehicleVector,snapshotQuaternion } from './vehiclePose.ts';

export const driverEyeHeight=(vehicle:VehicleId)=>vehicle==='interceptor'?.52:vehicle==='suv'?1:.86;
export function vehicleCameraFrame(car:CarSnapshot,anchor:VehicleVector3,direction:VehicleVector3) {
  const position=vehicleWorldPoint(car,anchor);
  const target=vehicleWorldPoint(car,{x:anchor.x+direction.x,y:anchor.y+direction.y,z:anchor.z+direction.z});
  const up=rotateVehicleVector({x:0,y:1,z:0},snapshotQuaternion(car));
  return {position,target,up};
}
export function driverCameraFrame(car:CarSnapshot,vehicle:VehicleId,rear=false) {
  return vehicleCameraFrame(car,{x:-.38,y:driverEyeHeight(vehicle),z:-.2},{x:0,y:-.04,z:rear?18:-18});
}
export function mirrorCameraFrame(car:CarSnapshot,vehicle:VehicleId,index:number) {
  const height=driverEyeHeight(vehicle),side=[0,-.82,.82][index],angle=[0,-.36,.36][index];
  return vehicleCameraFrame(car,{x:side,y:height+(index===0?.16:-.04),z:index===0?-.05:-.2},
    {x:Math.sin(angle)*28,y:-.2,z:Math.cos(angle)*28});
}
