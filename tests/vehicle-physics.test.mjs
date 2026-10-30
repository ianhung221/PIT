import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,stepVehiclePhysics,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {vehiclePhysicsConfig} from '../lib/vehiclePhysicsConfig.ts';
await RAPIER.init();
const neutral={throttle:0,brake:0,steer:0,gear:1};
test('the shared four-wheel core rests for 30 seconds at the measured wheel envelope, without vertical locks',()=>{
 assert.equal(RAPIER.version(),'0.19.2');
 for(const kind of ['patrol','interceptor','suv','suspect']){
  const s=physicalWorld(kind);try{
   for(let i=0;i<120;i++)s.step();const y=s.vehicle.body.translation().y;
   for(let i=0;i<1800;i++)s.step();const p=physicsSnapshot(s.vehicle);
   assert.ok(Math.abs(p.pose.y-y)<.002,kind);assert.ok(Math.abs(p.pose.y-(-.505+.18))<.025,kind);
   assert.ok(Math.abs(p.speed)<.01&&Math.abs(p.lateralSpeed)<.01,kind);assert.ok(p.pose.tilt<.02,kind);
   assert.equal(p.pose.groundedWheels,4);assert.ok(Math.abs(s.vehicle.body.mass()-vehiclePhysicsConfig(kind).massKg)<.001);
  }finally{s.dispose();}
 }
});
test('forward/reverse and left/right signs come from tyres and stationary steering cannot rotate the body',()=>{
 for(const gear of [1,-1])for(const steer of [-1,1]){
  const s=physicalWorld();try{
   for(let i=0;i<120;i++)s.step({...neutral,steer});assert.ok(Math.abs(physicsSnapshot(s.vehicle).yaw)<.0001);
   for(let i=0;i<120;i++)s.step({...neutral,throttle:.15,gear});
   assert.ok(physicsSnapshot(s.vehicle).speed*gear>3);
   for(let i=0;i<60;i++)s.step({...neutral,steer,gear,throttle:.03});
   const p=physicsSnapshot(s.vehicle);assert.ok(p.yaw*steer*gear<-.2,JSON.stringify({gear,steer,p}));assert.ok(p.pose.upDot>.97);
  }finally{s.dispose();}
 }
});
test('airborne tyres cannot accelerate/turn and reject other vehicles as support surfaces',()=>{
 const s=physicalWorld();try{
  const v=s.vehicle;v.body.setTranslation({x:0,y:10,z:0},true);
  for(let i=0;i<20;i++)s.step({...neutral,throttle:1,steer:1});
  const p=physicsSnapshot(v);assert.equal(p.pose.groundedWheels,0);assert.ok(Math.hypot(p.x,p.z)<.001);assert.ok(Math.abs(p.yaw)<.001);assert.ok(p.pose.y<10);
  const other=s.add('suv',0,0);v.body.setTranslation({x:0,y:1.15,z:0},true);v.body.setLinvel({x:0,y:0,z:0},true);
  stepVehiclePhysics(v,neutral);assert.equal(v.groundedWheels,0,'rays must not drive on another chassis');
  s.remove(other);
 }finally{s.dispose();}
});
test('controller and chassis lifecycle remains bounded through twenty restarts',()=>{
 const s=physicalWorld();s.remove(s.vehicle);
 try{for(let i=0;i<20;i++){
  const v=s.add('patrol');for(let j=0;j<10;j++){stepVehiclePhysics(v,neutral);s.world.step();}
  assert.equal(s.world.vehicleControllers.size,1);assert.equal(s.world.bodies.len(),1);assert.equal(s.world.colliders.len(),5);
  s.remove(v);assert.equal(s.world.vehicleControllers.size,0);assert.equal(s.world.bodies.len(),0);assert.equal(s.world.colliders.len(),1);
 }}finally{s.dispose();}
});
