import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { makePlayerDriving, stepPlayerDriving, resetPlayerDriving, playerTurnRate } from '../lib/playerDriving.ts';
import { VEHICLES } from '../lib/gameConfig.ts';
const neutral={throttle:false,brake:false,steer:0};
test('time-based pedals and steering agree across fixed step rates; brake wins',()=>{
  const results=[30,60,120].map(hz=>{const s=makePlayerDriving();for(let i=0;i<hz/10;i++)stepPlayerDriving(s,{...neutral,throttle:true,steer:1},0,43,16,true,1/hz);return s;});
  for(const s of results){assert.ok(Math.abs(s.throttle-1/7)<1e-9);assert.ok(Math.abs(s.steering-5/9)<1e-9);}
  const s=results[0];stepPlayerDriving(s,{throttle:true,brake:true,steer:0},10,43,16,true,1/60);assert.equal(s.throttle,0);
  s.target=80;resetPlayerDriving(s,'test');assert.equal(s.steering,0);assert.equal(s.commands.length,0);assert.equal(s.target,0);
});
test('cruise gates, cancellation and bounded target',()=>{
  for(const why of ['slow','contact','pedal','disabled']) {
    const s=makePlayerDriving();s.commands.push('toggle');s.touching=why==='contact';
    stepPlayerDriving(s,{...neutral,throttle:why==='pedal'},why==='slow'?1:20,43,16,why!=='disabled',1/60);assert.equal(s.cruise,false);
  }
  const s=makePlayerDriving();s.commands.push('toggle');stepPlayerDriving(s,neutral,20,43,16,true,1/60);assert.equal(s.target,72);assert.equal(s.cruise,true);
  s.commands.push(...Array(99).fill('up'));stepPlayerDriving(s,neutral,20,43,16,true,1/60);assert.equal(s.target,154.8);
  stepPlayerDriving(s,{...neutral,brake:true},20,43,16,true,1/60);assert.equal(s.cruise,false);assert.equal(s.integral,0);assert.equal(s.throttle,0);
});
test('turn direction is continuous through rest and less sensitive at highway speed',()=>{
  assert.equal(Math.abs(playerTurnRate(1,0,2)),0);
  assert.ok(playerTurnRate(1,5,2)<0);assert.ok(playerTurnRate(1,-5,2)>0);
  assert.ok(Math.abs(playerTurnRate(1,40,2))<Math.abs(playerTurnRate(1,13,2)));
});
test('Rapier stationary and forward/reverse yaw for three models; impact yaw is not erased',async()=>{
  await RAPIER.init();
  for(const spec of Object.values(VEHICLES)) for(const speed of [0,5,-5]) {
    const world=new RAPIER.World({x:0,y:0,z:0});world.timestep=1/60;
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setAngularDamping(1.8));
    world.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,2).setMass(spec.mass),body);
    const s=makePlayerDriving();
    for(let i=0;i<30;i++){
      stepPlayerDriving(s,{...neutral,steer:1},speed,spec.maxSpeed,spec.acceleration,true,1/60);
      const rate=playerTurnRate(s.steering,speed,spec.steering);
      body.setAngvel({x:0,y:body.angvel().y+(rate-body.angvel().y)*8/60,z:0},true);world.step();
    }
    if(speed===0)assert.equal(body.rotation().y,0);else assert.equal(Math.sign(body.rotation().y),-Math.sign(speed));
    body.setAngvel({x:0,y:1,z:0},true);
    body.setAngvel({x:0,y:body.angvel().y*(1-8/60),z:0},true);world.step();assert.ok(body.angvel().y>0);
    world.free();
  }
});
test('cruise cancels for each pedal, contact, inability and reverse; steering alone preserves it',()=>{
  for(const cause of ['throttle','brake','touch','disabled','reverse','steer']) {
    const s=makePlayerDriving();s.commands.push('toggle');stepPlayerDriving(s,neutral,20,43,16,true,1/60);
    s.touching=cause==='touch';stepPlayerDriving(s,{throttle:cause==='throttle',brake:cause==='brake',steer:cause==='steer'?1:0},cause==='reverse'?-1:20,43,16,cause!=='disabled',1/60);
    assert.equal(s.cruise,cause==='steer');assert.ok(s.throttle>=0&&s.throttle<=1);
  }
});
test('Rapier: all models cruise within 3 km/h after 8 seconds without velocity injection',async()=>{
  await RAPIER.init();
  for(const spec of Object.values(VEHICLES)) for(const kph of [40,80,100]) {
    const world=new RAPIER.World({x:0,y:0,z:0});world.timestep=1/60;
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinearDamping(.08));
    world.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,2).setMass(spec.mass),body);
    // Only the initial condition is set. Controller must physically converge.
    body.setLinvel({x:0,y:0,z:-kph/3.6},true);
    const s=makePlayerDriving();s.commands.push('toggle');
    let worst=0;
    for(let i=0;i<1080;i++) {
      const speed=-body.linvel().z;
      stepPlayerDriving(s,neutral,speed,spec.maxSpeed,spec.acceleration,true,1/60);
      body.applyImpulse({x:0,y:0,z:(-s.throttle*spec.acceleration+speed*.12)*body.mass()/60},true);world.step();
      if(i>=480)worst=Math.max(worst,Math.abs(-body.linvel().z*3.6-kph));
    }
    assert.ok(worst<=3,`${spec.name} ${kph}: ${worst}`);world.free();
  }
});
