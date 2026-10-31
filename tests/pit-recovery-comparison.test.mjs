import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld} from './helpers/vehicle-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
import {pristineDamage} from '../lib/vehicleDamage.ts';

test('isolated target-speed comparison for the retained post-PIT assistance',async t=>{
  await RAPIER.init();
  function run(targetSpeed) {
    const f=physicalWorld('suspect'),core=f.vehicle,damage=pristineDamage();
    try {
      for(let i=0;i<120;i++){driveVehicleTarget(core,{speed:0,yawError:0},1,damage,1/60);f.world.step();}
      core.body.setLinvel({x:0,y:0,z:-6},true);
      for(let i=0;i<192;i++){driveVehicleTarget(core,{speed:targetSpeed,yawError:0},1,damage,1/60);f.world.step();}
      return readVehicleFrame(core.body,core.lastYaw).forwardSpeed;
    } finally {f.dispose();}
  }
  const assisted=run(0),unassisted=run(15);
  t.diagnostic(`3.2s isolated speed: assistance=${assisted.toFixed(2)} m/s, drive target=${unassisted.toFixed(2)} m/s`);
  assert.ok(unassisted>assisted+1);
});
