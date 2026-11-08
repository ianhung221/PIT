import test from 'node:test';
import assert from 'node:assert/strict';
import {makePursuitEvents,stepPursuitEvents} from '../lib/pursuitEvents.ts';
test('new PIT overrides earlier Q2/Q3/Q5, cancellation consumes history, next PIT rearms',()=>{
 for(const command of ['prepare-pit','move-up','take-primary']){
  const state=makePursuitEvents(),input={pitCount:0,pitQualified:false,command,commandAt:1,running:true};
  assert.equal(stepPursuitEvents(state,input).active,false);
  Object.assign(input,{pitCount:1,pitQualified:true});assert.equal(stepPursuitEvents(state,input).started,true);
  assert.equal(stepPursuitEvents(state,input).started,false);
  input.commandAt=2;assert.equal(stepPursuitEvents(state,input).cancelled,true);
  assert.equal(stepPursuitEvents(state,input).active,false);
  input.pitCount=2;assert.equal(stepPursuitEvents(state,input).active,true);
  input.pitQualified=false;assert.equal(stepPursuitEvents(state,input).active,false);
  assert.equal(input.command,command);
 }
});
test('Q1 does not change tactical epoch, Q4 stays armed on escape and termination clears',()=>{
 const state=makePursuitEvents(),input={pitCount:0,pitQualified:false,command:'block-front',commandAt:1,running:true};
 assert.equal(stepPursuitEvents(state,input).active,true);
 Object.assign(input,{pitCount:1,pitQualified:true});stepPursuitEvents(state,input);
 assert.equal(stepPursuitEvents(state,input).active,true); // request-pit leaves these values untouched
 input.pitQualified=false;assert.equal(stepPursuitEvents(state,input).active,true);
 input.command='terminate';assert.equal(stepPursuitEvents(state,input).active,false);
 assert.equal(state.automatic,false);
});
