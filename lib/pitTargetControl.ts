import type { RapierRigidBody } from '@react-three/rapier';
import type { VehicleDamage } from '../types/game.ts';
import type { DrivingFrame } from './playerVehicleForces.ts';
import {getVehiclePhysics,stepVehiclePhysics} from './vehiclePhysics.ts';
// Candidate evaluation keeps passive tyre forces, with no throttle, brake or
// active steering. Both modes use the identical chassis/wheel implementation.
export function applyPitTargetControl(body:RapierRigidBody,_frame:DrivingFrame,damage:VehicleDamage,grip:number,dt:number) {
  const core=getVehiclePhysics(body);if(!core)return;
  stepVehiclePhysics(core,{throttle:0,brake:0,steer:0,gear:1},grip,damage,dt);
}
