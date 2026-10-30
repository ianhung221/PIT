import type { VehicleDamage } from '../types/game.ts';
import { pristineDamage } from './vehicleDamage.ts';
import { readVehicleFrame, type VehicleFrame } from './vehiclePose.ts';
import { maximumWheelSteering,stepVehiclePhysics,vehicleDragAcceleration,type VehiclePedals,type VehiclePhysics } from './vehiclePhysics.ts';

export interface VehicleTarget {speed:number;yawError:number;maxSpeed?:number}
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
/** Convert a driver's desired heading/speed into pedals. Never writes chassis
 * velocity or orientation; forward and reverse use the same tyre geometry. */
export function vehicleTargetPedals(vehicle:VehiclePhysics,target:VehicleTarget,observed?:VehicleFrame):VehiclePedals {
  const frame=observed??readVehicleFrame(vehicle.body,vehicle.lastYaw),p=vehicle.config;
  const speed=frame.bodyForwardSpeed;
  const wanted=clamp(target.speed,-6,Math.min(target.maxSpeed??p.maxSpeed,p.maxSpeed));
  const gear:1|-1=wanted<-.05?-1:wanted>.05?1:speed<0?-1:1;
  const signedSpeed=(Math.abs(speed)>.6?Math.sign(speed):gear)*Math.max(2,Math.abs(speed));
  const desiredRate=clamp(target.yawError*1.8-frame.angularVelocity.y*.25,-.8,.8);
  const wheelAngle=-Math.atan(p.wheelbase*desiredRate/signedSpeed);
  const steer=clamp(wheelAngle/maximumWheelSteering(p.kind,speed),-1,1);
  if(Math.abs(wanted)<.05)return {throttle:0,brake:clamp(Math.abs(speed)*2/12,.25,1),steer,gear};
  if(speed*gear<-.2)return {throttle:0,brake:clamp(Math.abs(speed)*2/12,.35,1),steer,gear};
  const acceleration=(Math.abs(wanted)-speed*gear)*2+vehicleDragAcceleration(Math.abs(speed));
  return {throttle:clamp(acceleration/p.acceleration,0,1),brake:clamp(-acceleration/12,0,1),steer,gear};
}
export function driveVehicleTarget(vehicle:VehiclePhysics,target:VehicleTarget,grip=1,damage:VehicleDamage=pristineDamage(),dt=1/60,observed?:VehicleFrame) {
  const frame=observed??readVehicleFrame(vehicle.body,vehicle.lastYaw);
  const pedals=vehicleTargetPedals(vehicle,target,frame);
  stepVehiclePhysics(vehicle,pedals,grip,damage,dt,frame);
  return pedals;
}
