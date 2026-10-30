import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,stepVehiclePhysics} from './helpers/vehicle-world.mjs';
import {readVehicleFrame,inverseRotateVehicleVector} from '../lib/vehiclePose.ts';
import {physicalContactSample} from '../lib/physicalContactSample.ts';
import {probeFixture} from './helpers/pit-core-probe.mjs';
import {classifyPhysicalContact,physicalPitOutcome} from '../lib/pitContact.ts';
import {outcomeSample} from '../lib/pitDiagnostics.ts';
import {assessVehicleControl,controlRoadGeometry,advanceControlTimers} from '../lib/vehicleControlAssessment.ts';
await RAPIER.init();
test('production CCD, four-wheel tyres, real side contacts and original PIT thresholds remain achievable in all weather',()=>{
 for(const grip of [1,.78,.58]){
  const r=probeFixture({grip});assert.ok(r.promotion,'real rear-side contact must promote');assert.ok(r.success,JSON.stringify(r));
  assert.ok(r.success.yawChange>=55*Math.PI/180);assert.ok(r.success.speedDrop>=.35||Math.abs(r.success.lateralSpeed)>=4);
  assert.ok(r.success.headingValid&&r.minUp>.9);assert.equal(r.promotion.surfaceValid,true);
 }
});
test('physical centre hits, excessive impact and unauthorized contact do not award PIT credit',()=>{
 for(const input of [{z:0},{vx:-18},{authorized:false}]){
  const result=probeFixture(input);assert.equal(result.success,null,JSON.stringify(input));assert.ok(result.contacts>0);
 }
});
test('roof/bottom contacts and unreliable heading cannot qualify; even enough apparent yaw cannot pass a rollover',()=>{
 const good=probeFixture().promotion;assert.equal(classifyPhysicalContact(good).classification,'effective');
 for(const invalid of [{surfaceValid:false},{headingValid:false}])assert.equal(classifyPhysicalContact({...good,...invalid}).classification,'scrape');
 assert.equal(physicalPitOutcome(0,Math.PI,12,0,5,.1,false).success,false);
 const sample=outcomeSample(0,Math.PI,12,0,5,.1,1,false);assert.equal(sample.success,false);assert.match(sample.reasons.join(''),/水平旋轉/);
});
test('actual vertical roof contact uses full local coordinates and vertical closing speed, and is rejected',()=>{
 const sim=physicalWorld(),p=sim.vehicle,s=sim.add('suspect');
 try{
  p.body.setTranslation({x:.5,y:2,z:0},true);p.body.setLinvel({x:0,y:-5,z:0},true);
  let result=null;
  const neutral={throttle:0,brake:0,steer:0,gear:1};
  for(let i=0;i<90;i++){
   const pre={player:readVehicleFrame(p.body),suspect:readVehicleFrame(s.body)};
   stepVehiclePhysics(p,neutral);stepVehiclePhysics(s,neutral);sim.world.step();
   result=physicalContactSample(sim.world,p.body,s.body,readVehicleFrame(p.body),readVehicleFrame(s.body),pre,'patrol',true);
   if(result){
    const points=[];for(let a=0;a<p.body.numColliders();a++)for(let b=0;b<s.body.numColliders();b++)sim.world.contactPair(p.body.collider(a),s.body.collider(b),m=>{for(let k=0;k<m.numSolverContacts();k++)points.push(m.solverContactPoint(k));});
    const mean=points.reduce((v,q)=>({x:v.x+q.x/points.length,y:v.y+q.y/points.length,z:v.z+q.z/points.length}),{x:0,y:0,z:0}),position=s.body.translation();
    const local=inverseRotateVehicleVector({x:mean.x-position.x,y:mean.y-position.y,z:mean.z-position.z},s.body.rotation());
    assert.ok(Math.abs(result.localY-local.y)<1e-6);assert.ok(result.closingSpeed>4);assert.equal(result.surfaceValid,false);
    assert.notEqual(classifyPhysicalContact(result).classification,'effective');break;
   }
  }
  assert.ok(result,'falling chassis must make a real solver contact');
 }finally{sim.dispose();}
});
test('full-pose upright enclosure keeps closed/open results; airborne targets and blockers cannot certify a stop',()=>{
 const car=(x,z,yaw=0,model='suspect')=>({x,z,yaw,model,speed:0,lateralSpeed:0,angularSpeed:0,pose:{y:-.325,quaternion:{x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},upDot:1,tilt:0,headingValid:true,groundedWheels:4,angularSpeed:0,rolloverDisabled:false}});
 const road=controlRoadGeometry([{start:{x:0,z:36},end:{x:0,z:-36},startLeft:{x:-5.5,z:36},startRight:{x:5.5,z:36},endLeft:{x:-5.5,z:-36},endRight:{x:5.5,z:-36}}]);
 const target=car(-4.15,0),cage=[car(-2.95,-3.42,Math.PI/2,'patrol'),car(-2.95,3.42,Math.PI/2,'patrol'),car(-1.8,0,0,'suv')];
 assert.equal(assessVehicleControl(target,cage,road).status,'blocked');
 assert.notEqual(assessVehicleControl(target,cage.slice(1),road).status,'blocked');
 const airborne=c=>({...c,pose:{...c.pose,y:4,groundedWheels:0}});
 const result=assessVehicleControl(airborne(target),cage,road);assert.equal(result.status,'moving');
 assert.equal(advanceControlTimers({heldFor:1,disabledFor:1},result,false,0,1/60).disabledFor,0);
 assert.notEqual(assessVehicleControl(target,cage.map(airborne),road).status,'blocked');
});
