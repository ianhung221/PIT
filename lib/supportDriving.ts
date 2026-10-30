import type { RigidBody } from '@dimforge/rapier3d-compat';
import { getVehiclePhysics } from './vehiclePhysics.ts';
import { driveVehicleTarget } from './vehicleDriver.ts';
import type { VehicleFrame } from './vehiclePose.ts';

interface DrivingFrame {forwardSpeed:number}
// Keep the simulation call shape while all actors migrate to the shared core.
// The body must be registered by VehiclePhysicsBody (or the physical test helper).
export function driveSupport(body:RigidBody,yawError:number,targetSpeed:number,maxSpeed:number,dt:number,grip:number,frame?:DrivingFrame|VehicleFrame) {
  const vehicle=getVehiclePhysics(body);
  if(!vehicle)return;
  driveVehicleTarget(vehicle,{speed:targetSpeed,yawError,maxSpeed},grip,undefined,dt,frame&&'quaternion' in frame?frame:undefined);
}
