import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,stepVehiclePhysics} from './helpers/vehicle-world.mjs';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
import {physicalContactSample} from '../lib/physicalContactSample.ts';
import {classifyPhysicalContact} from '../lib/pitContact.ts';
import {makeDamageEpisodes,sampleCollisionDamage} from '../lib/vehicleCollisionDamage.ts';
import {pristineDamage,vehicleCanContinue,applySeverityDamage} from '../lib/vehicleDamage.ts';

test('five separated real front-corner contacts leave engine power on each player chassis',async t=>{
 await RAPIER.init();
 for(const kind of ['patrol','interceptor','suv']){
  const f=physicalWorld(kind),a=f.vehicle,b=f.add('suspect',0,-30),episodes=makeDamageEpisodes();let damage=[pristineDamage(),pristineDamage()],tick=0;
  const step=()=>{const before=[a,b].map(v=>readVehicleFrame(v.body,v.lastYaw));for(const [i,v] of [a,b].entries())stepVehiclePhysics(v,{throttle:0,brake:0,steer:0,gear:1},1,damage[i]);f.world.step();const contact=physicalContactSample(f.world,a.body,b.body,readVehicleFrame(a.body),readVehicleFrame(b.body),{player:before[0],suspect:before[1]},kind,true);damage=sampleCollisionDamage(f.world,[{body:a.body,kind,damage:damage[0],before:before[0]},{body:b.body,kind:'suspect',damage:damage[1],before:before[1]}],episodes,tick++/60);return contact;};
  try{
   for(let i=0;i<120;i++)step();const trace=[];
   for(let shot=0;shot<5;shot++){
    a.body.setTranslation({x:20,y:-.31,z:0},true);b.body.setTranslation({x:0,y:-.31,z:0},true);
    for(const v of [a,b]){v.body.setRotation({x:0,y:0,z:0,w:1},true);v.body.setLinvel({x:0,y:0,z:0},true);v.body.setAngvel({x:0,y:0,z:0},true);}for(let i=0;i<15;i++)step();
    a.body.setTranslation({x:2.05,y:-.31,z:3.9},true);a.body.setLinvel({x:-7,y:0,z:-16},true);b.body.setLinvel({x:0,y:0,z:-12},true);
    let first;for(let i=0;i<30;i++){const contact=step();if(contact&&!first)first=contact;}
    assert.ok(first,`${kind}: missing physical contact ${shot+1}`);assert.equal(classifyPhysicalContact(first).classification,'effective');assert.ok(first.normalSpeed>6&&first.normalSpeed<8);
    trace.push({engine:damage[0].engine,steering:damage[0].steering,alignment:damage[0].alignment,tyre:Math.min(damage[0].frontLeftGrip,damage[0].frontRightGrip)});
   }
   assert.ok(vehicleCanContinue(damage[0]),`${kind}: no engine power after reference impacts`);assert.ok(damage[0].engine<1&&damage[1].body<1);
   // Observe remaining physical steering rather than treating engine power as
   // proof the damaged vehicle handles like a healthy one.
   a.body.setTranslation({x:30,y:-.31,z:0},true);a.body.setRotation({x:0,y:0,z:0,w:1},true);a.body.setLinvel({x:0,y:0,z:-12},true);a.body.setAngvel({x:0,y:0,z:0},true);
   for(let i=0;i<60;i++){stepVehiclePhysics(a,{throttle:.3,brake:0,steer:.6,gear:1},1,damage[0]);stepVehiclePhysics(b,{throttle:0,brake:0,steer:0,gear:1},1,damage[1]);f.world.step();}
   const after=readVehicleFrame(a.body);t.diagnostic(JSON.stringify({kind,trace,afterSpeed:after.planarSpeed,afterYaw:after.yaw}));
   assert.ok(after.planarSpeed>1&&Math.abs(after.yaw)>.005,`${kind}: no physical steering response`);
  }finally{f.dispose();}
 }
});

test('front-corner damage interpolates continuously and strong central impacts remain serious',()=>{
 const impact={impulse:0,halfWidth:1,halfLength:2,localZ:-1.8};
 const centre=applySeverityDamage(pristineDamage(),{...impact,localX:0},.72);
 const middle=applySeverityDamage(pristineDamage(),{...impact,localX:.7},.72);
 const corner=applySeverityDamage(pristineDamage(),{...impact,localX:1},.72);
 assert.ok(centre.engine<middle.engine&&middle.engine<corner.engine);
 assert.ok(centre.engine<.6,'a strong central crash damages the engine');
 assert.ok(corner.frontRightGrip<1&&corner.body<1,'a corner impact still causes damage');
 for(const x of [.4499,.4501,.8999,.9001])assert.ok(Number.isFinite(applySeverityDamage(pristineDamage(),{...impact,localX:x},.4).engine));
});
