import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPhysicalContact, V2_PIT } from '../lib/pitContact.ts';
import { beginDiagnostic, makeDiagnostics, contactChecks, outcomeSample, updateDiagnostic, DIAGNOSTIC_LIMIT } from '../lib/pitDiagnostics.ts';
const valid={localX:.975,localZ:1.6,playerLocalX:-1,playerLocalZ:-2,normalSide:.9,closingSpeed:5,normalSpeed:2,headingDelta:0,halfWidth:.975,halfLength:2.193,playerHalfLength:2.356,authorized:true};
test('diagnostics preserve classification precedence and expose each failed measurement',()=>{
  for(const [patch,expected,code] of [
    [{},'effective',null],[{closingSpeed:12.001},'excessive','relative-speed'],[{normalSpeed:8.001},'excessive','normal-speed-high'],
    [{localZ:1.0964},'scrape','target-zone'],[{playerLocalZ:0},'scrape','player-zone'],[{normalSide:.6},'scrape','normal-direction'],
    [{headingDelta:V2_PIT.maxAngle+.001},'scrape','heading'],[{normalSpeed:.349},'scrape','normal-speed-low'],[{authorized:false},'unsafe','authorization'],
    [{closingSpeed:13,authorized:false},'excessive','relative-speed'],[{localZ:0,authorized:false},'scrape','target-zone'],[{localX:NaN},'scrape','data']
  ]) {
    const c={...valid,...patch},d=makeDiagnostics('practice','test');
    assert.deepEqual(beginDiagnostic(d,c,3),classifyPhysicalContact(c));
    assert.equal(d.latest.classification,expected);
    if(code)assert.equal(contactChecks(c).find(x=>x.code===code).pass,false);
  }
  for(const patch of [{closingSpeed:12},{normalSpeed:8},{normalSpeed:.35},{localZ:valid.halfLength*.5},{localZ:valid.halfLength+.08},{localX:valid.halfWidth*.65},{localX:valid.halfWidth+.08},{playerLocalZ:-valid.playerHalfLength*.45},{playerLocalZ:-valid.playerHalfLength-.08},{headingDelta:V2_PIT.maxAngle}]) {
    const c={...valid,...patch};assert.equal(classifyPhysicalContact(c).classification,'effective');assert.ok(contactChecks(c).every(x=>x.pass));
  }
});
test('near 99 percent is not success; yaw AND slowdown-or-slip plus duration and initial speed remain required',()=>{
  const sample=(yaw,speed,slip=0,time=1/60,start=20)=>outcomeSample(0,yaw*Math.PI/180,start,speed,slip,time,.1);
  assert.equal(sample(54.9,12).success,false);
  assert.match(sample(54.9,12).reasons.join(),/55/);
  assert.equal(sample(55,13).success,true);
  assert.equal(sample(55,19,4).success,true);
  assert.equal(sample(55,19,3.999).success,false);
  assert.equal(sample(55,12,0,.01).success,false);
  assert.equal(sample(55,2,4,1/60,4).success,false);
});
test('expiry records reason; later scrape cannot erase qualified history; events stay bounded',()=>{
  const d=makeDiagnostics('mission','test');beginDiagnostic(d,valid,1);
  updateDiagnostic(d,outcomeSample(0,0,20,20,0,1/60,0),3.5,true);
  assert.equal(d.latest.status,'expired');assert.equal(d.lastSuccess,null);
  beginDiagnostic(d,valid,4);updateDiagnostic(d,outcomeSample(0,1,20,10,0,.2,1),5,false);
  const success=structuredClone(d.lastSuccess);
  for(let i=0;i<200;i++)beginDiagnostic(d,{...valid,localZ:0},6+i);
  assert.deepEqual(d.lastSuccess,success);assert.equal(d.latest.status,'rejected');assert.equal(d.events.length,DIAGNOSTIC_LIMIT);
  assert.ok(d.events.every(e=>Number.isFinite(e.at)&&e.attempt>0));
});
