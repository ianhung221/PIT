import test from 'node:test';
import assert from 'node:assert/strict';
import {turnaroundAreaClear} from '../lib/safeTurnaround.ts';
import {chaseRoute,makeNetworkDriver} from '../lib/networkPursuit.ts';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {carBox,drivingFootprintOnRoad} from '../lib/drivingObservation.ts';
const network=width=>({version:1,seed:'TURN',nodes:[{id:'a',x:0,z:100,radius:16},{id:'b',x:0,z:-400,radius:16}],edges:[{id:'ab',a:'a',b:'b',length:500,width,biome:'highway'}],objects:[],towns:[],bounds:{minX:-100,maxX:100,minZ:-450,maxZ:150},spawn:{edge:'ab',from:'a',distance:50}});
const unit={x:2.7,z:0,yaw:0,speed:0,lateralSpeed:0,model:'patrol'};
test('turn envelope rejects narrow roads and occupied or approaching paths',()=>{
 assert.equal(turnaroundAreaClear(network(22),unit,[]),true);
 assert.equal(turnaroundAreaClear(network(12),unit,[]),false);
 assert.equal(turnaroundAreaClear(network(22),unit,[{...unit,x:-3,z:0,model:'suv'}]),false);
 assert.equal(turnaroundAreaClear(network(22),unit,[{...unit,x:-3,z:-20,yaw:Math.PI,speed:3,model:'suv'}]),false);
 const blocked=network(22);assert.equal(turnaroundAreaClear(blocked,unit,[]),true);
 blocked.objects.push({id:'box',kind:'building',x:-3,z:0,halfX:.5,halfZ:.5,height:2,color:'#000'});
 assert.equal(turnaroundAreaClear(blocked,unit,[]),false);
});
test('a new obstruction cancels a turn and orders a stop',()=>{
 const n=network(22),driver=makeNetworkDriver('turn'),target={...unit,x:-2.7,z:20,yaw:Math.PI,speed:3,model:'suspect'};
 let control=chaseRoute(n,driver,unit,target,1,1,14,[target],false,true);
 assert.ok(driver.turnaround);assert.ok(control.speed>0);
 const obstacle={...unit,x:-2,z:0,model:'suv'};
 control=chaseRoute(n,driver,unit,target,1.2,1,14,[target,obstacle],false,true);
 assert.equal(control.speed,0);assert.equal(driver.turnaround,undefined);assert.match(driver.turnaroundReason,/受阻/);
});
test('a moving unit brakes before a clear wide-road turn',()=>{
 const n=network(22),driver=makeNetworkDriver('brake-for-turn');
 const target={...unit,x:-2.7,z:30,yaw:Math.PI,speed:2};
 const control=chaseRoute(n,driver,{...unit,speed:5},target,1,1,14,[target],false,true);
 assert.equal(control.speed,0);
 assert.equal(driver.turnaround,undefined);
});
test('cancelling a narrow-road search stops and discards the search',()=>{
 const n=network(16),driver=makeNetworkDriver('cancel-narrow');
 const target={...unit,x:-2.7,z:25,yaw:Math.PI,speed:2};
 chaseRoute(n,driver,unit,target,1,1,14,[target],false,true);
 assert.ok(driver.narrowTurn);
 const result=chaseRoute(n,driver,unit,target,1.1,1,14,[target],false,false);
 assert.equal(result.speed,0);
 assert.equal(driver.narrowTurn,undefined);
 assert.equal(driver.turnaroundStopping,true);
});
test('a new obstacle stops a narrow turn before advancing into it',async()=>{
 await RAPIER.init();
 const n=network(16),sim=physicalWorld('patrol');
 try{
  installNetwork(sim,n);
  sim.vehicle.body.setTranslation({x:2.7,y:-.315,z:0},true);
  const target={...unit,x:-2.7,z:25,yaw:Math.PI,speed:0};
  const driver=makeNetworkDriver('blocked-narrow');
  let moving=false;
  for(let frame=0;frame<1800;frame++){
   const car={...physicsSnapshot(sim.vehicle),model:'patrol'};
   const control=chaseRoute(n,driver,car,target,frame/60,1,14,[target],false,true);
   driveVehicleTarget(sim.vehicle,control);
   sim.world.step();
   if(driver.narrowTurn?.plan&&Math.abs(control.speed)>.1){moving=true;break;}
  }
  assert.equal(moving,true);
  const car={...physicsSnapshot(sim.vehicle),model:'patrol'};
  const obstacle={...car,id:'obstacle',speed:0,lateralSpeed:0};
  const stopped=chaseRoute(n,driver,car,target,31,1,14,[target,obstacle],false,true);
  assert.equal(stopped.speed,0);
  assert.equal(driver.narrowTurn,undefined);
  assert.match(driver.turnaroundReason,/受阻/);
 }finally{sim.dispose();}
});
test('turn is not started on narrow roads, at speed, or after cancellation',()=>{
 const target={...unit,x:-2.7,z:20,yaw:Math.PI,speed:3,model:'suspect'};
 for(const [n,c] of [[network(12),unit],[network(22),{...unit,speed:10}],[network(22),{...unit,yaw:.4}]]){
  const driver=makeNetworkDriver('not-safe');chaseRoute(n,driver,c,target,1,1,14,[target],false,true);
  assert.equal(driver.turnaround,undefined);
 }
 const n=network(22),driver=makeNetworkDriver('cancel');chaseRoute(n,driver,unit,target,1,1,14,[target],false,true);assert.ok(driver.turnaround);
 const stopped=chaseRoute(n,driver,{...unit,speed:1},target,1.2,1,14,[target],false,false);
 assert.equal(driver.turnaround,undefined);assert.equal(stopped.speed,0);assert.equal(driver.turnaroundStopping,true);assert.match(driver.turnaroundReason,/取消/);
 const settled=chaseRoute(n,driver,unit,target,1.3,1,14,[target],false,false);
 assert.equal(settled.speed,0);assert.equal(driver.turnaroundStopping,false);
});
test('wheel-driven backup completes a clear U-turn on dry and snowy wide roads',async t=>{
 await RAPIER.init();
 for(const model of ['patrol','suv'])for(const grip of [1,.58]){
  const n=network(22),sim=physicalWorld(model);try{
   installNetwork(sim,n);const unitBody=sim.vehicle;unitBody.body.setTranslation({x:2.7,y:-.315,z:0},true);
   const targetBody=sim.add('suspect',-2.7,20);targetBody.body.setRotation({x:0,y:1,z:0,w:0},true);
   const driver=makeNetworkDriver(`turn-${model}-${grip}`);let started=false,done=false,offRoad=false,contacts=0;
   for(let frame=0;frame<60*35;frame++){
    const c={...physicsSnapshot(unitBody),model},target={...physicsSnapshot(targetBody),model:'suspect'};
    offRoad||=!drivingFootprintOnRoad(n,carBox(c,.1));
    const control=chaseRoute(n,driver,c,target,frame/60,grip,14,[target],false,true);
    started||=!!driver.turnaround;driveVehicleTarget(unitBody,control,grip);driveVehicleTarget(targetBody,{speed:5,yawError:0},grip);sim.world.step();
    for(let j=0;j<unitBody.body.numColliders();j++)sim.world.contactPairsWith(unitBody.body.collider(j),o=>{if(o.parent()?.handle===targetBody.body.handle)contacts++;});
    if(driver.turnaroundReason==='已完成迴轉，重新追蹤'){done=true;break;}
   }
   t.diagnostic(JSON.stringify({model,grip,started,done,offRoad,contacts,position:physicsSnapshot(unitBody),reason:driver.turnaroundReason}));
   assert.equal(started,true);assert.equal(done,true);assert.equal(offRoad,false);assert.equal(contacts,0);
  }finally{sim.dispose();}
 }
});

test('after turning, backup follows a moving player and closes distance',async t=>{
 await RAPIER.init();
 for(const width of [22,16])for(const model of ['patrol','suv'])for(const grip of [1,.78,.58]){
  const n=network(width);
  n.nodes[0].z=1000;
  n.edges[0].length=1400;
  n.bounds.maxZ=1050;
  const sim=physicalWorld(model);
  try{
   installNetwork(sim,n);
   const backup=sim.vehicle;
   backup.body.setTranslation({x:2.7,y:-.315,z:0},true);
   backup.body.setLinvel({x:0,y:0,z:-5},true);
   const player=sim.add('patrol',-2.7,20);
   player.body.setRotation({x:0,y:1,z:0,w:0},true);
   const driver=makeNetworkDriver(`follow-${model}-${grip}`);
   let turnedAt=null,initialGap=null,closedAt=null,contacts=0,offRoad=false;
   for(let frame=0;frame<60*75;frame++){
    const car={...physicsSnapshot(backup),model};
    const target={...physicsSnapshot(player),model:'patrol'};
    const gap=Math.hypot(car.x-target.x,car.z-target.z);
    offRoad ||= !drivingFootprintOnRoad(n,carBox(car,.1));
    const control=chaseRoute(n,driver,car,target,frame/60,grip,14,[target],false,true);
    driveVehicleTarget(backup,control,grip);
    driveVehicleTarget(player,{speed:4,yawError:0},grip);
    sim.world.step();
    for(let i=0;i<backup.body.numColliders();i++)sim.world.contactPairsWith(backup.body.collider(i),o=>{if(o.parent()?.handle===player.body.handle)contacts++;});
    if(turnedAt===null&&driver.turnaroundReason==='已完成迴轉，重新追蹤'){
     turnedAt=frame/60;initialGap=gap;
    }
    if(turnedAt!==null&&frame/60>turnedAt+1&&gap<25&&car.speed>1){closedAt=frame/60;break;}
   }
   t.diagnostic(JSON.stringify({width,model,grip,turnedAt,initialGap,closedAt,offRoad,contacts,reason:driver.turnaroundReason}));
   assert.notEqual(turnedAt,null);
   assert.notEqual(closedAt,null);
   assert.equal(offRoad,false);
   assert.equal(contacts,0);
  }finally{sim.dispose();}
 }
});
