import test from 'node:test';
import assert from 'node:assert/strict';
import {boxesOverlap,carBox,observeDriving,drivingFootprintOnRoad,drivingPoint} from '../lib/drivingObservation.ts';
import {makeLocalDriving,stepLocalDriving,localCorridorClear} from '../lib/localDriving.ts';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {routePoints} from '../lib/roadRouting.ts';
import {followNetworkRoute} from '../lib/networkDriving.ts';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {chassisShapes,CHASSIS_COLLISION_GROUPS,vehicleSpawnHeight} from '../lib/vehiclePhysicsConfig.ts';
import {escapeRoute,makeNetworkDriver} from '../lib/networkPursuit.ts';
const network=(width=16)=>({version:1,seed:'LOCAL',code:'NET1:LOCAL',nodes:[{id:'a',x:0,z:100,radius:16},{id:'b',x:0,z:-300,radius:16}],edges:[{id:'ab',a:'a',b:'b',width,biome:'country',length:400}],objects:[],towns:[],bounds:{minX:-100,maxX:100,minZ:-350,maxZ:150},spawn:{edge:'ab',from:'a',distance:40}});
const car=(x,z,speed=0,yaw=0)=>({x,z,speed,yaw,lateralSpeed:0,model:'patrol'});
test('broad-phase scan preserves the original exact footprint result for varied arcs',()=>{
 let seed=417;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 for(let run=0;run<400;run++){
  const c=car(rand()*10-5,rand()*10-5,rand()*28,rand()*6-3),turn=rand()*1.6-.8,grip=.58+rand()*.42;
  const cars=Array.from({length:4},()=>car(c.x+rand()*110-55,c.z+rand()*110-55,rand()*10,rand()*6-3));
  const objects=Array.from({length:7},()=>({x:c.x+rand()*110-55,z:c.z+rand()*110-55,halfX:.2+rand()*10,halfZ:.2+rand()*10,yaw:rand()*6-3}));
  const observation={at:0,cars,objects},input={network:network(),car:c,observation,dt:1/60,grip,speed:20,yawError:turn};
  const result=stepLocalDriving(makeLocalDriving(),input),body=carBox(c,.2),others=cars.map(x=>carBox(x,.2)),forward=Math.max(0,c.speed);
  const reach=Math.min(75,Math.max(12,forward*forward/(2*4*Math.max(.25,grip))+forward*.8+8));let expected=Infinity;
  for(let distance=1;distance<=reach;distance++){
   const t=Math.max(-.55,Math.min(.55,turn))*Math.min(1,distance/Math.max(8,forward));
   const p=drivingPoint({...c,yaw:c.yaw+t*.5},0,distance),box={...body,...p,yaw:c.yaw+t};
   if(others.some(o=>boxesOverlap(box,o))||objects.some(o=>boxesOverlap(box,o))){expected=distance;break;}
  }
  assert.equal(result.clearance,expected,`case ${run}`);
 }
});
test('footprints use both headings and cannot cross road edges or thin barriers',()=>{
 assert.equal(boxesOverlap(carBox(car(0,0)),carBox(car(3,0,0,Math.PI/2))),true);
 const n=network(),c=car(2.7,40),observation=observeDriving(n,c,[car(2.7,12)],0);
 const input={network:n,car:c,observation,dt:1/60,grip:1,speed:12,yawError:0};
 assert.equal(localCorridorClear(input,0,40),false);
 assert.equal(localCorridorClear(input,-4.2,40),true);
 assert.equal(drivingFootprintOnRoad(n,carBox(car(7.8,40),.2)),false);
 n.objects.push({id:'wall',kind:'building',x:0,z:20,halfX:8,halfZ:.1,height:3,color:'#000'});
 input.observation=observeDriving(n,c,[],1);
 assert.equal(localCorridorClear(input,-4.2,40),false);
});
test('bounded observation excludes far and occluded cars, and copies observations',()=>{
 const n=network(),c=car(0,50),near=car(2,40),hidden=car(0,0),far=car(0,-200);
 n.objects.push({id:'building',kind:'building',x:0,z:25,halfX:4,halfZ:2,height:3,color:'#000'});
 const view=observeDriving(n,c,[near,hidden,far],3);
 assert.equal(view.cars.length,1);near.x=99;assert.equal(view.cars[0].x,2);
});
test('a new observation invalidates the short forward-scan cache immediately',()=>{
 const n=network(),c=car(2.7,40,8),state=makeLocalDriving();
 const input={network:n,car:c,observation:observeDriving(n,c,[],0),dt:1/60,grip:1,speed:12,yawError:0};
 const clear=stepLocalDriving(state,input);
 assert.equal(clear.clearance,Infinity);
 input.observation=observeDriving(n,c,[car(2.7,27)],1/60);
 const blocked=stepLocalDriving(state,input);
 assert.ok(blocked.clearance<13);
 assert.ok(blocked.speed<clear.speed);
});
test('a shoulder retreat is local, still checks real obstacles, and never permits normal offroad passing',()=>{
 const n=network(),c=car(8,40),observation=observeDriving(n,c,[],0),input={network:n,car:c,observation,dt:1/60,grip:1,speed:2,yawError:0};
 assert.equal(localCorridorClear(input,0,4,true),true);
 assert.equal(localCorridorClear(input,0,4),false);
 input.observation=observeDriving(n,c,[car(8,45)],1);
 assert.equal(localCorridorClear(input,0,4,true),false);
 input.car=car(20,40);input.observation=observeDriving(n,input.car,[],2);
 assert.equal(localCorridorClear(input,0,4,true),false);
});
test('complete obstruction and blocked rear cause waiting, not endless reversing',()=>{
 const n=network(8),c=car(0,30),state=makeLocalDriving();
 n.objects.push({id:'wall',kind:'building',x:0,z:24,halfX:5,halfZ:1,height:3,color:'#000'});
 const observation=observeDriving(n,c,[car(0,36)],0);let out;
 for(let i=0;i<60*15;i++)out=stepLocalDriving(state,{network:n,car:c,observation,dt:1/60,grip:1,speed:12,yawError:0});
 assert.equal(state.mode,'blocked');assert.equal(state.attempts,0);assert.equal(out.speed,0);
});
test('wheel-driven car passes a parked vehicle and stays on the road in clear/rain/snow',async t=>{
 await RAPIER.init();
 for(const grip of [1,.78,.58]){
  const n=network(),sim=physicalWorld();try{
   installNetwork(sim,n);const v=sim.vehicle;v.body.setTranslation({x:2.7,y:vehicleSpawnHeight('patrol'),z:65},true);
   const parked=car(2.7,15),body=sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(parked.x,vehicleSpawnHeight('patrol'),parked.z));
   const colliders=chassisShapes('patrol').map(shape=>sim.world.createCollider(RAPIER.ColliderDesc.cuboid(...shape.halfExtents).setTranslation(...shape.position).setCollisionGroups(CHASSIS_COLLISION_GROUPS),body));
   const points=routePoints(n,[{edge:'ab',from:'a',to:'b'}]),progress={index:0},state=makeLocalDriving();let contacts=0,maxSide=0,reached=false;
   for(let i=0;i<60*50;i++){
    const c={...physicsSnapshot(v),model:'patrol'},base=followNetworkRoute(c,points,progress,grip,state.offset),observation=observeDriving(n,c,[parked],i/60);
    const local=stepLocalDriving(state,{network:n,car:c,observation,dt:1/60,grip,speed:Math.min(12,base.speed),yawError:base.yawError});
    driveVehicleTarget(v,local,grip);sim.world.step();
    for(const col of colliders)sim.world.contactPairsWith(col,other=>{if(other.parent()?.handle===v.body.handle)contacts++;});
    maxSide=Math.max(maxSide,Math.abs(c.x));
    if(c.z< -25){reached=true;break;}
   }
   t.diagnostic(JSON.stringify({grip,reached,contacts,maxSide,mode:state.mode,position:physicsSnapshot(v)}));
   assert.ok(reached,`did not pass parked car: grip=${grip}`);assert.equal(contacts,0);assert.ok(maxSide<7);
  }finally{sim.dispose();}
 }
});

test('physical brake and reverse respect an occupied rear corridor',async t=>{
 await RAPIER.init();
 for(const rearOccupied of [false,true]){
  const n=network(8),sim=physicalWorld();
  n.objects.push({id:'wall',kind:'building',x:0,z:22,halfX:5,halfZ:.5,height:3,color:'#000'});
  try{
   installNetwork(sim,n);const v=sim.vehicle;v.body.setTranslation({x:0,y:vehicleSpawnHeight('patrol'),z:27},true);
   const rear=car(0,32.5),neighbors=rearOccupied?[rear]:[];
   if(rearOccupied){const fixed=sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(rear.x,vehicleSpawnHeight('patrol'),rear.z));for(const s of chassisShapes('patrol'))sim.world.createCollider(RAPIER.ColliderDesc.cuboid(...s.halfExtents).setTranslation(...s.position).setCollisionGroups(CHASSIS_COLLISION_GROUPS),fixed);}
   const state=makeLocalDriving();let minSpeed=0,minZ=Infinity,maxZ=-Infinity;
   for(let i=0;i<60*15;i++){
    const c={...physicsSnapshot(v),model:'patrol'},observation=observeDriving(n,c,neighbors,i/60);
    const control=stepLocalDriving(state,{network:n,car:c,observation,dt:1/60,grip:1,speed:8,yawError:0,allowPass:false});
    driveVehicleTarget(v,control);sim.world.step();minSpeed=Math.min(minSpeed,c.speed);minZ=Math.min(minZ,c.z);maxZ=Math.max(maxZ,c.z);
   }
   t.diagnostic(JSON.stringify({rearOccupied,minSpeed,minZ,maxZ,attempts:state.attempts,mode:state.mode}));
   assert.ok(minZ>24.8,'must not penetrate wall');assert.ok(state.attempts<=2);
   if(rearOccupied){assert.equal(state.attempts,0);assert.ok(minSpeed>-.2);assert.equal(state.mode,'blocked');}
   else assert.ok(minSpeed<-.7,'clear rear should permit an actual wheel-driven retreat');
  }finally{sim.dispose();}
 }
});
test('a reversed suspect on the shoulder replans and physically rejoins without chassis correction',async t=>{
 await RAPIER.init();const n=network(),sim=physicalWorld('suspect'),driver=makeNetworkDriver('RECOVERY');
 try{
  installNetwork(sim,n);
  escapeRoute(n,driver,car(2.7,40),0,1); // route retained from before loss of control
  const v=sim.vehicle;v.body.setTranslation({x:8,y:vehicleSpawnHeight('suspect'),z:0},true);v.body.setRotation({x:0,y:1,z:0,w:0},true);
  let rejoined=false;
  for(let frame=0;frame<60*30;frame++){
   const c={...physicsSnapshot(v),model:'suspect'},target=escapeRoute(n,driver,c,3+frame/60,1,0,[],'basic');
   driveVehicleTarget(v,target);sim.world.step();
   if(c.z>30&&drivingFootprintOnRoad(n,carBox(c))){rejoined=true;break;}
  }
  t.diagnostic(JSON.stringify({rejoined,position:physicsSnapshot(v),driver:driver.local}));assert.ok(rejoined);
 }finally{sim.dispose();}
});
