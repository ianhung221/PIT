import type { CarSnapshot, VehiclePose, VehicleQuaternion, VehicleVector3 } from '../types/game.ts';

// Structural interface works with the identical Node and browser Rapier engine
// without importing Three or requiring a React hook in physical tests.
export interface VehiclePoseBody {
  translation(): VehicleVector3;
  rotation(): VehicleQuaternion;
  linvel(): VehicleVector3;
  angvel(): VehicleVector3;
}
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const dot=(a:VehicleVector3,b:VehicleVector3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const validQuaternion=(q:VehicleQuaternion)=>[q.x,q.y,q.z,q.w].every(Number.isFinite)&&Math.hypot(q.x,q.y,q.z,q.w)>1e-9;

export function normalizedVehicleQuaternion(q:VehicleQuaternion):VehicleQuaternion {
  if(!validQuaternion(q))return {x:0,y:0,z:0,w:1};
  const length=Math.hypot(q.x,q.y,q.z,q.w);
  return {x:q.x/length,y:q.y/length,z:q.z/length,w:q.w/length};
}

export function rotateVehicleVector(v:VehicleVector3,rotation:VehicleQuaternion):VehicleVector3 {
  const q=normalizedVehicleQuaternion(rotation);
  const tx=2*(q.y*v.z-q.z*v.y),ty=2*(q.z*v.x-q.x*v.z),tz=2*(q.x*v.y-q.y*v.x);
  return {x:v.x+q.w*tx+q.y*tz-q.z*ty,y:v.y+q.w*ty+q.z*tx-q.x*tz,z:v.z+q.w*tz+q.x*ty-q.y*tx};
}

export function inverseRotateVehicleVector(v:VehicleVector3,q:VehicleQuaternion):VehicleVector3 {
  return rotateVehicleVector(v,{x:-q.x,y:-q.y,z:-q.z,w:q.w});
}

export function readVehicleFrame(body:VehiclePoseBody,lastYaw=0) {
  const position=body.translation(),raw=body.rotation(),quaternion=normalizedVehicleQuaternion(raw);
  // The quaternion was normalized above. Build its basis once instead of
  // allocating and normalizing it again for each of the three unit vectors.
  const {x:qx,y:qy,z:qz,w:qw}=quaternion;
  const forward={x:-2*(qx*qz+qy*qw),y:-2*(qy*qz-qx*qw),z:-(1-2*(qx*qx+qy*qy))};
  const right={x:1-2*(qy*qy+qz*qz),y:2*(qx*qy+qz*qw),z:2*(qx*qz-qy*qw)};
  const up={x:2*(qx*qy-qz*qw),y:1-2*(qx*qx+qz*qz),z:2*(qy*qz+qx*qw)};
  const velocity=body.linvel(),angularVelocity=body.angvel();
  const upDot=clamp(up.y,-1,1),projection=Math.hypot(forward.x,forward.z);
  // At large pitch/roll the physical orientation remains fully available, but
  // its planar heading is unsuitable evidence for a PIT yaw measurement.
  const headingValid=validQuaternion(raw)&&projection>.2&&upDot>Math.cos(70*Math.PI/180);
  const yaw=headingValid?Math.atan2(-forward.x,-forward.z):(Number.isFinite(lastYaw)?lastYaw:0);
  const planarForward={x:-Math.sin(yaw),y:0,z:-Math.cos(yaw)};
  const planarRight={x:Math.cos(yaw),y:0,z:-Math.sin(yaw)};
  return {
    x:position.x,y:position.y,z:position.z,yaw,quaternion,forward,right,up,velocity,angularVelocity,
    forwardX:forward.x,forwardY:forward.y,forwardZ:forward.z,
    rightX:right.x,rightY:right.y,rightZ:right.z,
    velocityX:velocity.x,velocityY:velocity.y,velocityZ:velocity.z,
    // Existing gameplay consumers keep horizontal speeds; suspension/tyre
    // controllers may explicitly use the separate full body-axis velocities.
    forwardSpeed:dot(velocity,planarForward),lateralSpeed:dot(velocity,planarRight),
    bodyForwardSpeed:dot(velocity,forward),bodyLateralSpeed:dot(velocity,right),
    planarSpeed:Math.hypot(velocity.x,velocity.z),angularSpeed:Math.hypot(angularVelocity.x,angularVelocity.y,angularVelocity.z),
    upDot,tilt:Math.acos(upDot),headingValid,
  };
}
export type VehicleFrame=ReturnType<typeof readVehicleFrame>;
export type VehiclePoseOverrides=Partial<Pick<VehiclePose,'groundedWheels'|'rolloverDisabled'|'wheelSteering'|'suspensionLengths'>>;

export function snapshotFromFrame(frame:VehicleFrame,overrides:VehiclePoseOverrides={}):CarSnapshot {
  return {x:frame.x,z:frame.z,yaw:frame.yaw,speed:frame.forwardSpeed,lateralSpeed:frame.lateralSpeed,
    pose:{y:frame.y,quaternion:{...frame.quaternion},upDot:frame.upDot,tilt:frame.tilt,headingValid:frame.headingValid,
      groundedWheels:overrides.groundedWheels??0,angularSpeed:frame.angularSpeed,rolloverDisabled:overrides.rolloverDisabled??false,
      ...(overrides.wheelSteering!==undefined?{wheelSteering:overrides.wheelSteering}:{}),
      ...(overrides.suspensionLengths?{suspensionLengths:[...overrides.suspensionLengths]}:{}),
    }};
}

export function vehicleSnapshot(body:VehiclePoseBody,lastYaw=0,overrides:VehiclePoseOverrides={}):CarSnapshot {
  return snapshotFromFrame(readVehicleFrame(body,lastYaw),overrides);
}

type SnapshotTransform=Pick<CarSnapshot,'x'|'z'|'yaw'|'pose'>;
export function snapshotQuaternion(car:Pick<CarSnapshot,'yaw'|'pose'>):VehicleQuaternion {
  return car.pose?normalizedVehicleQuaternion(car.pose.quaternion):{x:0,y:Math.sin(car.yaw/2),z:0,w:Math.cos(car.yaw/2)};
}

export function vehicleWorldPoint(car:SnapshotTransform,local:VehicleVector3):VehicleVector3 {
  const point=rotateVehicleVector(local,snapshotQuaternion(car));
  return {x:car.x+point.x,y:(car.pose?.y??.02)+point.y,z:car.z+point.z};
}

export function vehicleLocalPoint(car:SnapshotTransform,world:VehicleVector3):VehicleVector3 {
  return inverseRotateVehicleVector({x:world.x-car.x,y:world.y-(car.pose?.y??.02),z:world.z-car.z},snapshotQuaternion(car));
}
