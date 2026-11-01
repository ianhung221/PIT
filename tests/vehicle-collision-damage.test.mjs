import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,stepVehiclePhysics} from './helpers/vehicle-world.mjs';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
import {makeDamageEpisodes,sampleCollisionDamage} from '../lib/vehicleCollisionDamage.ts';
import {pristineDamage,vehicleCanContinue,vehicleCanPerformDriving} from '../lib/vehicleDamage.ts';
import {isDisabledVehicleSettled,advanceControlTimers} from '../lib/vehicleControlAssessment.ts';

test('physical vehicle impact damages both cars while ordinary suspension contact does not',async()=>{
  await RAPIER.init();const f=physicalWorld('patrol'),a=f.vehicle,b=f.add('suspect',0,-8),episodes=makeDamageEpisodes();
  let damage=[pristineDamage(),pristineDamage()];
  try{
    const step=()=>{
      const before=[a,b].map(c=>readVehicleFrame(c.body,c.lastYaw));
      for(const c of [a,b])stepVehiclePhysics(c,{throttle:0,brake:0,steer:0,gear:1});
      f.world.step();
      damage=sampleCollisionDamage(f.world,[{body:a.body,kind:'patrol',damage:damage[0],before:before[0]},{body:b.body,kind:'suspect',damage:damage[1],before:before[1]}],episodes,f.world.timestep*count++);
    };let count=0;
    for(let i=0;i<120;i++)step();
    assert.deepEqual(damage,[pristineDamage(),pristineDamage()]);
    a.body.setLinvel({x:0,y:0,z:-18},true);
    for(let i=0;i<90;i++)step();
    assert.ok(damage[0].body<1,'player receives collision damage');
    assert.ok(damage[1].body<1,'target receives collision damage');
  }finally{f.dispose();}
});
test('steering damage does not disable engine but makes an AI unit unavailable',()=>{
  const damage={...pristineDamage(),steering:0};
  assert.equal(vehicleCanContinue(damage),true);
  assert.equal(vehicleCanPerformDriving(damage),false);
  assert.equal(vehicleCanContinue({...damage,engine:0}),false);
});
test('a physically pushed disabled vehicle resets the settled timer',async()=>{
  await RAPIER.init();const f=physicalWorld('suspect'),target=f.vehicle,pusher=f.add('patrol',0,8);
  try{
    const step=()=>{for(const c of [target,pusher])stepVehiclePhysics(c,{throttle:0,brake:1,steer:0,gear:1});f.world.step();};
    const settled=()=>{const frame=readVehicleFrame(target.body,target.lastYaw),q=target.body.rotation();return isDisabledVehicleSettled({...frame,validPose:[q.x,q.y,q.z,q.w].every(Number.isFinite),groundedWheels:target.groundedWheels,rolloverDisabled:false,groundContact:false});};
    for(let i=0;i<180;i++)step();assert.ok(settled(),'target is initially settled on its wheels');
    let timer={heldFor:0,disabledFor:1};pusher.body.setLinvel({x:0,y:0,z:-18},true);let pushed=false;
    for(let i=0;i<120;i++){step();const frame=readVehicleFrame(target.body,target.lastYaw);if(Math.hypot(frame.velocityX,frame.velocityZ)>.2){timer=advanceControlTimers(timer,{status:'uncertain',reason:'',nodes:0},false,Math.hypot(frame.velocityX,frame.velocityZ),1/60,false,settled());pushed=true;break;}}
    assert.ok(pushed,'another physical vehicle pushes the target');assert.equal(timer.disabledFor,0);
  }finally{f.dispose();}
});
test('physical guardrail impacts damage while an unmoving vehicle does not',async()=>{
  await RAPIER.init();const f=physicalWorld('suv'),core=f.vehicle,episodes=makeDamageEpisodes();let damage=pristineDamage(),count=0;
  try{
    f.world.createCollider(RAPIER.ColliderDesc.cuboid(.16,.6,30).setTranslation(4,0,0).setCollisionGroups((4<<16)|0xffff));
    const step=()=>{const before=readVehicleFrame(core.body,core.lastYaw);stepVehiclePhysics(core,{throttle:0,brake:0,steer:0,gear:1});f.world.step();[damage]=sampleCollisionDamage(f.world,[{body:core.body,kind:'suv',damage,before}],episodes,count++/60);};
    for(let i=0;i<120;i++)step();assert.deepEqual(damage,pristineDamage());
    core.body.setLinvel({x:12,y:0,z:0},true);for(let i=0;i<60;i++)step();
    assert.ok(damage.body<1,'guardrail impact causes damage');
  }finally{f.dispose();}
});
test('all chassis take damage on physical front, rear and side impacts',async()=>{
  await RAPIER.init();
  for(const kind of ['patrol','interceptor','suv','suspect'])for(const side of ['front','rear','left','right']){
    const f=physicalWorld(kind),core=f.vehicle,episodes=makeDamageEpisodes();let damage=pristineDamage(),count=0;
    try{
      const sideHit=side==='left'||side==='right',direction=side==='left'||side==='front'?-1:1;
      const wall=sideHit?RAPIER.ColliderDesc.cuboid(.16,.6,30).setTranslation(direction*4,0,0):RAPIER.ColliderDesc.cuboid(30,.6,.16).setTranslation(0,0,direction*5);
      f.world.createCollider(wall.setCollisionGroups((4<<16)|0xffff));
      const step=()=>{const before=readVehicleFrame(core.body,core.lastYaw);stepVehiclePhysics(core,{throttle:0,brake:0,steer:0,gear:1});f.world.step();[damage]=sampleCollisionDamage(f.world,[{body:core.body,kind,damage,before}],episodes,count++/60);};
      for(let i=0;i<120;i++)step();assert.deepEqual(damage,pristineDamage());
      core.body.setLinvel(sideHit?{x:direction*12,y:0,z:0}:{x:0,y:0,z:direction*18},true);
      for(let i=0;i<100&&damage.body===1;i++)step();
      assert.ok(damage.body<1,`${kind} ${side} impact`);
      if(side==='front')assert.ok(damage.engine<1,`${kind} front impact damages engine`);
      if(side==='rear')assert.ok(damage.rearLeftGrip<1||damage.rearRightGrip<1,`${kind} rear impact damages rear tyre`);
    }finally{f.dispose();}
  }
});
test('a hard chassis landing can cause damage but ordinary spawn settling does not',async()=>{
  await RAPIER.init();const f=physicalWorld('patrol'),core=f.vehicle,episodes=makeDamageEpisodes();let damage=pristineDamage(),count=0;
  try {
    const step=()=>{const before=readVehicleFrame(core.body,core.lastYaw);stepVehiclePhysics(core,{throttle:0,brake:0,steer:0,gear:1});f.world.step();[damage]=sampleCollisionDamage(f.world,[{body:core.body,kind:'patrol',damage,before}],episodes,count++/60);};
    for(let i=0;i<120;i++)step();assert.deepEqual(damage,pristineDamage());
    core.body.setTranslation({x:0,y:3,z:0},true);core.body.setRotation({x:1,y:0,z:0,w:0},true);core.body.setLinvel({x:0,y:-10,z:0},true);
    for(let i=0;i<90;i++)step();assert.ok(damage.body<1,'hard landing damages chassis');
  }finally{f.dispose();}
});
test('continuous guardrail contact across a seam charges only the peak; separation permits another impact',async()=>{
  await RAPIER.init();const f=physicalWorld('suv'),core=f.vehicle,episodes=makeDamageEpisodes();let damage=pristineDamage(),count=0;
  try{
    for(const z of [-15,15])f.world.createCollider(RAPIER.ColliderDesc.cuboid(.16,.6,15).setTranslation(4,0,z).setCollisionGroups((4<<16)|0xffff));
    const step=()=>{const before=readVehicleFrame(core.body,core.lastYaw);stepVehiclePhysics(core,{throttle:0,brake:0,steer:0,gear:1});f.world.step();[damage]=sampleCollisionDamage(f.world,[{body:core.body,kind:'suv',damage,before}],episodes,count++/60);};
    for(let i=0;i<120;i++)step();core.body.setLinvel({x:12,y:0,z:0},true);
    for(let i=0;i<60&&damage.body===1;i++)step();
    assert.ok(damage.body<1);const weak=damage.body;
    core.body.setLinvel({x:12,y:0,z:0},true);step();const first=damage.body;
    assert.ok(first<weak,'a stronger impact adds damage in the same contact');
    for(let i=0;i<19;i++){core.body.setLinvel({x:12,y:0,z:0},true);step();}
    assert.ok(first-damage.body<.005,'same-strength contact is not charged each frame');
    core.body.setTranslation({x:0,y:core.body.translation().y,z:0},true);core.body.setLinvel({x:0,y:0,z:0},true);
    for(let i=0;i<20;i++)step();const beforeSecond=damage.body;
    core.body.setLinvel({x:12,y:0,z:0},true);for(let i=0;i<60&&damage.body===beforeSecond;i++)step();
    assert.ok(damage.body<beforeSecond,'a new collision after separation is counted');
  }finally{f.dispose();}
});
