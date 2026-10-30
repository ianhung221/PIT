import type { World, RigidBody, DynamicRayCastVehicleController } from '@dimforge/rapier3d-compat';
import { QueryFilterFlags } from '@dimforge/rapier3d-compat';
import type { VehicleDamage } from '../types/game.ts';
import { vehiclePhysicsConfig, WHEEL_QUERY_GROUPS, type PhysicsVehicleKind } from './vehiclePhysicsConfig.ts';
import { readVehicleFrame, snapshotFromFrame, type VehicleFrame } from './vehiclePose.ts';
import { pristineDamage, vehicleCanContinue } from './vehicleDamage.ts';
import { makeRolloverState, updateRollover, type RolloverState } from './vehicleRollover.ts';

export interface VehiclePedals { throttle:number; brake:number; steer:number; gear:1|-1 }
export interface VehiclePhysics {
  body:RigidBody; world:World; controller:DynamicRayCastVehicleController;
  config:ReturnType<typeof vehiclePhysicsConfig>; lastYaw:number; wheelSteering:number;
  groundedWheels:number; disposed:boolean; disabled:boolean; rollover:RolloverState;
  wheelContact:boolean[]; wheelFriction:number[]; sideStiffness:number; suspensionLengths:number[];
}
const registered=new WeakMap<RigidBody,VehiclePhysics>();
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
export function createVehiclePhysics(world:World,body:RigidBody,kind:PhysicsVehicleKind):VehiclePhysics {
  const existing=registered.get(body);if(existing&&!existing.disposed)return existing;
  const config=vehiclePhysicsConfig(kind),controller=world.createVehicleController(body);
  controller.indexUpAxis=1;controller.setIndexForwardAxis=2;
  for(const z of [config.frontZ,config.rearZ]) for(const x of [-config.track/2,config.track/2]) {
    controller.addWheel({x,y:config.mountY,z},{x:0,y:-1,z:0},{x:-1,y:0,z:0},config.suspension.restLength,config.radius);
    const i=controller.numWheels()-1;
    controller.setWheelSuspensionStiffness(i,config.suspension.stiffness);
    controller.setWheelSuspensionCompression(i,config.suspension.compressionDamping);
    controller.setWheelSuspensionRelaxation(i,config.suspension.relaxationDamping);
    controller.setWheelMaxSuspensionTravel(i,config.suspension.maxTravel);
    controller.setWheelMaxSuspensionForce(i,config.massKg*9.81*2);
  }
  const vehicle={body,world,controller,config,lastYaw:0,wheelSteering:0,groundedWheels:0,disposed:false,disabled:false,rollover:makeRolloverState(),wheelContact:[false,false,false,false],wheelFriction:[NaN,NaN,NaN,NaN],sideStiffness:NaN,suspensionLengths:Array(4).fill(config.suspension.restLength) as number[]};
  registered.set(body,vehicle);return vehicle;
}
export function getVehiclePhysics(body:RigidBody) {return registered.get(body);}
export function removeVehiclePhysics(vehicle:VehiclePhysics) {
  if(vehicle.disposed)return;
  vehicle.world.removeVehicleController(vehicle.controller);vehicle.disposed=true;registered.delete(vehicle.body);
}
export function maximumWheelSteering(kind:PhysicsVehicleKind,speed:number) {
  const maximum=vehiclePhysicsConfig(kind).maxSteer;
  // Input assistance limits wheel demand; tyres still determine actual yaw/slip.
  return maximum/(1+(Math.abs(speed)/14)**1.5);
}
export function vehicleDragAcceleration(speed:number) {return .04*Math.abs(speed)+.004*speed*speed;}
export function stepVehiclePhysics(vehicle:VehiclePhysics,input:VehiclePedals,grip=1,damage:VehicleDamage=pristineDamage(),dt=1/60,observed?:VehicleFrame) {
  if(vehicle.disposed)return;
  const {body,controller:c,config:p}=vehicle,f=observed??readVehicleFrame(body,vehicle.lastYaw);vehicle.lastYaw=f.yaw;
  const speed=f.bodyForwardSpeed,enabled=!vehicle.disabled&&vehicleCanContinue(damage);
  const steer=clamp(input.steer,-1,1)*maximumWheelSteering(p.kind,speed)*damage.steering*damage.alignment;
  const steeringChanged=steer!==vehicle.wheelSteering;
  vehicle.wheelSteering=steer;
  const limit=(input.gear===-1?8:p.maxSpeed)*(.52+damage.engine*.48),cap=clamp((limit-Math.max(0,speed*input.gear))/3,0,1);
  const force=enabled?clamp(input.throttle,0,1)*p.massKg*p.acceleration*(.42+.58*damage.engine)*cap*input.gear:0;
  const health=[damage.frontLeftGrip,damage.frontRightGrip,damage.rearLeftGrip,damage.rearRightGrip];
  const sideStiffness=p.sideStiffness*(.45+.55*damage.alignment);
  for(let i=0;i<4;i++) {
    const friction=p.frictionSlip*grip*(.35+.65*health[i]);
    // Rapier 0.19.2's native straight-line longitudinal demand is not always
    // clipped by frictionSlip (verified even at .001). Bound wheel demand by
    // the last measured normal load, without applying an extra body impulse.
    // One fixed-step load sample also naturally removes drive/braking in air.
    const traction=vehicle.wheelContact[i]?Math.max(0,c.wheelSuspensionForce(i)??0)*friction:0;
    if(i<2&&steeringChanged)c.setWheelSteering(i,-steer);
    c.setWheelEngineForce(i,-clamp(force/4,-traction,traction));
    c.setWheelBrake(i,Math.min(clamp(input.brake,0,1)*p.massKg*12*dt/4,traction*dt));
    if(vehicle.wheelFriction[i]!==friction){c.setWheelFrictionSlip(i,friction);vehicle.wheelFriction[i]=friction;}
    if(vehicle.sideStiffness!==sideStiffness)c.setWheelSideFrictionStiffness(i,sideStiffness);
  }
  vehicle.sideStiffness=sideStiffness;
  // Aerodynamic/rolling approximation is a force, never a velocity/yaw clamp.
  const drag=vehicleDragAcceleration(f.planarSpeed)*body.mass()*dt;
  if(f.planarSpeed>.001)body.applyImpulse({x:-f.velocityX/f.planarSpeed*drag,y:0,z:-f.velocityZ/f.planarSpeed*drag},true);
  c.updateVehicle(dt,QueryFilterFlags.EXCLUDE_SENSORS,WHEEL_QUERY_GROUPS);
  vehicle.groundedWheels=0;for(let i=0;i<4;i++){vehicle.wheelContact[i]=c.wheelIsInContact(i);vehicle.suspensionLengths[i]=c.wheelSuspensionLength(i)??0;if(vehicle.wheelContact[i])vehicle.groundedWheels++;}
}
/** Run after the solver, so suspension rays alone cannot prove a roof is grounded. */
export function sampleVehiclePhysics(vehicle:VehiclePhysics,dt:number,observed?:VehicleFrame) {
  if(vehicle.disposed)return;
  const {body,world}=vehicle,frame=observed??readVehicleFrame(body,vehicle.lastYaw);
  let groundContact=false;
  if(frame.upDot<Math.cos(70*Math.PI/180))for(let i=0;i<body.numColliders();i++) {
    const collider=body.collider(i);
    world.contactPairsWith(collider,other=>{
      if(((other.collisionGroups()>>>16)&1)===0)return;
      world.contactPair(collider,other,manifold=>{if(manifold.numSolverContacts()>0)groundContact=true;});
    });
  }
  updateRollover(vehicle.rollover,{upDot:frame.upDot,groundedWheels:vehicle.groundedWheels,groundContact,
    planarSpeed:frame.planarSpeed,angularSpeed:frame.angularSpeed,verticalSpeed:frame.velocityY},dt);
  vehicle.disabled=vehicle.rollover.disabled;
}
export function physicsSnapshot(vehicle:VehiclePhysics) {
  return physicsSnapshotFromFrame(vehicle,readVehicleFrame(vehicle.body,vehicle.lastYaw));
}
export function physicsSnapshotFromFrame(vehicle:VehiclePhysics,frame:VehicleFrame) {
  vehicle.lastYaw=frame.yaw;
  return snapshotFromFrame(frame,{groundedWheels:vehicle.groundedWheels,rolloverDisabled:vehicle.disabled,
    wheelSteering:vehicle.wheelSteering,suspensionLengths:vehicle.suspensionLengths});
}
