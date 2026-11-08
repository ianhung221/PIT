import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld} from './helpers/vehicle-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
import {pristineDamage} from '../lib/vehicleDamage.ts';
import {makeSuspectRecovery,stepSuspectRecovery} from '../lib/suspectRecovery.ts';
import {physicsSnapshot,stepVehiclePhysics} from '../lib/vehiclePhysics.ts';

test('isolated physical comparison of historical forced stop, immediate drive and observed recovery',async t=>{
  await RAPIER.init();
  function run(targetSpeed) {
    const f=physicalWorld('suspect'),core=f.vehicle,damage=pristineDamage(),recovery=makeSuspectRecovery();
    try {
      for(let i=0;i<120;i++){driveVehicleTarget(core,{speed:0,yawError:0},1,damage,1/60);f.world.step();}
      core.body.setLinvel({x:0,y:0,z:-6},true);
      for(let i=0;i<192;i++){
        if(targetSpeed==='observed'&&stepSuspectRecovery(recovery,1,physicsSnapshot(core),'normal',1/60))stepVehiclePhysics(core,{throttle:0,brake:0,steer:0,gear:1},1,damage,1/60);
        else driveVehicleTarget(core,{speed:targetSpeed==='observed'?15:targetSpeed,yawError:0},1,damage,1/60);
        f.world.step();
      }
      return readVehicleFrame(core.body,core.lastYaw).forwardSpeed;
    } finally {f.dispose();}
  }
  const assisted=run(0),unassisted=run(15),observed=run('observed');
  t.diagnostic(`3.2s isolated speed: historical stop=${assisted.toFixed(2)} m/s, immediate drive=${unassisted.toFixed(2)} m/s, observed recovery=${observed.toFixed(2)} m/s`);
  assert.ok(unassisted>assisted+1);
  assert.ok(observed>assisted+1&&observed<=unassisted+.01);
});
