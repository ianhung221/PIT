import test from 'node:test';
import assert from 'node:assert/strict';
import {driverCameraFrame,mirrorCameraFrame,driverEyeHeight} from '../lib/vehicleCamera.ts';
import {vehicleLocalPoint} from '../lib/vehiclePose.ts';
import {vehiclePhysicsConfig} from '../lib/vehiclePhysicsConfig.ts';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('driver, rear look and mirrors stay attached to the complete tilted/airborne chassis in every model',()=>{
 for(const vehicle of ['patrol','interceptor','suv'])for(const angle of [0,.5,Math.PI]){
  const car={x:8,z:-20,yaw:0,speed:0,lateralSpeed:0,pose:{y:3,quaternion:{x:0,y:0,z:Math.sin(angle/2),w:Math.cos(angle/2)}}};
  const front=driverCameraFrame(car,vehicle),rear=driverCameraFrame(car,vehicle,true);
  const local=vehicleLocalPoint(car,front.position);near(local.x,-.38);near(local.y,driverEyeHeight(vehicle));near(local.z,-.2);
  assert.ok(local.y<vehiclePhysicsConfig(vehicle).roofY,'eyes belong inside the model roof');
  assert.deepEqual(front.position,rear.position);near(vehicleLocalPoint(car,front.target).z,-18.2);near(vehicleLocalPoint(car,rear.target).z,17.8);
  near(front.up.y,Math.cos(angle));
  for(let index=0;index<3;index++){
   const mirror=mirrorCameraFrame(car,vehicle,index);const anchor=vehicleLocalPoint(car,mirror.position),target=vehicleLocalPoint(car,mirror.target);
   assert.ok(target.z>anchor.z+20,'mirror must look behind the vehicle');near(mirror.up.y,Math.cos(angle));
  }
 }
});
