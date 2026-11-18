import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {planIncidentManeuver,driveIncidentManeuver} from '../lib/incidentManeuver.ts';
import {carBox,boxesOverlap} from '../lib/drivingObservation.ts';
const network={version:1,seed:'OBSTACLE',code:'NET1:OBSTACLE',nodes:[],edges:[],objects:[],towns:[],bounds:{minX:-50,maxX:50,minZ:-50,maxZ:50}};
// Controlled flat-ground scenarios; not a replay of the player's building image.
for(const blocked of [false,true])test(`wheel-driven local manoeuvre near a building, new blocker=${blocked}`,async t=>{
 await RAPIER.init();const sim=physicalWorld('patrol');
 try{
  const n={...network,objects:[{id:'building',kind:'building',x:5,z:5,halfX:2,halfZ:8,height:5,color:'#888'}]};
  installNetwork(sim,n);const car=sim.vehicle;
  car.body.setTranslation({x:0,y:-.315,z:12},true);
  const goal={x:0,z:0,yaw:0};
  const snapshot=()=>({...physicsSnapshot(car),model:'patrol'});
  const plan=planIncidentManeuver(n,snapshot(),goal,goal,[]);assert.ok(plan);
  let obstacle=null,stopped=false,done=false,contacts=0;
  for(let frame=0;frame<60*30;frame++){
   if(blocked&&frame===60){
    assert.equal(boxesOverlap(carBox(snapshot()),carBox({x:0,z:6,yaw:0,speed:0,lateralSpeed:0,model:'suv'})),false,'the inserted obstacle must not overlap the moving car');
    obstacle=sim.add('suv',0,6);
   }
   const neighbors=obstacle?[{...physicsSnapshot(obstacle),model:'suv'}]:[];
   const control=stopped?{speed:0,yawError:0}:driveIncidentManeuver(plan,n,snapshot(),goal,neighbors,1/60,1);
   stopped||=control.status==='blocked';done||=control.status==='done';
   driveVehicleTarget(car,control,1);
   if(obstacle)driveVehicleTarget(obstacle,{speed:0,yawError:0},1);
   sim.world.step();
   for(let i=0;i<car.body.numColliders();i++)sim.world.contactPairsWith(car.body.collider(i),other=>{
    if(other.parent()?.handle===car.body.handle)return;
    if(other.translation().y<0)return;
    sim.world.contactPair(car.body.collider(i),other,m=>{for(let j=0;j<m.numContacts();j++)if(m.contactDist(j)<=.01)contacts++;});
   });
   if(done)break;
  }
  t.diagnostic(JSON.stringify({blocked,stopped,done,contacts,car:snapshot()}));
  assert.equal(contacts,0);assert.equal(blocked?stopped:done,true);
  if(blocked){assert.equal(done,false);assert.ok(Math.abs(snapshot().speed)<.2);}
 }finally{sim.dispose();}
});
