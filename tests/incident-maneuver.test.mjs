import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {generateNetwork} from '../lib/networkGenerator.ts';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {stepBlockade,blockadeControl,missBlockade} from '../lib/supportContainment.ts';
import {advanceIncidentSearch,planIncidentManeuver,driveIncidentManeuver,interleaveIncidentSearches} from '../lib/incidentManeuver.ts';

test('a difficult candidate cannot consume the shared slice before another candidate advances',()=>{
 const progress=[0,0],plan={points:[],index:0,elapsed:0,stoppedFor:0,nodes:2};
 function* difficult(){while(progress[0]<5000)yield ++progress[0];return null;}
 function* easy(){while(progress[1]<2)yield ++progress[1];return plan;}
 const search=interleaveIncidentSearches([difficult(),easy()]);
 assert.equal(advanceIncidentSearch(search,1000,2).done,false);
 assert.deepEqual(progress,[1,1]);
 let result;do{result=advanceIncidentSearch(search,1000,2);}while(!result.done);
 assert.equal(result.plan,plan);assert.ok(progress[0]<5000);
});

test('exhausted candidates are remembered separately and cancellation closes unfinished searches',()=>{
 const failed=[],closed=[];
 function* empty(){yield* [];return null;}
 function* pending(id){try{while(true)yield 1;}finally{closed.push(id);}}
 const search=interleaveIncidentSearches([empty(),pending(1),pending(2)],index=>failed.push(index));
 search.next();search.next();search.return(null);
 assert.deepEqual(failed,[0]);assert.deepEqual(closed,[1,2]);
});

test('incremental planning returns control after the node budget',()=>{
 let visited=0;
 function* search(){while(visited<100)yield ++visited;return null;}
 const pending=search();assert.equal(advanceIncidentSearch(pending,1000,3).done,false);
 assert.equal(visited,3);
});

test('a new car in the swept corridor stops a previously valid manoeuvre',()=>{
 const network={version:1,seed:'DYNAMIC',code:'NET1:DYNAMIC',nodes:[],edges:[],objects:[],towns:[],bounds:{minX:-50,maxX:50,minZ:-50,maxZ:50}};
 const car={x:0,z:12,yaw:0,speed:0,lateralSpeed:0,model:'patrol'},goal={x:0,z:0,yaw:0};
 const plan=planIncidentManeuver(network,car,goal,goal,[]);assert.ok(plan);
 const control=driveIncidentManeuver(plan,network,car,goal,[{...car,z:9,model:'suv'}],1/60,1);
 assert.equal(control.status,'blocked');assert.equal(control.speed,0);
});

test('changed surroundings invalidate search without consuming a driving attempt; total planning stays bounded',()=>{
 const saved=JSON.parse(readFileSync(new URL('./fixtures/oblique-containment.json',import.meta.url)));
 const network=generateNetwork('BATCH3-HIGHWAY'),road={network,segments:[],seed:network.seed,code:network.code};
 const models=['suspect','patrol','patrol','suv'];
 const cars=saved.cars.map((c,i)=>({...c,yaw:2*Math.atan2(c.pose.quaternion.y,c.pose.quaternion.w),speed:0,lateralSpeed:0,pose:undefined,model:models[i]}));
 const [suspect,player,rear,front]=cars,state=structuredClone(saved.blockade);
 state.approachProgress=[null,{best:0,wait:3}];state.sceneStableFor=[0,1];
 const run=()=>blockadeControl(state,1,front,suspect,[suspect,player,rear],road,1/60,1);
 run();assert.equal(state.planning[1],true);assert.equal(state.maneuverAttempts[1],0);
 player.x+=1;run();assert.equal(state.planning[1],false);assert.equal(state.maneuverAttempts[1],0);
 assert.ok(state.planningSpent[1]>0);assert.equal(state.sceneStableFor[1],0);
 state.planningSpent[1]=15;state.approachProgress[1].wait=3;state.sceneStableFor[1]=1;
 assert.equal(run().speed,0);assert.equal(state.planning[1],false);
 missBlockade(state,'test bounded retry');assert.equal(state.planningSpent[1],15,'whole-group retry must not renew the exhausted search budget');
});

for(const fixture of ['oblique-containment','7753-containment'])test(`${fixture}: both units park without driving through the player`,async t=>{
 await RAPIER.init();
 const saved=JSON.parse(readFileSync(new URL(`./fixtures/${fixture}.json`,import.meta.url)));
 const network=generateNetwork(saved.seed??'BATCH3-HIGHWAY'),road={network,segments:[],seed:network.seed,code:network.code};
 for(const grip of [1,.78,.58])for(const offset of [0,-.15,.15])await t.test(`grip=${grip} offset=${offset}`,async t=>{
  const sim=physicalWorld('suspect');
  try{
   installNetwork(sim,network);
   const cars=[sim.vehicle,sim.add('patrol'),sim.add('patrol'),sim.add('suv')],models=['suspect','patrol','patrol','suv'];
   saved.cars.forEach((c,i)=>{cars[i].body.setTranslation({x:c.x,y:c.pose.y,z:c.z+(i>=2?offset:0)},true);cars[i].body.setRotation(c.pose.quaternion,true);});
   const state=structuredClone(saved.blockade);let held=0,contacts=0,lastEvent='';
   for(let frame=0;frame<60*70;frame++){
    const [suspect,player,...supports]=cars.map((c,i)=>({...physicsSnapshot(c),model:models[i]}));
    stepBlockade(state,{road,index:0,suspect,player,supports,dt:1/60});
    cars.slice(0,2).forEach(c=>driveVehicleTarget(c,{speed:0,yawError:0},grip));
    supports.forEach((c,i)=>driveVehicleTarget(cars[i+2],blockadeControl(state,i,c,suspect,[suspect,player,supports[1-i]],road,1/60,grip)??{speed:0,yawError:0},grip));
    sim.world.step();
    if(process.env.TRACE_INCIDENT&&offset===.15){
     const event=JSON.stringify([state.phase,state.reason,state.planning,state.maneuvers?.map(m=>!!m),state.stages]);
     if(event!==lastEvent){lastEvent=event;t.diagnostic(JSON.stringify({frame,event,state,positions:supports.map(c=>({x:c.x,z:c.z,yaw:c.yaw,speed:c.speed}))}));}
    }
    for(const unit of cars.slice(2))for(let i=0;i<unit.body.numColliders();i++)sim.world.contactPairsWith(unit.body.collider(i),other=>{
     if(!cars.some(c=>c!==unit&&c.body.handle===other.parent()?.handle))return;
     sim.world.contactPair(unit.body.collider(i),other,m=>{for(let j=0;j<m.numContacts();j++)if(m.contactDist(j)<=.01)contacts++;});
    });
    held=state.phase==='holding'?held+1/60:0;
    if(held>2)break;
   }
   t.diagnostic(JSON.stringify({grip,offset,held,contacts,state,positions:cars.map(physicsSnapshot)}));
   assert.ok(held>2,'both supports actually reach their chosen positions within 70 seconds');
   assert.equal(contacts,0,'no chassis contact within 1 cm during the approach');
   assert.deepEqual(state.maneuvers,[null,null]);assert.deepEqual(state.planning,[false,false]);
   for(let unit=0;unit<2;unit++){
    const failed=state.failedParkingGoals?.[unit]??[],goal=state.parkingGoal?.[unit];
    assert.ok(state.maneuverAttempts[unit]<=2);assert.ok(state.planningSpent[unit]<15);
    if(failed.length){assert.ok(goal);assert.ok(failed.every(p=>Math.hypot(p.x-goal.x,p.z-goal.z)>=.25),'failed slot must not be retried unchanged');}
   }
   // Holding is only an AI placement state; this test never asserts mission victory.
  }finally{sim.dispose();}
 });
});
