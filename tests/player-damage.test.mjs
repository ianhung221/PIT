import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld} from './helpers/vehicle-world.mjs';
import {applyPlayerForces} from '../lib/playerVehicleForces.ts';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
import {makePlayerDriving,resetPlayerDriving,noteDrivingKey} from '../lib/playerDriving.ts';
import {pristineDamage,playerVehicleStatus} from '../lib/vehicleDamage.ts';
test('disabled vehicles cannot propel forward/reverse but can brake either direction; three models and weather',async()=>{
  await RAPIER.init();
  for(const model of ['patrol','suv','interceptor'])for(const grip of [1,.78,.58])for(const speed of [-5,0,5])for(const key of ['arrowup','arrowdown']) {
    const f=physicalWorld(model),b=f.vehicle.body,damage={...pristineDamage(),engine:0},s=makePlayerDriving();
    try {
      for(let i=0;i<120;i++)f.step();b.setLinvel({x:0,y:0,z:-speed},true);
      applyPlayerForces(b,readVehicleFrame(b),s,damage,new Set([key]),model,grip,1/60);f.world.step();
      assert.equal(s.throttle,0);assert.equal(s.vehicleStatus.driveable,false);assert.ok(s.input[key==='arrowup'?'up':'down']);
      if(speed===0)assert.ok(Math.abs(b.linvel().z)<.001);
      else {assert.equal(Math.sign(-b.linvel().z),Math.sign(speed));assert.ok(Math.abs(b.linvel().z)<Math.abs(speed));}
      for(let i=0;i<120;i++){applyPlayerForces(b,readVehicleFrame(b,f.vehicle.lastYaw),s,damage,new Set([key]),model,grip,1/60);f.world.step();}
      if(key==='arrowdown'||speed===0)assert.ok(Math.abs(readVehicleFrame(b).forwardSpeed)<.1,`${model}, grip ${grip}, speed ${speed}, ${key}`);
      assert.match(s.vehicleStatus.reason,/引擎失能/);
    } finally {f.dispose();}
  }
});

test('healthy cars retain forward/reverse propulsion and brake before changing direction in all weather',async()=>{
  await RAPIER.init();
  for(const model of ['patrol','suv','interceptor'])for(const grip of [1,.78,.58])for(const key of ['arrowup','arrowdown']) {
    const f=physicalWorld(model),b=f.vehicle.body,s=makePlayerDriving();
    try {
      for(let i=0;i<120;i++)f.step();
      for(let i=0;i<120;i++){applyPlayerForces(b,readVehicleFrame(b,f.vehicle.lastYaw),s,pristineDamage(),new Set([key]),model,grip,1/60);f.world.step();}
      const sign=key==='arrowup'?1:-1;
      assert.ok(readVehicleFrame(b,f.vehicle.lastYaw).forwardSpeed*sign>1,`${model}, grip ${grip}, ${key}: no propulsion`);
      const opposite=key==='arrowup'?'arrowdown':'arrowup';
      applyPlayerForces(b,readVehicleFrame(b,f.vehicle.lastYaw),s,pristineDamage(),new Set([opposite]),model,grip,1/60);f.world.step();
      assert.ok(readVehicleFrame(b,f.vehicle.lastYaw).forwardSpeed*sign>0,'First opposite input must brake, not teleport velocity into reverse');
      for(let i=0;i<240;i++){applyPlayerForces(b,readVehicleFrame(b,f.vehicle.lastYaw),s,pristineDamage(),new Set([opposite]),model,grip,1/60);f.world.step();}
      assert.ok(readVehicleFrame(b,f.vehicle.lastYaw).forwardSpeed*sign<-.5,`${model}, grip ${grip}, ${opposite}: failed to change direction`);
    } finally {f.dispose();}
  }
});
test('status distinguishes steering failure from propulsion and reset clears accepted keys',()=>{
  const damage={...pristineDamage(),alignment:0};
  assert.equal(playerVehicleStatus(damage).driveable,true);assert.equal(playerVehicleStatus(damage).steeringAuthority,0);
  const s=makePlayerDriving();noteDrivingKey(s,'arrowleft',true);assert.match(s.lastInputEvent,/已收到/);
  noteDrivingKey(s,'arrowleft',true,false);assert.match(s.lastInputEvent,/鬆開|放開/);
  s.input.up=true;resetPlayerDriving(s,'失焦');assert.ok(Object.values(s.input).every(v=>!v));assert.match(s.lastInputEvent,/失焦/);
});
