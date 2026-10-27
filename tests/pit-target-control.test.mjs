import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {applyPitTargetControl} from '../lib/pitTargetControl.ts';
import {pristineDamage} from '../lib/vehicleDamage.ts';
test('shared candidate control matches legacy mission forces with no active longitudinal or angular control',async()=>{
  await RAPIER.init();
  for(const grip of [1,.78,.58])for(const damaged of [false,true]) {
    const w=new RAPIER.World({x:0,y:0,z:0}),damage=damaged?{...pristineDamage(),frontLeftGrip:0,rearRightGrip:.2,alignment:0}:pristineDamage();
    const bodies=Array.from({length:3},(_,i)=>{const b=w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(i*100,0,0).setLinvel(4,0,-15).setAngvel({x:0,y:1.5,z:0}));w.createCollider(RAPIER.ColliderDesc.cuboid(1,.5,2).setMass(1),b);return b;});
    for(let i=0;i<60;i++) {
      for(const b of bodies.slice(0,2))applyPitTargetControl(b,{rightX:1,rightZ:0,lateralSpeed:b.linvel().x},damage,grip,1/60);
      const tyre=(damage.frontLeftGrip+damage.frontRightGrip+damage.rearLeftGrip+damage.rearRightGrip)/4;
      bodies[2].applyImpulse({x:-bodies[2].linvel().x*bodies[2].mass()*Math.min(1,grip*tyre*7/60*.18),y:0,z:0},true);w.step();
      assert.deepEqual(bodies[0].linvel(),bodies[1].linvel());assert.deepEqual(bodies[0].linvel(),bodies[2].linvel());
      assert.equal(bodies[0].linvel().z,-15);assert.ok(Math.abs(bodies[0].angvel().y-1.5)<1e-5);
    }
    w.free();
  }
});
