import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {sampleVehiclePhysics} from '../lib/vehiclePhysics.ts';
import {makeRolloverState,updateRollover} from '../lib/vehicleRollover.ts';
import {coordinatePursuit} from '../lib/pursuitCoordinator.ts';
await RAPIER.init();
test('airborne, still rolling and transient tilt do not disable propulsion; stable roof contact does',()=>{
 const settled={upDot:-1,groundedWheels:0,groundContact:true,planarSpeed:0,angularSpeed:0,verticalSpeed:0};
 for(const change of [{groundContact:false},{angularSpeed:.13},{planarSpeed:.66},{verticalSpeed:1},{upDot:.5}]){
  const state=makeRolloverState();for(let i=0;i<180;i++)updateRollover(state,{...settled,...change},1/60);
  assert.equal(state.disabled,false,JSON.stringify(change));
 }
 const state=makeRolloverState();for(let i=0;i<59;i++)updateRollover(state,settled,1/60);assert.equal(state.disabled,false);
 for(let i=0;i<2;i++)updateRollover(state,settled,1/60);assert.equal(state.disabled,true);
 updateRollover(state,{...settled,groundContact:false},1/60);assert.equal(state.disabled,true,'being knocked airborne does not restore a disabled vehicle');
 for(let i=0;i<61;i++)updateRollover(state,{...settled,upDot:1,groundedWheels:4},1/60);
 assert.equal(state.disabled,false);
});
test('a real curb collision can overturn each chassis; disabled state waits for actual ground settling',()=>{
 for(const kind of ['patrol','interceptor','suv','suspect']){
  const s=physicalWorld(kind);try{
   for(let i=0;i<120;i++)s.step();
   const height=.4,speed=kind==='interceptor'?40:35;
   const curb=s.world.createCollider(RAPIER.ColliderDesc.cuboid(.2,height/2,10).setTranslation(3,-.505+height/2,0).setFriction(1).setCollisionGroups((4<<16)|0xffff));
   // Initial sideways crash velocity only. Rotation/rollover flags are never injected.
   s.vehicle.body.setLinvel({x:speed,y:0,z:0},true);
   let collision=false,airborne=false,disabledAt=null,maxTilt=0;
   for(let i=0;i<900;i++){
    s.step();sampleVehiclePhysics(s.vehicle,1/60);
    for(let j=0;j<s.vehicle.body.numColliders();j++)s.world.contactPair(s.vehicle.body.collider(j),curb,m=>{if(m.numSolverContacts())collision=true;});
    const p=physicsSnapshot(s.vehicle);maxTilt=Math.max(maxTilt,p.pose.tilt);
    if(p.pose.groundedWheels===0&&!s.vehicle.disabled)airborne=true;
    if(s.vehicle.disabled){disabledAt=i/60;assert.ok(p.pose.angularSpeed<.12);assert.ok(Math.hypot(p.speed,p.lateralSpeed)<.65);break;}
   }
   assert.ok(collision&&airborne,kind);assert.ok(maxTilt>Math.PI/2,kind);assert.ok(disabledAt>1&&disabledAt<15,kind);
   const start=physicsSnapshot(s.vehicle);
   for(let i=0;i<120;i++){s.step({throttle:1,brake:0,steer:1,gear:1});sampleVehiclePhysics(s.vehicle,1/60);}
   const end=physicsSnapshot(s.vehicle);assert.equal(end.pose.rolloverDisabled,true);
   assert.ok(Math.hypot(end.x-start.x,end.z-start.z)<.05,'disabled chassis must not gain propulsion');
   assert.equal(end.pose.headingValid,false,'roll must not be reported as valid horizontal PIT yaw');
  }finally{s.dispose();}
 }
});
test('an unavailable backup cannot be designated primary and does not silently replace tactical planning',()=>{
 const input={command:'take-primary',pitQualified:false,suspectStopped:false,suspectDriveable:true,playerDriveability:1};
 assert.equal(coordinatePursuit(input).unit2,'primary');
 assert.deepEqual(coordinatePursuit({...input,unit2Available:false}),{player:'primary',unit2:'unavailable',unit3:'tertiary',phase:'pursuit'});
 assert.equal(coordinatePursuit({...input,unit3Available:false}).unit3,'unavailable');
});
