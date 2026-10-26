import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { makePracticeRuntime } from '../components/game/practiceRuntime.ts';
import { PRACTICE, outsidePractice } from '../lib/practiceConfig.ts';
import { vehicleColliderStrips } from '../lib/gameConfig.ts';
import { applyPlayerForces } from '../lib/playerVehicleForces.ts';
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
    const w=new RAPIER.World({x:0,y:0,z:0});w.timestep=1/60;
    const state=makePracticeRuntime({vehicle,quality:'low'});
    const p=w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinvel(0,0,-PRACTICE.speed).setLinearDamping(.08));
    const target=w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,0,-100));
    for(const [body,model] of [[p,vehicle],[target,'suspect']])for(const s of vehicleColliderStrips(model))w.createCollider(RAPIER.ColliderDesc.cuboid(s.halfWidth,.48,s.halfLength).setTranslation(0,0,s.z).setMass(s.mass),body);
    assert.equal(w.bodies.len(),2);assert.equal(w.colliders.len(),6);
    const step=(keys)=>{const v=p.linvel();applyPlayerForces(p,{forwardX:0,forwardZ:-1,rightX:1,rightZ:0,velocityX:v.x,velocityZ:v.z,forwardSpeed:-v.z,lateralSpeed:v.x},state.driving,state.playerDamage,new Set(keys),vehicle,1,1/60);w.step();};
    state.driving.commands.push('toggle');for(let i=0;i<180;i++)step([]);
    assert.equal(state.driving.cruise,true);assert.ok(Math.abs(-p.linvel().z-PRACTICE.speed)<1);
    step(['arrowdown']);assert.equal(state.driving.cruise,false);assert.equal(state.driving.throttle,0);
    const before=-p.linvel().z;for(let i=0;i<60;i++)step(['arrowup']);assert.ok(-p.linvel().z>before);
    w.free();
  }
});
