import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,stepVehiclePhysics} from './helpers/vehicle-world.mjs';
import { makePracticeRuntime } from '../components/game/practiceRuntime.ts';
import { PRACTICE, outsidePractice } from '../lib/practiceConfig.ts';
import { applyPlayerForces } from '../lib/playerVehicleForces.ts';
import { readVehicleFrame } from '../lib/vehiclePose.ts';
test('practice reset is independent, fixed and excludes mission-only state',()=>{
  const config={vehicle:'patrol',quality:'low'},first=makePracticeRuntime(config);
  first.driving.cruise=true;first.driving.commands.push('up');first.playerDamage.engine=0;first.elapsed=100;first.successPresented=true;
  const fresh=makePracticeRuntime(config);
  assert.equal(fresh.phase,'ready');assert.equal(fresh.elapsed,0);assert.equal(fresh.player.speed,PRACTICE.speed);
  assert.equal(fresh.player.z-fresh.suspect.z,10);assert.equal(fresh.driving.cruise,false);assert.equal(fresh.driving.commands.length,0);
  assert.equal(fresh.playerDamage.engine,1);assert.equal(fresh.successPresented,false);assert.equal(fresh.diagnostics.lastSuccess,null);
  for(const key of ['road','supports','authorizationRequested','heldFor'])assert.equal(key in fresh,false);
  assert.equal(outsidePractice({x:1000,z:-1000}),false);assert.equal(outsidePractice({x:0,z:0},{x:0,z:1000.01}),true);
});
test('shared driving forces use real two-body physics: progressive throttle, cruise and braking for all models',async()=>{
  await RAPIER.init();
  for(const vehicle of ['patrol','interceptor','suv']) {
    const f=physicalWorld(vehicle,-.49),w=f.world;
    let player=f.vehicle,target=f.add('suspect',0,-100),state=makePracticeRuntime({vehicle,quality:'low'});
    const neutral={throttle:0,brake:0,steer:0,gear:1};
    try {
      for(let i=0;i<120;i++){stepVehiclePhysics(player,neutral);stepVehiclePhysics(target,neutral);w.step();}
      player.body.setLinvel({x:0,y:0,z:-PRACTICE.speed},true);
      assert.equal(w.bodies.len(),2);assert.equal(w.colliders.len(),9);assert.equal(w.vehicleControllers.size,2);
      const step=keys=>{
        applyPlayerForces(player.body,readVehicleFrame(player.body,player.lastYaw),state.driving,state.playerDamage,new Set(keys),vehicle,1,1/60);
        stepVehiclePhysics(target,neutral);w.step();
      };
      state.driving.commands.push('toggle');for(let i=0;i<180;i++)step([]);
      assert.equal(state.driving.cruise,true);assert.ok(Math.abs(readVehicleFrame(player.body,player.lastYaw).forwardSpeed-PRACTICE.speed)<1);
      step(['arrowdown']);assert.equal(state.driving.cruise,false);assert.equal(state.driving.throttle,0);
      const before=readVehicleFrame(player.body,player.lastYaw).forwardSpeed;
      step(['arrowup']);assert.ok(state.driving.throttle>0&&state.driving.throttle<.1);
      for(let i=0;i<59;i++)step(['arrowup']);assert.ok(readVehicleFrame(player.body,player.lastYaw).forwardSpeed>before);
      for(let reset=0;reset<3;reset++) {
        f.remove(player);f.remove(target);
        assert.equal(w.bodies.len(),0);assert.equal(w.colliders.len(),1);assert.equal(w.vehicleControllers.size,0);
        player=f.add(vehicle);target=f.add('suspect',0,-100);state=makePracticeRuntime({vehicle,quality:'low'});
        assert.equal(w.bodies.len(),2);assert.equal(w.colliders.len(),9);assert.equal(w.vehicleControllers.size,2);
        for(const core of [player,target]) {
          assert.equal(core.groundedWheels,0);assert.equal(core.wheelSteering,0);assert.equal(core.disabled,false);
          assert.deepEqual({...core.body.rotation()},{x:0,y:0,z:0,w:1});
        }
        assert.equal(state.driving.cruise,false);assert.equal(state.driving.throttle,0);assert.equal(state.driving.commands.length,0);
        for(let i=0;i<120;i++)step([]);
        assert.equal(player.groundedWheels,4);assert.equal(target.groundedWheels,4);
      }
    } finally {f.dispose();}
  }
});
