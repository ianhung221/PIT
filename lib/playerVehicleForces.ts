import type { RapierRigidBody } from '@react-three/rapier';
import { stepPlayerDriving, playerTurnRate, type PlayerDriving } from './playerDriving.ts';
import { steeringInput } from './gameRules.ts';
import { vehicleCanContinue, vehicleDriveability } from './vehicleDamage.ts';
import type { VehicleDamage } from '../types/game.ts';
import { VEHICLES, type VehicleId } from './gameConfig.ts';
export type DrivingFrame={forwardX:number;forwardZ:number;rightX:number;rightZ:number;velocityX:number;velocityZ:number;forwardSpeed:number;lateralSpeed:number};
// Exact extraction of V2 batch 6 forces. Do not tune one mode independently.
export function applyPlayerForces(player:RapierRigidBody, frame:DrivingFrame, driving:PlayerDriving, damage:VehicleDamage, keys:Set<string>, vehicle:VehicleId, grip:number, dt:number) {
  const spec=VEHICLES[vehicle], mass=player.mass();
  const throttle=keys.has('arrowup')||keys.has('w'),brake=keys.has('arrowdown')||keys.has('s');
  const steer=steeringInput(keys.has('arrowleft')||keys.has('a'),keys.has('arrowright')||keys.has('d'));
  const acceleration=spec.acceleration*grip*(.42+vehicleDriveability(damage)*.58);
  stepPlayerDriving(driving,{throttle,brake,steer},frame.forwardSpeed,spec.maxSpeed*(.52+damage.engine*.48),acceleration,vehicleCanContinue(damage),dt);
  if(driving.throttle>0) {
    const force=acceleration*driving.throttle;
    player.applyImpulse({x:frame.forwardX*mass*force*dt,y:0,z:frame.forwardZ*mass*force*dt},true);
  }
  if(brake) {
    const braking=frame.forwardSpeed>.8?-Math.min(frame.forwardSpeed,24*grip*dt):-7*grip*dt;
    player.applyImpulse({x:frame.forwardX*mass*braking,y:0,z:frame.forwardZ*mass*braking},true);
  }
  const correction=-frame.lateralSpeed*mass*Math.min(1,grip*8*dt*(.45+damage.alignment*.55));
  player.applyImpulse({x:frame.rightX*correction,y:0,z:frame.rightZ*correction},true);
  player.applyImpulse({x:-frame.velocityX*mass*.12*dt,y:0,z:-frame.velocityZ*mass*.12*dt},true);
  const desired=playerTurnRate(driving.steering,frame.forwardSpeed,spec.steering*grip*damage.steering*damage.alignment);
  const angular=player.angvel();
  player.setAngvel({x:0,y:angular.y+(desired-angular.y)*Math.min(1,dt*8),z:0},true);
  const velocity=player.linvel(),limit=spec.maxSpeed*(.52+damage.engine*.48),speed=Math.hypot(velocity.x,velocity.z);
  if(speed>limit) player.setLinvel({x:velocity.x*limit/speed,y:0,z:velocity.z*limit/speed},true);
}
