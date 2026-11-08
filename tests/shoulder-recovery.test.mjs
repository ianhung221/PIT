import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {installNetwork} from './helpers/network-world.mjs';
import {generateNetwork} from '../lib/networkGenerator.ts';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {makeBlockade,blockadeControl} from '../lib/supportContainment.ts';
import {drivingPoint} from '../lib/drivingObservation.ts';
const network=generateNetwork('BATCH3-highway'),road={network,segments:[],seed:network.seed,code:network.code};
const anchor={x:-366.3617,z:-58.8685,yaw:Math.PI*1.5,index:31,side:3.1055,front:5.357,rear:5.296};
const start={x:-351.9958,z:-56.8749,yaw:2.97283,speed:0,lateralSpeed:0,model:'patrol'};
const target={x:-366.5595,z:-58.9808,yaw:1.4761,speed:0,lateralSpeed:0,model:'suspect'};
const rear={x:-371.8269,z:-58.8093,yaw:-1.5238,speed:0,lateralSpeed:0,model:'suv'};
const player={x:-368.781,z:-66.1751,yaw:2.3735,speed:0,lateralSpeed:0,model:'patrol'};
function state(){const s=makeBlockade();s.phase='approaching';s.anchor=anchor;s.stages=[2,0];s.blockedFor=[1.1,0];return s;}
test('shoulder retreat refuses an occupied rear corridor',()=>{
 const s=state(),obstacle={...start,...drivingPoint(start,0,-4),model:'suv'};
 const out=blockadeControl(s,0,start,target,[target,rear,player,obstacle],road,1/60,1);
 assert.equal(s.shoulderRecovery,undefined);assert.notEqual(out.speed<0,true);
});
test('shoulder retreat stops if the rear corridor becomes occupied',()=>{
 const s=state();s.shoulderAttempts=1;s.shoulderRecovery={x:start.x,z:start.z,elapsed:1};
 const obstacle={...start,...drivingPoint(start,0,-4),model:'suv'};
 const out=blockadeControl(s,0,start,target,[target,rear,player,obstacle],road,1/60,1);
 assert.equal(out.speed,0);assert.equal(s.shoulderRecovery,undefined);
});
test('front backup physically reverses from a blocked shoulder without contacting cars',async t=>{
 await RAPIER.init();
 for(const grip of [1,.58]){
  const sim=physicalWorld('patrol');try{
   installNetwork(sim,network);const front=sim.vehicle;
   const set=(v,c)=>{v.body.setTranslation({x:c.x,y:-.315,z:c.z},true);v.body.setRotation({x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)},true)};
   set(front,start);const others=[target,rear,player].map(c=>{const v=sim.add(c.model,c.x,c.z);set(v,c);return v;});
   const s=state();let active=false,completed=false,contacts=0;
   for(let i=0;i<60*15;i++){
    const c={...physicsSnapshot(front),model:'patrol'},neighbors=others.map((v,j)=>({...physicsSnapshot(v),model:[target,rear,player][j].model}));
    const out=blockadeControl(s,0,c,neighbors[0],neighbors,road,1/60,grip);
    active||=!!s.shoulderRecovery;driveVehicleTarget(front,out??{speed:0,yawError:0},grip);
    others.forEach(v=>driveVehicleTarget(v,{speed:0,yawError:0},grip));sim.world.step();
    for(let j=0;j<front.body.numColliders();j++)sim.world.contactPairsWith(front.body.collider(j),o=>{if(others.some(v=>v.body.handle===o.parent()?.handle))contacts++;});
    if(active&&!s.shoulderRecovery){completed=true;break;}
   }
   const c=physicsSnapshot(front),distance=Math.hypot(c.x-start.x,c.z-start.z);
   t.diagnostic(JSON.stringify({grip,active,completed,contacts,distance,position:c}));
   assert.equal(active,true);assert.equal(completed,true);assert.equal(contacts,0);assert.ok(distance>3.3&&distance<4.2);
  }finally{sim.dispose();}
 }
});
