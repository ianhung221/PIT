import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBlockade,stepBlockade,blockadeControl,waitForBlockadeRetry} from '../lib/supportContainment.ts';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {parkingRecoveryClear} from '../lib/parkingRecovery.ts';
import {carBox,drivingFootprintOnRoad} from '../lib/drivingObservation.ts';
const network={version:1,seed:'CONTAIN',code:'NET1:CONTAIN',nodes:[{id:'a',x:0,z:100,radius:16},{id:'b',x:0,z:-300,radius:16}],edges:[{id:'ab',a:'a',b:'b',length:400,width:16,biome:'country'}],objects:[],towns:[],bounds:{minX:-100,maxX:100,minZ:-350,maxZ:150},spawn:{edge:'ab',from:'a',distance:50}};
const road={network,segments:[],seed:'CONTAIN',code:'NET1:CONTAIN'};
const car=(x,z)=>({x,z,yaw:0,speed:0,lateralSpeed:0});
test('parking correction requires a clear road envelope and checks moving vehicles',()=>{
 const unit={...car(-3.9,-5.6),yaw:.56,model:'patrol'},anchor={x:0,z:0,yaw:0},target={...car(0,0),yaw:Math.PI,model:'suspect'};
 assert.equal(parkingRecoveryClear(road,anchor,unit,[target]),true);
 assert.equal(parkingRecoveryClear(road,anchor,unit,[target,{...car(-1,-16),model:'suv'}]),false);
 assert.equal(parkingRecoveryClear(road,anchor,unit,[target,{...car(-1,-26),model:'suv',speed:-4}]),false);
 const narrow={...network,edges:network.edges.map(e=>({...e,width:8})),objects:[]};
 assert.equal(parkingRecoveryClear({...road,network:narrow},anchor,unit,[target]),false);
});
test('parking correction stops when a new vehicle occupies its envelope',()=>{
 const state=makeBlockade();state.phase='approaching';state.anchor={x:0,z:0,yaw:0,index:0,side:-3.3,front:5.35,rear:5.3};state.stages=[3,0];
 state.parkingRecovery={phase:'shift',sideSign:-1,elapsed:1,checkIn:0,clear:true};state.parkingAttempts=1;
 const unit={...car(-3.9,-5.6),yaw:.56,model:'patrol'},suspect={...car(0,0),yaw:Math.PI,model:'suspect'},obstacle={...car(-1,-16),model:'suv'};
 const result=blockadeControl(state,0,unit,suspect,[suspect,obstacle],road,1/60,1);
 assert.equal(result.speed,0);assert.equal(result.arrived,false);assert.equal(state.parkingRecovery,undefined);
});
test('temporarily blocked correction can be reconsidered but checks remain bounded',()=>{
 const unit={...car(-3.9,-5.6),yaw:.56,model:'patrol'},suspect={...car(0,0),yaw:Math.PI,model:'suspect'},obstacle={...car(-1,-16),model:'suv'};
 const setup=()=>{const state=makeBlockade();state.phase='approaching';state.anchor={x:0,z:0,yaw:0,index:0,side:-3.3,front:5.35,rear:5.3};state.stages=[3,0];return state;};
 const step=(state,neighbors)=>{for(let i=0;i<13;i++)blockadeControl(state,0,unit,suspect,neighbors,road,.1,1);};
 const state=setup();step(state,[suspect,obstacle]);assert.equal(state.parkingAttempts,1);assert.equal(state.parkingRecovery,undefined);
 step(state,[suspect]);assert.ok(state.parkingRecovery);assert.equal(state.parkingAttempts,5);
 const blocked=setup();for(let i=0;i<10;i++)step(blocked,[suspect,obstacle]);
 assert.equal(blocked.parkingAttempts,5);assert.equal(blocked.parkingRecovery,undefined);
});
test('nearby backup waits during replan only while target is slow',()=>{
 const state=makeBlockade(),suspect=car(0,0),near=car(0,-10),far=car(0,-80);
 assert.equal(waitForBlockadeRetry(state,near,suspect),false);
 state.phase='missed';assert.equal(waitForBlockadeRetry(state,near,suspect),true);
 assert.equal(waitForBlockadeRetry(state,far,suspect),false);
 suspect.speed=8;assert.equal(waitForBlockadeRetry(state,near,suspect),false);
});
test('network blockade selects the nearby front unit, holds roles, and waits for rotation',()=>{
 for(const frontUnit of [0,1]){
  const supports=[car(0,18),car(0,18)];supports[frontUnit]=car(0,-14);
  const state=makeBlockade(),input={road,index:0,suspect:car(0,0),supports,player:car(-6,30),dt:1/60};
  for(let i=0;i<30;i++)stepBlockade(state,input);
  assert.equal(state.phase,'approaching');assert.equal(state.frontUnit,frontUnit);
  supports[frontUnit].x+=.01;stepBlockade(state,input);assert.equal(state.frontUnit,frontUnit);
 }
 const spinning=makeBlockade(),input={road,index:0,suspect:{...car(0,0),pose:{groundedWheels:4,angularSpeed:1.5}},supports:[car(0,-14),car(0,18)],player:car(-6,30),dt:1/60};
 for(let i=0;i<120;i++)stepBlockade(spinning,input);
 assert.equal(spinning.phase,'waiting');
});
test('slow target displacement updates parking slots only after safe revalidation',()=>{
 const input={road,index:0,suspect:car(0,0),supports:[car(0,-14),car(0,18)],player:car(-6,30),dt:1/60};
 const state=makeBlockade();for(let i=0;i<30;i++)stepBlockade(state,input);
 assert.equal(state.phase,'approaching');assert.ok(state.stages[state.frontUnit]>=2);
 input.suspect=car(0,-1);stepBlockade(state,input);
 assert.equal(state.phase,'approaching');assert.equal(state.anchor.z,-1);
 const beforePass=makeBlockade();for(let i=0;i<30;i++)stepBlockade(beforePass,{...input,suspect:car(0,0)});
 beforePass.stages[beforePass.frontUnit]=1;stepBlockade(beforePass,input);
 assert.equal(beforePass.phase,'missed');
});
test('wheel-driven front unit corrects an oblique stalled approach without collision',async t=>{
 await RAPIER.init();
 for(const grip of [1,.58]){
  const sim=physicalWorld('suspect');try{
   installNetwork(sim,network);const target=sim.vehicle;
   target.body.setTranslation({x:0,y:-.315,z:0},true);target.body.setRotation({x:0,y:1,z:0,w:0},true);
   const front=sim.add('patrol',-3.9,-5.6),rear=sim.add('suv',0,5.4);
   front.body.setRotation({x:0,y:Math.sin(.56/2),z:0,w:Math.cos(.56/2)},true);
   const state=makeBlockade();state.phase='approaching';state.anchor={x:0,z:0,yaw:0,index:0,side:-3.3,front:5.35,rear:5.3};state.stages=[3,0];
   const player=car(7,30);let contact=0,settled=false,recovered=false,offRoad=false;
   for(let frame=0;frame<60*50;frame++){
    const suspect={...physicsSnapshot(target),model:'suspect'},supports=[{...physicsSnapshot(front),model:'patrol'},{...physicsSnapshot(rear),model:'suv'}];
    offRoad||=!drivingFootprintOnRoad(network,carBox(supports[0],.2));
    stepBlockade(state,{road,index:0,suspect,supports,player,dt:1/60});
    driveVehicleTarget(target,{speed:0,yawError:0},grip);driveVehicleTarget(rear,{speed:0,yawError:0},grip);
    const output=blockadeControl(state,0,supports[0],suspect,[suspect,player,supports[1]],road,1/60,grip);
    recovered||=!!state.parkingRecovery;driveVehicleTarget(front,output??{speed:0,yawError:0},grip);sim.world.step();
    for(let i=0;i<target.body.numColliders();i++)sim.world.contactPairsWith(target.body.collider(i),other=>{if(other.parent()?.handle===front.body.handle)contact++;});
    if(state.settled[0]>.8){settled=true;break;}
   }
   t.diagnostic(JSON.stringify({grip,settled,recovered,contact,offRoad,state,front:physicsSnapshot(front)}));
   assert.equal(recovered,true);assert.equal(contact,0);assert.equal(offRoad,false);assert.equal(settled,true);
  }finally{sim.dispose();}
 }
});
test('player already guarding an end does not receive another backup in the same slot',()=>{
 const state=makeBlockade(),input={road,index:0,suspect:car(0,0),supports:[car(0,-20),car(0,18)],player:car(0,-5.1),dt:1/60,available:[false,true]};
 for(let i=0;i<30;i++)stepBlockade(state,input);
 assert.equal(state.phase,'approaching');
 const playerRole=state.playerCovered[0]?state.frontUnit:1-state.frontUnit;
 assert.equal(playerRole,0);assert.equal(state.available[1],true);
});
test('local shoulder parking still rejects real objects covering both stopping positions',()=>{
 const n={...network,objects:[]},input={road:{...road,network:n},index:0,suspect:car(8,0),supports:[car(8,-14),car(8,18)],player:car(-6,30),dt:1/60};
 let state=makeBlockade();for(let i=0;i<30;i++)stepBlockade(state,input);assert.equal(state.phase,'approaching');
 n.objects.push(...[-5,5].map(z=>({id:`obstacle-${z}`,kind:'building',x:8,z,halfX:3,halfZ:2,height:3,color:'#000'})));
 state=makeBlockade();for(let i=0;i<30;i++)stepBlockade(state,input);assert.equal(state.phase,'missed');
});
test('both model assignments physically approach and park around a braking, unlocked target',async t=>{
 await RAPIER.init();
 for(const frontUnit of [0,1])for(const grip of [1,.78,.58])for(const x of [0,8]){
  const sim=physicalWorld('suspect');try{
   installNetwork(sim,network);const target=sim.vehicle;
   target.body.setTranslation({x,y:-.315,z:0},true);
   const units=['patrol','suv'].map((kind,i)=>sim.add(kind,x,i===frontUnit?-14:18)),state=makeBlockade();let held=0,contacts=0;
   for(let frame=0;frame<60*45;frame++){
    const suspect=physicsSnapshot(target),supports=units.map(physicsSnapshot),player=car(-6,30),input={road,index:0,suspect,supports,player,dt:1/60};
    stepBlockade(state,input);driveVehicleTarget(target,{speed:0,yawError:0},grip);
    for(let unit=0;unit<2;unit++){
     const control=blockadeControl(state,unit,supports[unit],suspect,[suspect,player,supports[1-unit]],road,1/60,grip);
     driveVehicleTarget(units[unit],control??{speed:0,yawError:0},grip);
     for(let c=0;c<target.body.numColliders();c++)sim.world.contactPairsWith(target.body.collider(c),other=>{if(other.parent()?.handle===units[unit].body.handle)contacts++;});
    }
    sim.world.step();held=state.phase==='holding'?held+1/60:0;if(held>1)break;
   }
   t.diagnostic(JSON.stringify({frontUnit,grip,held,contacts,state,positions:units.map(physicsSnapshot)}));
   assert.ok(held>1);assert.equal(contacts,0);assert.equal(state.frontUnit,frontUnit);
  }finally{sim.dispose();}
 }
});
