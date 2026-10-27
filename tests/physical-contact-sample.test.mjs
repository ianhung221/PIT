import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {vehicleColliderStrips} from '../lib/gameConfig.ts';
import {physicalContactSample} from '../lib/physicalContactSample.ts';
import {localPoint} from '../lib/pitContact.ts';
test('actual multi-collider contact averages every solver point with matching pre-impact velocity',async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:0,z:0});
  const create=(kind,x,z,vx,vz)=>{
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,0,z).setLinvel(vx,0,vz).enabledTranslations(true,false,true).enabledRotations(false,false,false));
    for(const s of vehicleColliderStrips(kind))world.createCollider(RAPIER.ColliderDesc.cuboid(s.halfWidth,.48,s.halfLength).setTranslation(0,0,s.z).setMass(s.mass),b);
    return b;
  };
  const p=create('patrol',1.8,1,-2,-5),s=create('suspect',0,0,0,-4);
  const frame=(b)=>({yaw:0,forwardX:0,forwardZ:-1,rightX:1,rightZ:0,velocityX:b.linvel().x,velocityZ:b.linvel().z,forwardSpeed:-b.linvel().z,lateralSpeed:b.linvel().x});
  const pre={player:frame(p),suspect:frame(s)};world.step();
  const points=[];let pairs=0;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)world.contactPair(p.collider(i),s.collider(j),m=>{if(m.numSolverContacts())pairs++;for(let k=0;k<m.numSolverContacts();k++)points.push(m.solverContactPoint(k));});
  assert.ok(pairs>1,'fixture must exercise several collider pairs');
  const result=physicalContactSample(world,p,s,frame(p),frame(s),pre,'patrol',true);
  const mean={x:points.reduce((a,p)=>a+p.x,0)/points.length,z:points.reduce((a,p)=>a+p.z,0)/points.length};
  const expected=localPoint({...s.translation(),yaw:0},mean);
  assert.ok(Math.abs(result.localX-expected.x)<1e-8);assert.ok(Math.abs(result.localZ-expected.z)<1e-8);
  assert.equal(result.closingSpeed,Math.sqrt(5));assert.equal(result.authorized,true);assert.ok(result.normalSpeed>=0);
  s.setTranslation({x:100,y:0,z:0},true);world.step();assert.equal(physicalContactSample(world,p,s,frame(p),frame(s),pre,'patrol',true),null);
  world.free();
});
