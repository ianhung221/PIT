import type { RapierRigidBody } from '@react-three/rapier';
import type { VehicleDamage } from '../types/game.ts';
import type { DrivingFrame } from './playerVehicleForces.ts';
// The V2 mission candidate controller: coast longitudinally, preserve impact
// yaw, and apply only reduced tyre lateral correction. Shared by both modes.
export function applyPitTargetControl(body:RapierRigidBody,frame:DrivingFrame,damage:VehicleDamage,grip:number,dt:number) {
  const tyre=(damage.frontLeftGrip+damage.frontRightGrip+damage.rearLeftGrip+damage.rearRightGrip)/4;
  const lateral=-frame.lateralSpeed*body.mass()*Math.min(1,grip*tyre*7*dt*.18);
  body.applyImpulse({x:frame.rightX*lateral,y:0,z:frame.rightZ*lateral},true);
}
