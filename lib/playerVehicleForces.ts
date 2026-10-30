import type { RapierRigidBody } from '@react-three/rapier';
import { stepPlayerDriving, type PlayerDriving } from './playerDriving.ts';
import { steeringInput } from './gameRules.ts';
import { vehicleCanContinue, playerVehicleStatus } from './vehicleDamage.ts';
import type { VehicleDamage } from '../types/game.ts';
import { VEHICLES, type VehicleId } from './gameConfig.ts';
import { getVehiclePhysics,stepVehiclePhysics,type VehiclePedals } from './vehiclePhysics.ts';
import { readVehicleFrame, type VehicleFrame } from './vehiclePose.ts';
export type DrivingFrame={forwardX:number;forwardZ:number;rightX:number;rightZ:number;velocityX:number;velocityZ:number;forwardSpeed:number;lateralSpeed:number};

/** Keyboard/cruise interpretation shared by both modes; only tyres steer the body. */
export function applyPlayerForces(player:RapierRigidBody,frame:DrivingFrame,driving:PlayerDriving,damage:VehicleDamage,keys:Set<string>,vehicle:VehicleId,grip:number,dt:number,observed?:VehicleFrame) {
  const core=getVehiclePhysics(player);if(!core)return;
  const spec=VEHICLES[vehicle],canDrive=vehicleCanContinue(damage)&&!core.disabled;
  const throttle=keys.has('arrowup')||keys.has('w'),brake=keys.has('arrowdown')||keys.has('s');
  const steer=steeringInput(keys.has('arrowleft')||keys.has('a'),keys.has('arrowright')||keys.has('d'));
  driving.input={up:throttle,down:brake,left:keys.has('arrowleft')||keys.has('a'),right:keys.has('arrowright')||keys.has('d')};
  driving.vehicleStatus=playerVehicleStatus(damage);
  const physicalFrame=observed??readVehicleFrame(player,core.lastYaw);
  driving.physics={groundedWheels:core.groundedWheels,tilt:physicalFrame.tilt,wheelSteering:core.wheelSteering,rolloverDisabled:core.disabled};
  if(core.disabled)driving.vehicleStatus={...driving.vehicleStatus,driveable:false,reason:'穩定翻覆：動力不可用；P 暫停後可返回設定，練習場可重設'};
  const acceleration=spec.acceleration*(.42+damage.engine*.58);
  stepPlayerDriving(driving,{throttle,brake,steer},frame.forwardSpeed,spec.maxSpeed*(.52+damage.engine*.48),acceleration,canDrive,dt);
  const pedals:VehiclePedals={throttle:driving.throttle,brake:0,steer:driving.steering,gear:1};
  if(brake){
    pedals.throttle=0;
    if(!canDrive||frame.forwardSpeed>.8)pedals.brake=1;
    else {pedals.gear=-1;pedals.throttle=1;}
  }else if(throttle&&frame.forwardSpeed<-.8){pedals.throttle=0;pedals.brake=1;}
  stepVehiclePhysics(core,pedals,grip,damage,dt,physicalFrame);
}
