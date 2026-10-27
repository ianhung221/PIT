import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {applyPlayerForces} from '../lib/playerVehicleForces.ts';
import {makePlayerDriving,resetPlayerDriving,noteDrivingKey} from '../lib/playerDriving.ts';
import {pristineDamage,playerVehicleStatus} from '../lib/vehicleDamage.ts';
test('disabled vehicles cannot propel forward/reverse but can brake either direction; three models and weather',async()=>{
  await RAPIER.init();
  for(const model of ['patrol','suv','interceptor'])for(const grip of [1,.78,.58])for(const speed of [-5,0,5])for(const key of ['arrowup','arrowdown']) {
    const w=new RAPIER.World({x:0,y:0,z:0}),b=w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinvel(0,0,-speed));
    w.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,2).setMass(1),b);
    const damage={...pristineDamage(),engine:0},s=makePlayerDriving();
    const f={forwardX:0,forwardZ:-1,rightX:1,rightZ:0,velocityX:0,velocityZ:-speed,forwardSpeed:speed,lateralSpeed:0};
    applyPlayerForces(b,f,s,damage,new Set([key]),model,grip,1/60);w.step();
    assert.equal(s.throttle,0);assert.equal(s.vehicleStatus.driveable,false);assert.ok(s.input[key==='arrowup'?'up':'down']);
    if(speed===0)assert.equal(b.linvel().z,0);else {assert.equal(Math.sign(-b.linvel().z),Math.sign(speed));assert.ok(Math.abs(b.linvel().z)<Math.abs(speed));}
    assert.match(s.vehicleStatus.reason,/引擎失能/);w.free();
  }
});
test('status distinguishes steering failure from propulsion and reset clears accepted keys',()=>{
  const damage={...pristineDamage(),alignment:0};
  assert.equal(playerVehicleStatus(damage).driveable,true);assert.equal(playerVehicleStatus(damage).steeringAuthority,0);
  const s=makePlayerDriving();noteDrivingKey(s,'arrowleft',true);assert.match(s.lastInputEvent,/已收到/);
  noteDrivingKey(s,'arrowleft',true,false);assert.match(s.lastInputEvent,/鬆開|放開/);
  s.input.up=true;resetPlayerDriving(s,'失焦');assert.ok(Object.values(s.input).every(v=>!v));assert.match(s.lastInputEvent,/失焦/);
});
