import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNetworkSupport,stepNetworkSupport} from '../lib/networkSupport.ts';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {chaseRoute,makeNetworkDriver} from '../lib/networkPursuit.ts';
import {locateRoad} from '../lib/roadLocation.ts';
import {vehicleSpawnHeight} from '../lib/vehiclePhysicsConfig.ts';
const network={nodes:[{id:'a',x:0,z:0},{id:'b',x:0,z:-500}],edges:[{id:'ab',a:'a',b:'b',length:500,width:16,biome:'country'}]};
const car=z=>({x:0,z,yaw:0,speed:15,lateralSpeed:0});
const input=()=>({network,player:car(-100),suspect:car(-140),supports:[car(-75),car(-50)],available:[true,true],playerAvailable:true,command:null,commandAt:0,grip:1,dt:1/60});
test('same-road direction reversal replans along connected roads and never invents a U-turn',()=>{
 const nodes=[{id:'a',x:0,z:0},{id:'b',x:0,z:-500},{id:'c',x:200,z:-500},{id:'d',x:200,z:0},{id:'e',x:-200,z:-500},{id:'f',x:-200,z:-700},{id:'g',x:0,z:-700}].map(p=>({...p,radius:16}));
 const edges=[['ab','a','b'],['bc','b','c'],['cd','c','d'],['da','d','a'],['be','b','e'],['ef','e','f'],['fg','f','g'],['gb','g','b']].map(([id,a,b])=>{const x=nodes.find(n=>n.id===a),y=nodes.find(n=>n.id===b);return {id,a,b,length:Math.hypot(x.x-y.x,x.z-y.z),width:16,biome:'country'};});
 const n={version:1,seed:'REVERSE',nodes,edges,objects:[],towns:[],bounds:{minX:-50,maxX:250,minZ:-700,maxZ:50},spawn:{edge:'ab',from:'a',distance:50}};
 const driver=makeNetworkDriver('reverse'),unit={...car(-100),model:'patrol'},target={...car(-160),model:'suspect'};
 const uncached=makeNetworkDriver('shared-target'),cached=makeNetworkDriver('shared-target');
 const original=chaseRoute(n,uncached,unit,target,1,1);
 const reused=chaseRoute(n,cached,unit,target,1,1,15,[],false,false,locateRoad(n,target));
 assert.deepEqual(reused,original);assert.deepEqual(cached.route,uncached.route);
 chaseRoute(n,driver,unit,target,1,1);assert.equal(driver.route.length,1);
 target.yaw=Math.PI;chaseRoute(n,driver,unit,target,2,1);
 assert.equal(driver.blocked,false);assert.ok(driver.route.length>2);
 assert.equal(driver.route.at(-1).edge,'ab');assert.equal(driver.route.at(-1).from,'b');
 assert.ok(driver.route.every((step,i)=>i===0||driver.route[i-1].to===step.from));
 target.yaw=0;target.z=-60;const loopControl=chaseRoute(n,driver,unit,target,3,1);
 assert.equal(driver.blocked,false);assert.ok(driver.route.length>2);
 assert.ok(loopControl.speed>0,'a valid loop must not brake against the direct negative gap');assert.equal(loopControl.arrived,false);
 assert.equal(driver.route.at(-1).from,'a');
 assert.ok(driver.route.every((step,i)=>i===0||driver.route[i-1].to===step.from));
 target.z=-91;chaseRoute(n,driver,unit,target,4,1);assert.match(driver.goalKey,/:behind$/);
 target.z=-96;chaseRoute(n,driver,unit,target,5,1);assert.match(driver.goalKey,/:ahead$/);
 target.yaw=Math.PI;target.z=-160;
 const isolated={...n,nodes:nodes.slice(0,2),edges:edges.slice(0,1)};
 const unavailable=makeNetworkDriver('isolated');chaseRoute(isolated,unavailable,unit,target,2,1);
 assert.equal(unavailable.blocked,true);assert.equal(unavailable.points.length,0);
 const sharpNodes=[{id:'a',x:0,z:0},{id:'b',x:0,z:-500},{id:'c',x:200,z:-250}].map(p=>({...p,radius:16}));
 const sharpEdges=[['ab','a','b'],['bc','b','c'],['ca','c','a']].map(([id,a,b])=>{const x=sharpNodes.find(p=>p.id===a),y=sharpNodes.find(p=>p.id===b);return {id,a,b,length:Math.hypot(x.x-y.x,x.z-y.z),width:16,biome:'country'};});
 const sharp={...n,nodes:sharpNodes,edges:sharpEdges},sharpDriver=makeNetworkDriver('sharp');
 chaseRoute(sharp,sharpDriver,unit,{...target,yaw:0,z:-60},4,1);
 assert.equal(sharpDriver.blocked,true);assert.equal(sharpDriver.points.length,0);
});
test('Q2 follows player, Q3 closes only the selected unit and wet weather increases headway',()=>{
 const a=input();
 const normal=stepNetworkSupport(makeNetworkSupport(),a);
 const ready=stepNetworkSupport(makeNetworkSupport(),{...a,command:'prepare-pit'});
 const close=stepNetworkSupport(makeNetworkSupport(),{...a,command:'move-up'});
 const snow=stepNetworkSupport(makeNetworkSupport(),{...a,grip:.58});
 assert.equal(ready.slots[0].target,a.player);assert.ok(ready.slots[0].gap>normal.slots[0].gap);
 assert.ok(close.slots[0].gap<normal.slots[0].gap);assert.equal(close.slots[1].gap,normal.slots[1].gap);
 assert.ok(snow.slots[0].gap>normal.slots[0].gap);
});
test('Q5 does not claim takeover until ahead, and Q2 returns an available player to lead',()=>{
 const a={...input(),command:'take-primary'},state=makeNetworkSupport();
 let output;
 for(let i=0;i<120;i++)output=stepNetworkSupport(state,a);
 assert.equal(output.leader,null);assert.equal(output.candidate,0);assert.equal(output.slots[0].role,'secondary');
 a.supports[0]=car(-112);
 for(let i=0;i<40;i++)output=stepNetworkSupport(state,a);
 assert.equal(output.leader,0);assert.equal(output.slots[0].role,'primary');
 output=stepNetworkSupport(state,{...a,command:'prepare-pit',commandAt:3});
 assert.equal(output.leader,null);assert.equal(output.candidate,null);
});
test('03 substitutes when 02 is unavailable; no available unit cannot become the leader',()=>{
 const a={...input(),available:[false,true],command:'take-primary'};
 const output=stepNetworkSupport(makeNetworkSupport(),a);
 assert.equal(output.candidate,1);assert.equal(output.slots[0].role,'unavailable');
 const none=stepNetworkSupport(makeNetworkSupport(),{...a,available:[false,false]});
 assert.equal(none.candidate,null);assert.equal(none.leader,null);
});

test('Q5 candidate physically passes a moving player before claiming lead',async t=>{
 await RAPIER.init();
 const n={...network,version:1,seed:'TAKEOVER',nodes:network.nodes.map(p=>({...p,radius:16})),objects:[],towns:[],bounds:{minX:-100,maxX:100,minZ:-550,maxZ:50},spawn:{edge:'ab',from:'a',distance:50}};
 for(const grip of [1,.58]){
  const sim=physicalWorld();try{
   installNetwork(sim,n);sim.remove(sim.vehicle);
   const models=['patrol','suspect','patrol','suv'],vehicles=models.map((kind,i)=>sim.add(kind,2.7,[-100,-145,-65,-45][i]));
   for(const v of vehicles)v.body.setTranslation({...v.body.translation(),y:vehicleSpawnHeight(v.kind??'patrol')},true);
   const state=makeNetworkSupport(),drivers=[makeNetworkDriver('02'),makeNetworkDriver('03')];let tookAt=null,contacts=0;
   for(let frame=0;frame<60*40;frame++){
    const [player,suspect,...supports]=vehicles.map((v,i)=>({...physicsSnapshot(v),model:models[i],id:String(i)}));
    const result=stepNetworkSupport(state,{network:n,player,suspect,supports,available:[true,true],playerAvailable:true,command:'take-primary',commandAt:0,grip,dt:1/60});
    driveVehicleTarget(vehicles[0],{speed:8,yawError:-player.yaw},grip);driveVehicleTarget(vehicles[1],{speed:9,yawError:-suspect.yaw},grip);
    for(let unit=0;unit<2;unit++){
     const slot=result.slots[unit];
     driveVehicleTarget(vehicles[unit+2],chaseRoute(n,drivers[unit],supports[unit],slot.target,frame/60,grip,slot.gap,[player,suspect,supports[1-unit]],slot.allowOvertake),grip);
    }
    sim.world.step();
    for(let i=0;i<vehicles[0].body.numColliders();i++)sim.world.contactPairsWith(vehicles[0].body.collider(i),other=>{if(other.parent()?.handle===vehicles[2].body.handle)contacts++;});
    if(result.leader===0){tookAt=frame/60;break;}
   }
   t.diagnostic(JSON.stringify({grip,tookAt,contacts,state,drivers:drivers.map(d=>d.local),positions:vehicles.map(physicsSnapshot)}));
   assert.notEqual(tookAt,null);assert.equal(contacts,0);
  }finally{sim.dispose();}
 }
});
