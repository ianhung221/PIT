import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBlockade,stepBlockade,blockadeControl,waitForBlockadeRetry,controlsDeparture,containmentPose} from '../lib/supportContainment.ts';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {parkingRecoveryClear} from '../lib/parkingRecovery.ts';
import {makeDamageEpisodes,sampleCollisionDamage} from '../lib/vehicleCollisionDamage.ts';
import {pristineDamage} from '../lib/vehicleDamage.ts';
import {readVehicleFrame} from '../lib/vehiclePose.ts';
import {generateNetwork} from '../lib/networkGenerator.ts';
import {chaseRoute,makeNetworkDriver} from '../lib/networkPursuit.ts';
import {vehicleSpawnHeight} from '../lib/vehiclePhysicsConfig.ts';
import {carBox,drivingFootprintOnRoad,localIncidentFootprintClear} from '../lib/drivingObservation.ts';
const network={version:1,seed:'CONTAIN',code:'NET1:CONTAIN',nodes:[{id:'a',x:0,z:100,radius:16},{id:'b',x:0,z:-300,radius:16}],edges:[{id:'ab',a:'a',b:'b',length:400,width:16,biome:'country'}],objects:[],towns:[],bounds:{minX:-100,maxX:100,minZ:-350,maxZ:150},spawn:{edge:'ab',from:'a',distance:50}};
const road={network,segments:[],seed:'CONTAIN',code:'NET1:CONTAIN'};
const car=(x,z)=>({x,z,yaw:0,speed:0,lateralSpeed:0});

test('7286: approaching from the adjacent road reaches a usable parking position',async t=>{
 await RAPIER.init();
 const map=generateNetwork('NET1:PIT-20261121-7286'),origin=map.nodes.find(n=>n.id===map.spawn.from);
 const road={network:map,segments:[],seed:map.seed,code:map.code};
 for(const offset of [16,21,-21]){
  const sim=physicalWorld('suspect');
  try{
   installNetwork(sim,map);
   const x=origin.x+500,z=origin.z+offset,unit=sim.add('patrol'),player=sim.add('patrol');
   const place=(v,kind,atZ,yaw)=>{
    v.body.setTranslation({x,y:vehicleSpawnHeight(kind,0),z:atZ},true);
    v.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
   };
   const sign=Math.sign(offset);
   place(sim.vehicle,'suspect',z,sign===1?0:Math.PI);place(player,'patrol',z+sign*4.2,Math.PI/2);place(unit,'patrol',origin.z+sign*2.7,-sign*Math.PI/2);
   const state=makeBlockade(),driver=makeNetworkDriver('7286');
   let held=null,off=null,start=null,near=null;
   for(let f=0;f<1800;f++){
    const target=physicsSnapshot(sim.vehicle),p=physicsSnapshot(player),self=physicsSnapshot(unit);
    stepBlockade(state,{road,index:0,suspect:target,player:p,supports:[self,car(x,z-90)],available:[true,false],dt:1/60});
    const neighbors=[p,target];
    const touching=()=>{
     let hit=false;
     for(let i=0;i<unit.body.numColliders();i++)for(let j=0;j<sim.vehicle.body.numColliders();j++)
      sim.world.contactPair(unit.body.collider(i),sim.vehicle.body.collider(j),m=>{if(m.numSolverContacts())hit=true;});
     return hit;
    };
    const control=blockadeControl(state,0,self,target,neighbors,road,1/60,1,touching)??chaseRoute(map,driver,self,target,f/60,1,16,neighbors,false,false);
    driveVehicleTarget(unit,control);
    for(const v of [player,sim.vehicle])driveVehicleTarget(v,{speed:0,yawError:0});
    sim.world.step();
    if(Math.abs(self.speed)>.2)start??=f/60;
    if(sign*(self.z-origin.z)>6)off??=f/60;
    if(Math.hypot(self.x-target.x,self.z-target.z)<8)near??=f/60;
    if(state.settled[0]>.8&&sign*(self.z-target.z)<0&&(controlsDeparture(self,target)||touching())){held=f/60;break;}
   }
   t.diagnostic(JSON.stringify({offset,start,off,near,held,reason:state.reason}));
   assert.ok(held!==null&&held<(offset===16?17.98:30));
  }finally{sim.dispose();}
 }
});

test('a road-aligned stopping position must cover an actual end of the target',()=>{
 for(const [angle,distance,expected] of [[0,5,true],[Math.PI/4,5,false],[Math.PI/2,4,false]]){
  const suspect={...car(0,0),yaw:angle};
  assert.equal(containmentPose(0,car(0,-distance),suspect,0),expected);
 }
});

test('849B: the free support parks at the opposite end of a rotated target',async t=>{
 await RAPIER.init();
 for(const [yaw,playerEnd,side,grip,contact] of [[Math.PI/4,1,14,1],[Math.PI/2,-1,0,1],[Math.PI/4,1,14,.78],[-Math.PI/2,1,0,1,true],[-Math.PI/2,-1,0,1,true],[-Math.PI/2,1,0,.78,true]]){
  const map=generateNetwork(contact?'NET1:PIT-20261121-BE8F':'NET1:PIT-20261121-849B');
  const origin=map.nodes.find(node=>node.id===map.spawn.from);
  const road={network:map,segments:[],seed:map.seed,code:map.code};
  const sim=physicalWorld('suspect');
  try{
   installNetwork(sim,map);
   const point=d=>({x:origin.x+500-Math.sin(yaw)*d,z:origin.z+side-Math.cos(yaw)*d});
   const setup=(vehicle,d,model,angle)=>{
    vehicle.body.setTranslation({...point(d),y:vehicleSpawnHeight(model,0)},true);
    vehicle.body.setRotation({x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},true);
   };
   const unit=sim.add('patrol'),playerCar=sim.add('patrol');
   setup(sim.vehicle,0,'suspect',yaw);setup(playerCar,playerEnd*4.2,'patrol',yaw+Math.PI/2);
   setup(unit,-playerEnd*17,'patrol',yaw);
   const state=makeBlockade(),times={start:null,near:null,held:null};
   let contacts=0;
   let contactPosition=null,firstContact=null,maxTargetShift=0,contactEpisodes=0,lastHit=false;
   const damageEpisodes=makeDamageEpisodes(),actors=[playerCar,sim.vehicle,unit];
   let damage=actors.map(()=>pristineDamage());
   for(let frame=0;frame<1800;frame++){
    const suspect=physicsSnapshot(sim.vehicle),player=physicsSnapshot(playerCar),self=physicsSnapshot(unit);
    const supports=[self,{...car(0,0),...point(90)}];
    stepBlockade(state,{road,index:0,suspect,player,supports,available:[true,false],dt:1/60});
    const touching=()=>{
     let hit=false;
     for(let i=0;i<unit.body.numColliders();i++)for(let j=0;j<sim.vehicle.body.numColliders();j++)
      sim.world.contactPair(unit.body.collider(i),sim.vehicle.body.collider(j),m=>{if(m.numSolverContacts()>0)hit=true;});
     if(hit){
      if(!lastHit)contactEpisodes++;
      firstContact??=frame/60;contactPosition??={x:suspect.x,z:suspect.z};
     }
     lastHit=hit;
     return hit;
    };
    const control=blockadeControl(state,0,self,suspect,[player,suspect],road,1/60,grip,contact?touching:undefined);
    const before=contact?actors.map(v=>readVehicleFrame(v.body,v.lastYaw)):[];
    const pedals=driveVehicleTarget(unit,control??{speed:0,yawError:0},grip,damage[2]);
    if(contactPosition){
     assert.equal(pedals.throttle,0);assert.ok(pedals.brake>0);
     maxTargetShift=Math.max(maxTargetShift,Math.hypot(suspect.x-contactPosition.x,suspect.z-contactPosition.z));
     assert.ok(maxTargetShift<.2);
    }
    for(const vehicle of [playerCar,sim.vehicle])driveVehicleTarget(vehicle,{speed:0,yawError:0},grip);
    sim.world.step();
    if(contact)damage=sampleCollisionDamage(sim.world,actors.map((v,i)=>({body:v.body,kind:i===1?'suspect':'patrol',damage:damage[i],before:before[i]})),damageEpisodes,frame/60);
    for(let i=0;i<unit.body.numColliders();i++)sim.world.contactPairsWith(unit.body.collider(i),other=>{
     if([playerCar.body.handle,sim.vehicle.body.handle].includes(other.parent()?.handle)){
      sim.world.contactPair(unit.body.collider(i),other,manifold=>{
       for(let j=0;j<manifold.numContacts();j++)if(manifold.contactImpulse(j)>0)contacts++;
      });
     }
    });
    if(Math.abs(self.speed)>.2)times.start??=frame/60;
    if(Math.hypot(self.x-suspect.x,self.z-suspect.z)<8)times.near??=frame/60;
    if(state.settled[0]>.8){times.held??=frame/60;if(!contact||frame/60-times.held>3)break;}
   }
   t.diagnostic(JSON.stringify({yaw,playerEnd,side,grip,times,firstContact,maxTargetShift,contactEpisodes,reason:state.reason}));
   assert.ok(times.held!==null);
   assert.equal(state.playerCovered[playerEnd===1?0:1],true);
   assert.equal(state.frontUnit===0,playerEnd===-1);
   if(contact){
    assert.ok(contactPosition&&state.settled[0]>3);
    assert.equal(contactEpisodes,1);
    assert.deepEqual(damage,actors.map(()=>pristineDamage()));
   }
   else assert.equal(contacts,0);
   const suspect=physicsSnapshot(sim.vehicle),self=physicsSnapshot(unit);
   const along=-(self.x-suspect.x)*Math.sin(suspect.yaw)-(self.z-suspect.z)*Math.cos(suspect.yaw);
   assert.equal(Math.sign(along),-playerEnd);
   if(contact){
    const moved={...suspect,x:suspect.x-Math.sign(along)*.55*(-Math.sin(yaw)),z:suspect.z-Math.sign(along)*.55*(-Math.cos(yaw))};
    const reopened=blockadeControl(structuredClone(state),0,self,moved,[physicsSnapshot(playerCar),moved],road,1/60,grip,()=>false);
    assert.ok(Math.abs(reopened.speed)>0,'resume only after a meaningful gap opens');
   }
   if(!contact)assert.ok(controlsDeparture(self,suspect));
   const input={road,index:0,suspect,supports:[self,{...car(0,0),...point(90)}],available:[true,false],dt:1/60};
   const turned=structuredClone(state);
   stepBlockade(turned,{...input,suspect:{...suspect,yaw:suspect.yaw+.6},player:physicsSnapshot(playerCar)});
   assert.equal(turned.phase,'missed');
   stepBlockade(state,{...input,player:{...car(0,0),...point(40)}});
   assert.equal(state.phase,'missed');
  }finally{sim.dispose();}
 }
});

test('8472: a support advances beyond the former queue when the player leaves room',async t=>{
 await RAPIER.init();
 const map=generateNetwork('NET1:PIT-20261120-8472');
 const origin=map.nodes.find(node=>node.id===map.spawn.from);
 const incidentRoad={network:map,segments:[],seed:map.seed,code:map.code};
 for(const scenario of ['blocked','clear','player-leaves','swapped']){
  const offset=scenario==='clear'||scenario==='swapped'?7:0;
  const sim=physicalWorld('suspect');
  try{
   installNetwork(sim,map);
   const models=['suspect','patrol','patrol','suv'];
   const vehicles=[sim.vehicle,...models.slice(1).map(model=>sim.add(model))];
   const startX=origin.x+500;
   vehicles.forEach((vehicle,i)=>{
    const positions=scenario==='swapped'?[0,-12,-29,-17]:[0,-12,-17,-29];
    vehicle.body.setTranslation({x:startX+positions[i],y:vehicleSpawnHeight(models[i],0),z:origin.z+2.7+(i===1?offset:0)},true);
    vehicle.body.setRotation({x:0,y:-Math.SQRT1_2,z:0,w:Math.SQRT1_2},true);
   });
   const state=makeBlockade(),drivers=['02','03'].map(id=>makeNetworkDriver(map.code+'-'+id));
   const samples=[];
   const duration=scenario==='player-leaves'?1800:900;
   for(let frame=0;frame<duration;frame++){
    // Change only the player fixture. Both support cars always use wheel physics.
    if(scenario==='player-leaves'&&frame===900){
     const pos=vehicles[1].body.translation();
     vehicles[1].body.setTranslation({...pos,z:pos.z+7},true);
    }
    const [suspect,player,...supports]=vehicles.map((vehicle,i)=>({...physicsSnapshot(vehicle),model:models[i]}));
    stepBlockade(state,{road:incidentRoad,index:0,suspect,player,supports,dt:1/60});
    vehicles.slice(0,2).forEach(vehicle=>driveVehicleTarget(vehicle,{speed:0,yawError:0}));
    supports.forEach((unit,i)=>{
     const neighbors=[{...player,id:'player'},{...suspect,id:'suspect'},{...supports[1-i],id:'other'}];
     const route=chaseRoute(map,drivers[i],unit,suspect,frame/60,1,16+6*i,neighbors,false,false);
     const local=blockadeControl(state,i,unit,suspect,neighbors,incidentRoad,1/60,1);
     const fallback=waitForBlockadeRetry(state,unit,suspect)?{...route,speed:0}:route;
     driveVehicleTarget(vehicles[i+2],drivers[i].turnaroundStopping?route:local??fallback);
    });
    sim.world.step();
    if(frame%300===299)samples.push(vehicles.slice(2).map(v=>Math.round((v.body.translation().x-startX)*10)/10));
   }
   t.diagnostic(JSON.stringify({scenario,samples,reason:state.reason}));
   if(scenario==='blocked')assert.match(state.reason,/空間|受阻/);
   else assert.ok(samples.at(-1).some(x=>x>-9),'at least one unit advances beyond the old waiting position toward the incident');
  }finally{sim.dispose();}
 }
});

test('an unavailable incident area cannot produce a ready report',()=>{
 const blockedRoad={...road,network:{...network,objects:[{id:'building',kind:'building',x:0,z:0,halfX:18,halfZ:18,height:5,color:'#000'}]}};
 const state=makeBlockade(),suspect=car(0,0),player=car(12,25),supports=[car(0,22),car(0,24)];
 for(let frame=0;frame<900;frame++)stepBlockade(state,{road:blockedRoad,index:0,suspect,player,supports,dt:1/60});
 assert.equal(state.phase,'missed');
 assert.deepEqual(state.settled,[0,0]);assert.match(state.reason,/通道/);
});

test('partial control requires intercepting an actual departure direction',()=>{
 const suspect={...car(0,0),model:'suspect'};
 assert.equal(controlsDeparture({...car(0,-6),model:'patrol'},suspect),true);
 assert.equal(controlsDeparture({...car(6,0),model:'patrol'},suspect),false);
 assert.equal(controlsDeparture({...car(0,-20),model:'patrol'},suspect),false);
 assert.equal(controlsDeparture({...car(0,0),model:'patrol'},suspect),false);
});

test('lateral staging commits its driving direction instead of alternating pedals at the threshold',()=>{
 const state=makeBlockade();state.phase='approaching';state.frontUnit=1;
 state.anchor={x:0,z:0,yaw:0,index:0,side:-4.45,front:5.29,rear:5.35};
 const target={...car(0,0),yaw:2.4},player=car(12,12);
 // Small position noise across the old .25 m threshold used to reverse gear
 // every step even though the vehicle still had four lateral metres to travel.
 for(let i=0;i<120;i++){
  const unit={...car(-8.45,7.75+(i%2?-.01:.01)),yaw:.43};
  const result=blockadeControl(state,1,unit,target,[target,player],road,1/60,1);
  assert.ok(result.speed>0,'keep the initial forward manoeuvre until its waypoint');
 }
});

test('incident ground stays bounded and rejects real buildings, rails and map edges',()=>{
 const incident=car(16,0),box=carBox({...incident,model:'patrol'},.35);
 assert.equal(localIncidentFootprintClear(network,box,incident),true);
 assert.equal(localIncidentFootprintClear(network,{...box,x:60},incident),false);
 assert.equal(localIncidentFootprintClear(network,{...box,x:99},car(99,0)),false);
 const building={...network,objects:[{id:'building',kind:'building',x:16,z:0,halfX:2,halfZ:3,height:3,color:'#000'}]};
 assert.equal(localIncidentFootprintClear(building,box,incident),false);
 const highway={...network,edges:network.edges.map(e=>({...e,biome:'highway'}))};
 assert.equal(localIncidentFootprintClear(highway,{...box,x:8.2},incident),false);
});

test('nearby unit physically parks while a distant colleague remains en route',async t=>{
 await RAPIER.init();
 for(const near of [0,1])for(const offset of [-.15,0,.15]){
  const sim=physicalWorld('suspect');try{
   installNetwork(sim,network);const target=sim.vehicle;
   const units=[sim.add('patrol',offset,near===0?-14:-100),sim.add('suv',offset,near===1?18:100)];
   const state=makeBlockade();let settled=false,released=false,contacts=0;
   for(let frame=0;frame<60*55;frame++){
    const suspect=physicsSnapshot(target),supports=units.map(physicsSnapshot),player=car(-6,30);
    stepBlockade(state,{road,index:0,suspect,supports,player,dt:1/60});
    driveVehicleTarget(target,{speed:0,yawError:0},1);
    for(let i=0;i<2;i++){
     const output=blockadeControl(state,i,supports[i],suspect,[suspect,player,supports[1-i]],road,1/60,1);
     if(i!==near)assert.equal(output,null,'far unit remains on road-routing control');
     driveVehicleTarget(units[i],output??{speed:0,yawError:0},1);
    }
    sim.world.step();
    for(let c=0;c<target.body.numColliders();c++)sim.world.contactPairsWith(target.body.collider(c),other=>{if(other.parent()?.handle===units[near].body.handle)contacts++;});
    if(settled&&state.settled[near]<.1)released=true;
    settled ||=state.settled[near]>.8;
   }
   t.diagnostic(JSON.stringify({near,offset,settled,released,contacts,phase:state.phase,positions:units.map(physicsSnapshot)}));
   assert.equal(settled,true);assert.equal(released,false);assert.equal(contacts,0);
   assert.equal(state.phase,'approaching','partial control is not full arrival');
  }finally{sim.dispose();}
 }
});

test('blocked front parking does not prevent physically controlling the rear',async()=>{
 await RAPIER.init();const sim=physicalWorld('suspect');
 try{
  const n={...network,objects:[{id:'building',kind:'building',x:0,z:-6,halfX:8,halfZ:2,height:3,color:'#000'}]},r={...road,network:n};
  installNetwork(sim,n);const rear=sim.add('suv',0,18),state=makeBlockade();
  for(let frame=0;frame<60*55;frame++){
   const suspect=physicsSnapshot(sim.vehicle),supports=[car(0,-14),physicsSnapshot(rear)],player=car(-6,30);
   stepBlockade(state,{road:r,index:0,suspect,supports,player,dt:1/60});
   const output=blockadeControl(state,1,supports[1],suspect,[suspect,player,supports[0]],r,1/60,1);
   driveVehicleTarget(sim.vehicle,{speed:0,yawError:0},1);driveVehicleTarget(rear,output??{speed:0,yawError:0},1);sim.world.step();
  }
  assert.ok(state.settled[1]>.8);assert.equal(state.assigned[0],false);assert.equal(state.phase,'approaching');
 }finally{sim.dispose();}
});
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
 step(state,[suspect]);
 assert.ok(state.parkingRecovery||state.parkingGoal?.[0],'cleared space permits correction or a swept replacement route');
 if(state.parkingGoal?.[0])assert.equal(state.parkingRecovery,undefined,'replacement route owns control');
 assert.ok(state.parkingAttempts<=5);
 const blocked=setup();for(let i=0;i<10;i++)step(blocked,[suspect,obstacle]);
 assert.ok(blocked.parkingAttempts<=5);assert.equal(blocked.parkingRecovery,undefined);
 assert.ok((blocked.maneuverAttempts?.[0]??0)<=2);
 assert.ok((blocked.planningSpent?.[0]??0)<=15.1);
});
test('nearby backup waits during replan only while target is slow',()=>{
 const state=makeBlockade(),suspect=car(0,0),near=car(0,-10),far=car(0,-80);
 assert.equal(waitForBlockadeRetry(state,near,suspect),false);
 state.phase='missed';assert.equal(waitForBlockadeRetry(state,near,suspect),true);
 assert.equal(waitForBlockadeRetry(state,far,suspect),false);
 assert.equal(waitForBlockadeRetry(state,car(0,37),suspect),false,'outer approach remains controlled by road routing');
 suspect.speed=8;assert.equal(waitForBlockadeRetry(state,near,suspect),false);
});

test('handoff does not activate a local manoeuvre outside its supported envelope',()=>{
 const state=makeBlockade(),input={road,index:0,suspect:car(0,0),supports:[car(0,-37),car(0,18)],player:car(-6,30),dt:1/60};
 for(let i=0;i<30;i++)stepBlockade(state,input);
 assert.equal(state.phase,'approaching');
 assert.equal(blockadeControl(state,0,input.supports[0],input.suspect,[],road,1/60,1),null);
 assert.ok(blockadeControl(state,1,input.supports[1],input.suspect,[],road,1/60,1).speed>0);
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
 for(const frontUnit of [0,1])for(const grip of [1,.78,.58])for(const x of [0,8,16]){
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

test('aligned backup considers a crosswise parking goal when a parked colleague blocks the straight slot',()=>{
 const state=makeBlockade(),suspect={...car(0,0),model:'suspect'},self=car(3,15),player=car(0,-4.4),other=car(0,9);
 Object.assign(state,{phase:'approaching',anchor:{...suspect,front:5.5,rear:5.5},frontUnit:1,playerCovered:[true,false]});
 for(let frame=0;frame<150;frame++)blockadeControl(state,0,self,suspect,[suspect,player,other],road,1/60,1);
 assert.ok(state.parkingGoal?.[0],state.reason);
 assert.ok(Math.abs(Math.sin(state.parkingGoal[0].yaw))>.5);
});

test('02 drives into the alternative slot with a stationary vehicle behind it',async t=>{
 await RAPIER.init();
 for(const sign of [1,-1]){
  const sim=physicalWorld('suspect');
  try{
   installNetwork(sim,network);
   const unit=sim.add('patrol',5,sign*7),player=sim.add('patrol',0,-sign*5),other=sim.add('suv',0,sign*9);
   const state=makeBlockade();let held=false,firstMotion=null,heldAt=null;
   for(let frame=0;frame<3600;frame++){
    const snap=(v,model)=>({...physicsSnapshot(v),model});
    const suspect=snap(sim.vehicle,'suspect'),self=snap(unit,'patrol'),p=snap(player,'patrol'),o=snap(other,'suv');
    stepBlockade(state,{road,index:0,suspect,player:p,supports:[self,o],available:[true,false],dt:1/60});
    const ctrl=blockadeControl(state,0,self,suspect,[suspect,p,o],road,1/60,1);
    driveVehicleTarget(unit,ctrl??{speed:0,yawError:0});
    for(const v of [sim.vehicle,player,other])driveVehicleTarget(v,{speed:0,yawError:0});
    sim.world.step();
    if(firstMotion===null&&Math.abs(self.speed)>.15)firstMotion=frame/60;
    if(state.settled[0]>.8&&controlsDeparture(self,suspect)){held=true;heldAt=frame/60;break;}
   }
   t.diagnostic(JSON.stringify({sign,held,firstMotion,heldAt,planningSeconds:state.planningSpent?.[0],reason:state.reason,goal:state.parkingGoal?.[0],pos:physicsSnapshot(unit).z}));
   assert.ok(held);
  }finally{sim.dispose();}
 }
});

test('occupied slots stay idle until the blocking vehicle moves clear',()=>{
 const state=makeBlockade(),suspect={...car(0,0),model:'suspect'},self=car(3,15),player=car(0,-4.4),other=car(0,5);
 Object.assign(state,{phase:'approaching',anchor:{...suspect,front:5.5,rear:5.5},frontUnit:1,playerCovered:[true,false]});
 const step=()=>blockadeControl(state,0,self,suspect,[suspect,player,other],road,1/60,1);
 for(let frame=0;frame<150;frame++)step();
 const waiting=state.occupiedAt?.[0];assert.ok(waiting);
 for(let frame=0;frame<180;frame++)assert.equal(step().speed,0);
 assert.equal(state.occupiedAt[0],waiting);assert.equal(state.planningSpent[0],0);
 other.z=9;
 for(let frame=0;frame<60&&!state.parkingGoal[0];frame++)step();
 assert.ok(state.parkingGoal[0]);
});
