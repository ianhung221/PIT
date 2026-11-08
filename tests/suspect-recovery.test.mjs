import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSuspectRecovery,stepSuspectRecovery} from '../lib/suspectRecovery.ts';
const car={x:0,z:0,yaw:0,speed:15,lateralSpeed:0,pose:{groundedWheels:4,headingValid:true,upDot:1,angularSpeed:0}};
test('recovery follows wheel contact, spin and sideslip rather than a 3.2 second stop',()=>{
 for(const difficulty of ['basic','normal','advanced']){
  const state=makeSuspectRecovery();
  for(let i=0;i<240;i++)assert.equal(stepSuspectRecovery(state,1,{...car,lateralSpeed:3},difficulty,1/60),true);
  let resumed=0;
  while(state.active&&resumed<120){stepSuspectRecovery(state,1,car,difficulty,1/60);resumed++;}
  assert.ok(resumed<60);assert.equal(car.speed,15);
  assert.equal(stepSuspectRecovery(state,1,car,difficulty,1/60),false);
  assert.equal(stepSuspectRecovery(state,2,{...car,pose:{...car.pose,groundedWheels:0}},difficulty,1/60),true);
 }
});
