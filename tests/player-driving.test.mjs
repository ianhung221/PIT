import test from 'node:test';
import assert from 'node:assert/strict';
import { RAPIER, physicalWorld } from './helpers/vehicle-world.mjs';
import { makePlayerDriving, stepPlayerDriving, resetPlayerDriving } from '../lib/playerDriving.ts';
import { applyPlayerForces } from '../lib/playerVehicleForces.ts';
import { readVehicleFrame, vehicleWorldPoint, snapshotFromFrame } from '../lib/vehiclePose.ts';
import { pristineDamage } from '../lib/vehicleDamage.ts';
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
const settle=f=>{for(let i=0;i<120;i++)f.step();};
function playerStep(f,driving,kind,keys=new Set(),grip=1,damage=pristineDamage()) {
  applyPlayerForces(f.vehicle.body,readVehicleFrame(f.vehicle.body,f.vehicle.lastYaw),driving,damage,keys,kind,grip,1/60);f.world.step();
  return readVehicleFrame(f.vehicle.body,f.vehicle.lastYaw);
}
test('production tyres do not steer at rest and turn correctly in forward/reverse for all three models',async()=>{
  await RAPIER.init();
  for(const kind of Object.keys(VEHICLES))for(const speed of [0,5,-5])for(const side of [-1,1]) {
    const f=physicalWorld(kind),s=makePlayerDriving();
    try {
      settle(f);f.vehicle.body.setLinvel({x:0,y:0,z:-speed},true);
      for(let i=0;i<30;i++)playerStep(f,s,kind,new Set([side===1?'arrowright':'arrowleft']));
      const frame=readVehicleFrame(f.vehicle.body,f.vehicle.lastYaw);
      if(speed===0){assert.ok(Math.abs(frame.yaw)<1e-4);assert.ok(frame.planarSpeed<.015);}
      else assert.ok(frame.yaw*side*Math.sign(speed)<-.02,`${kind}: speed ${speed}, side ${side}, yaw ${frame.yaw}`);
    } finally {f.dispose();}
  }
});

test('production player control does not erase collision pitch, roll, yaw or vertical motion in the air',async()=>{
  await RAPIER.init();
  for(const kind of Object.keys(VEHICLES)) {
    const f=physicalWorld(kind),body=f.vehicle.body;
    try {
      body.setTranslation({x:0,y:8,z:0},true);body.setLinvel({x:2,y:3,z:-5},true);body.setAngvel({x:.4,y:1,z:.6},true);
      playerStep(f,makePlayerDriving(),kind,new Set(['arrowup','arrowright']));
      const velocity=body.linvel(),angular=body.angvel();
      assert.ok(velocity.y>2.7);assert.ok(angular.x>.39&&angular.y>.98&&angular.z>.59);
      assert.equal(f.vehicle.groundedWheels,0);
    } finally {f.dispose();}
  }
});

test('production low-speed forward/reverse full-lock outer body radius meets the three model targets',async(t)=>{
  await RAPIER.init();
  for(const kind of Object.keys(VEHICLES))for(const side of [-1,1])for(const gear of [1,-1]) {
    const f=physicalWorld(kind),s=makePlayerDriving(),spec=VEHICLES[kind];
    try {
      // Enable slightly above 10 km/h, then select the minimum target. Rapier
      // stores Float32 velocities, so exactly 10 may round below the UI gate.
      settle(f);f.vehicle.body.setLinvel({x:0,y:0,z:-gear*10.1/3.6},true);
      if(gear===1)s.commands.push('toggle','down');let worst=0;
      for(let i=0;i<480;i++) {
        const keys=new Set([side===1?'arrowright':'arrowleft']);
        // Reverse has no cruise. Use ordinary down-key pulses below 7.5 km/h,
        // allowing the real engine and drag to keep this a low-speed circle.
        if(gear===-1&&readVehicleFrame(f.vehicle.body,f.vehicle.lastYaw).forwardSpeed>-7.5/3.6)keys.add('arrowdown');
        const frame=playerStep(f,s,kind,keys);
        if(i<180)continue;
        const omega=frame.angularVelocity.y;
        assert.ok(Math.abs(omega)>.1&&frame.upDot>.99&&f.vehicle.groundedWheels===4,JSON.stringify({kind,side,gear,i,omega,upDot:frame.upDot,grounded:f.vehicle.groundedWheels,speed:frame.forwardSpeed,cruise:s.cruise,reason:s.reason}));
        const center={x:frame.x+frame.velocityZ/omega,z:frame.z-frame.velocityX/omega},car=snapshotFromFrame(frame);
        for(const x of [-spec.width/2,spec.width/2])for(const z of [-spec.length/2,spec.length/2]) {
          const corner=vehicleWorldPoint(car,{x,y:0,z});worst=Math.max(worst,Math.hypot(corner.x-center.x,corner.z-center.z));
        }
      }
      assert.ok(worst<=(kind==='suv'?7.5:7),`${kind}, side ${side}, gear ${gear}: outer radius ${worst}`);
      t.diagnostic(`${kind}, side ${side}, gear ${gear}: outer body radius ${worst.toFixed(3)} m`);
    } finally {f.dispose();}
  }
});

test('identical braking input needs more distance on wet and snowy roads',async(t)=>{
  await RAPIER.init();
  for(const kind of Object.keys(VEHICLES)) {
    const distances=[];
    for(const grip of [1,.78,.58]) {
      const f=physicalWorld(kind),s=makePlayerDriving();
      try {
        settle(f);f.vehicle.body.setLinvel({x:0,y:0,z:-60/3.6},true);const initial=f.vehicle.body.translation();let frame;
        for(let i=0;i<1200;i++) {
          frame=playerStep(f,s,kind,new Set(['arrowdown']),grip);
          assert.ok(frame.upDot>.98&&frame.headingValid);
          if(frame.forwardSpeed<.9)break;
        }
        assert.ok(frame.forwardSpeed<.9,`${kind}, grip ${grip}: did not brake`);
        distances.push(Math.hypot(frame.x-initial.x,frame.z-initial.z));
      } finally {f.dispose();}
    }
    assert.ok(distances[1]>distances[0]&&distances[2]>distances[1],`${kind}: clear/rain/snow ${distances}`);
    t.diagnostic(`${kind}: clear/rain/snow braking distances ${distances.map(d=>d.toFixed(3)).join(' / ')} m`);
  }
});
test('cruise cancels for each pedal, contact, inability and reverse; steering alone preserves it',()=>{
  for(const cause of ['throttle','brake','touch','disabled','reverse','steer']) {
    const s=makePlayerDriving();s.commands.push('toggle');stepPlayerDriving(s,neutral,20,43,16,true,1/60);
    s.touching=cause==='touch';stepPlayerDriving(s,{throttle:cause==='throttle',brake:cause==='brake',steer:cause==='steer'?1:0},cause==='reverse'?-1:20,43,16,cause!=='disabled',1/60);
    assert.equal(s.cruise,cause==='steer');assert.ok(s.throttle>=0&&s.throttle<=1);
  }
});
test('production player forces keep all models cruising within 3 km/h after 8 seconds',async(t)=>{
  await RAPIER.init();
  let peak={error:0,kind:'',kph:0,grip:0};
  for(const kind of Object.keys(VEHICLES))for(const kph of [40,80,100])for(const grip of [1,.78,.58]) {
    const f=physicalWorld(kind),s=makePlayerDriving();
    try {
      settle(f);
      // Only the initial velocity is assigned; production wheel forces must
      // then maintain speed against their actual suspension/tyre/drag model.
      f.vehicle.body.setLinvel({x:0,y:0,z:-kph/3.6},true);s.commands.push('toggle');let worst=0;
      for(let i=0;i<1080;i++) {
        const frame=playerStep(f,s,kind,new Set(),grip);
        if(i>=480)worst=Math.max(worst,Math.abs(frame.forwardSpeed*3.6-kph));
        assert.ok(frame.upDot>.98&&frame.headingValid);
      }
      assert.ok(s.cruise);assert.ok(worst<=3,`${kind}, ${kph} km/h, grip ${grip}: ${worst}`);
      if(worst>peak.error)peak={error:worst,kind,kph,grip};
    } finally {f.dispose();}
  }
  t.diagnostic(`Largest settled cruise error: ${JSON.stringify(peak)} km/h`);
});
