import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,stepVehiclePhysics} from './helpers/vehicle-world.mjs';
import {applyPitTargetControl} from '../lib/pitTargetControl.ts';
import {pristineDamage} from '../lib/vehicleDamage.ts';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
test('shared candidate control matches passive production tyres without forced yaw or velocity',async()=>{
  await RAPIER.init();
  for(const grip of [1,.78,.58])for(const damaged of [false,true]) {
    const damage=damaged?{...pristineDamage(),frontLeftGrip:0,rearRightGrip:.2,alignment:0}:pristineDamage();
    const modes=[physicalWorld('suspect'),physicalWorld('suspect')],passive=physicalWorld('suspect'),fixtures=[...modes,passive];
    try {
      for(const f of fixtures) {
        for(let i=0;i<120;i++)f.step();
        f.vehicle.body.setLinvel({x:4,y:0,z:-15},true);f.vehicle.body.setAngvel({x:.2,y:1.5,z:.15},true);
        // A candidate must not inject a target velocity, angle or upright pose.
        for(const method of ['setLinvel','setAngvel','setRotation','setTranslation'])f.vehicle.body[method]=()=>{throw Error('Candidate replaced physical state via '+method);};
      }
      for(let i=0;i<90;i++) {
        for(const f of modes)applyPitTargetControl(f.vehicle.body,readVehicleFrame(f.vehicle.body,f.vehicle.lastYaw),damage,grip,1/60);
        stepVehiclePhysics(passive.vehicle,{throttle:0,brake:0,steer:0,gear:1},grip,damage);
        fixtures.forEach(f=>f.world.step());
        for(const f of modes) {
          assert.deepEqual(f.vehicle.body.linvel(),passive.vehicle.body.linvel());
          assert.deepEqual(f.vehicle.body.angvel(),passive.vehicle.body.angvel());
          assert.deepEqual(f.vehicle.body.rotation(),passive.vehicle.body.rotation());
        }
        if(i===0){assert.ok(modes[0].vehicle.body.linvel().z<-10);assert.ok(modes[0].vehicle.body.angvel().y>.5);}
      }
    } finally {fixtures.forEach(f=>f.dispose());}
  }
});

test('candidate coast does not create ground traction or flatten impact spin while airborne',async()=>{
  await RAPIER.init();
  const f=physicalWorld('suspect'),b=f.vehicle.body;
  try {
    b.setTranslation({x:0,y:10,z:0},true);b.setLinvel({x:3,y:2,z:-12},true);b.setAngvel({x:.4,y:1.5,z:.6},true);
    for(let i=0;i<12;i++){applyPitTargetControl(b,readVehicleFrame(b,f.vehicle.lastYaw),pristineDamage(),1,1/60);f.world.step();}
    const frame=readVehicleFrame(b,f.vehicle.lastYaw);
    assert.equal(f.vehicle.groundedWheels,0);assert.ok(frame.velocityZ<-11);assert.ok(frame.velocityY<2);
    assert.ok(frame.angularVelocity.x>.38&&frame.angularVelocity.y>1.45&&frame.angularVelocity.z>.58);
    assert.ok(frame.y>9.5);
  } finally {f.dispose();}
});
