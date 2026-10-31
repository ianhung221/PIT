import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSuspectDecision, stepSuspectDecision } from '../lib/suspectDriving.ts';
import {RAPIER,physicalWorld} from './helpers/vehicle-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
import {pristineDamage} from '../lib/vehicleDamage.ts';

test('basic stays straight and advanced requires sustained observation',()=>{
  const basic=makeSuspectDecision('example'), advanced=makeSuspectDecision('example');
  for(let i=0;i<47;i++) {
    stepSuspectDecision(basic,'basic',1/60,10,0,8);
    stepSuspectDecision(advanced,'advanced',1/60,10,0,8);
  }
  assert.equal(basic.offset,0); assert.equal(basic.speedScale,1);
  assert.equal(advanced.cooldown,0);
  for(let i=0;i<5;i++)stepSuspectDecision(advanced,'advanced',1/60,10,0,8);
  assert.ok(advanced.cooldown>0);
  assert.ok(Math.abs(advanced.offset)<=8*.65);
});
test('same seed and observations repeat; moving away resets awareness',()=>{
  const first=makeSuspectDecision('same'),second=makeSuspectDecision('same');
  for(let i=0;i<900;i++) {
    const distance=i<60?10:i<120?30:10;
    stepSuspectDecision(first,'advanced',1/60,distance,1,6);
    stepSuspectDecision(second,'advanced',1/60,distance,1,6);
    assert.deepEqual(first,second);
    assert.ok(Math.abs(first.offset)<=6*.65);
    if(i===90)assert.equal(first.noticed,0);
  }
});
test('an observed player on opposite sides leads to opposite evasive targets',()=>{
  const left=makeSuspectDecision('example'),right=makeSuspectDecision('example');
  for(let i=0;i<50;i++) {
    stepSuspectDecision(left,'advanced',1/60,10,0,8,-2);
    stepSuspectDecision(right,'advanced',1/60,10,0,8,2);
  }
  assert.ok(left.offset>0);assert.ok(right.offset<0);
});
test('difficulty decisions steer a real practice vehicle instead of teleporting it',async t=>{
  await RAPIER.init();
  function run(difficulty) {
    const f=physicalWorld('suspect'),core=f.vehicle,state=makeSuspectDecision('example'),damage=pristineDamage();
    try {
      for(let i=0;i<120;i++){driveVehicleTarget(core,{speed:0,yawError:0},1,damage,1/60);f.world.step();}
      core.body.setLinvel({x:0,y:0,z:-50/3.6},true);
      let maxOffset=0;
      for(let i=0;i<480;i++) {
        const frame=readVehicleFrame(core.body,core.lastYaw);
        const decision=stepSuspectDecision(state,difficulty,1/60,10,frame.x,8,2);
        const targetYaw=Math.atan2(-(decision.offset-frame.x),35);
        driveVehicleTarget(core,{speed:50/3.6*decision.speedScale,yawError:targetYaw-frame.yaw},1,damage,1/60,frame);
        f.world.step();maxOffset=Math.max(maxOffset,Math.abs(core.body.translation().x));
      }
      return maxOffset;
    } finally {f.dispose();}
  }
  const straight=run('basic'),evasion=run('advanced');
  t.diagnostic(`max lateral displacement basic=${straight.toFixed(2)} m advanced=${evasion.toFixed(2)} m`);
  assert.ok(evasion>straight+.2);
});
