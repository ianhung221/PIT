import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { assessVehicleControl, controlRoadGeometry, advanceControlTimers, CONTROL } from "../lib/vehicleControlAssessment.ts";
import { pitMissionResolution } from "../lib/pitContact.ts";
import { roadSections } from "../lib/roadGeometry.ts";
import { generateRoad } from "../lib/proceduralMap.ts";
import RAPIER from "@dimforge/rapier3d-compat";
import { vehicleColliderStrips } from "../lib/gameConfig.ts";

const car=(x=0,z=0,yaw=0,model="suspect")=>({x,z,yaw,model,speed:0,lateralSpeed:0,angularSpeed:0});
const road=(width=11,yaw=0)=>{
  const rotate=p=>({x:p.x*Math.cos(yaw)+p.z*Math.sin(yaw),z:-p.x*Math.sin(yaw)+p.z*Math.cos(yaw)});
  return controlRoadGeometry([{start:rotate({x:0,z:36}),end:rotate({x:0,z:-36}),startLeft:rotate({x:-width/2,z:36}),startRight:rotate({x:width/2,z:36}),endLeft:rotate({x:-width/2,z:-36}),endRight:rotate({x:width/2,z:-36})}]);
};
const target=car(-4.15);
const cage=[car(-2.95,-3.42,Math.PI/2,"patrol"),car(-2.95,3.42,Math.PI/2,"patrol"),car(-1.8,0,0,"suv")];
test("player plus real wall and other cars close exits regardless of identity, PIT or Q4",()=>{
  assert.equal(assessVehicleControl(target,cage,road()).status,"blocked");
  assert.equal(assessVehicleControl(target,[...cage].reverse(),road()).status,"blocked");
  assert.notEqual(assessVehicleControl(target,cage.slice(1),road()).status,"blocked");
  assert.notEqual(assessVehicleControl(target,cage.slice(0,2),road()).status,"blocked");
  assert.notEqual(assessVehicleControl(target,cage,road(19)).status,"blocked");
});
test("front-only block, free reverse, and a parked car are not full control",()=>{
  assert.equal(assessVehicleControl(car(),[],road()).status,"open");
  const reverse=assessVehicleControl(car(),[car(0,-4.8,0,"patrol")],road());
  assert.equal(reverse.status,"open");assert.match(reverse.reason,/倒車/);
  // Even historic front/rear parking is not proof that side exits are closed.
  assert.notEqual(assessVehicleControl(car(),[car(0,-5,0,"patrol"),car(0,5,0,"suv")],road()).status,"blocked");
  assert.equal(assessVehicleControl(car(),[car(0,-5,0,"patrol"),car(0,5,0,"suv")],road(3)).status,"blocked","front/rear hold remains valid when real side boundaries also close escape");
});
test("moving/rotating blockers and moving target cannot accumulate control",()=>{
  for(const change of [{speed:2},{lateralSpeed:1},{angularSpeed:.5}]) {
    assert.notEqual(assessVehicleControl(target,[{...cage[0],...change},...cage.slice(1)],road()).status,"blocked");
    assert.equal(assessVehicleControl({...target,...change},cage,road()).status,"moving");
  }
});
test("rotation invariance, full body overlap, missing geometry and exhausted search fail safely",()=>{
  for(const yaw of [.35,1.2,-2.1]) {
    const rotate=c=>({...c,x:c.x*Math.cos(yaw)+c.z*Math.sin(yaw),z:-c.x*Math.sin(yaw)+c.z*Math.cos(yaw),yaw:c.yaw+yaw});
    assert.equal(assessVehicleControl(rotate(target),cage.map(rotate),road(11,yaw)).status,"blocked");
  }
  assert.equal(assessVehicleControl(car(),[car(.8)],road()).status,"uncertain");
  assert.equal(assessVehicleControl(car(),[],[]).status,"uncertain");
  assert.equal(assessVehicleControl({...car(),yaw:NaN},[],road()).status,"uncertain");
  assert.equal(assessVehicleControl(car(),[],road(),0).status,"uncertain");
});
test("actual curves and biome seams remain traversable without invented end walls",()=>{
  for(const scene of ["city","country","highway"]) {
    const generated=generateRoad("CONTROL-SEAMS",scene), sections=roadSections(generated);
    for(const seg of generated.segments.filter(s=>s.kind==="curve"||s.kind==="transition").slice(0,10)) {
      const result=assessVehicleControl(car(seg.x,seg.z,seg.yaw),[],controlRoadGeometry(sections.slice(Math.max(0,seg.index-1),seg.index+2)));
      assert.equal(result.status,"open",scene+"/"+seg.index+"/"+result.reason);
    }
  }
});
test("fixed elapsed-time gates reset when an exit opens; pause/restart/disabled stop are independent",()=>{
  for(const hz of [30,60,120]) {
    let timers={heldFor:0,disabledFor:0};
    for(let i=0;i<hz;i++) timers=advanceControlTimers(timers,{status:"blocked"},true,0,1/hz);
    assert.equal(pitMissionResolution(true,0,timers.disabledFor,timers.heldFor),null);
    assert.deepEqual(advanceControlTimers(timers,{status:"blocked"},true,0,10,true),timers);
    const cleared=advanceControlTimers(timers,{status:"open"},true,0,1/hz);
    assert.equal(cleared.heldFor,0);
    for(let i=0;i<hz/2;i++) timers=advanceControlTimers(timers,{status:"blocked"},true,0,1/hz);
    assert.equal(pitMissionResolution(true,0,timers.disabledFor,timers.heldFor),"contained");
  }
  assert.deepEqual(advanceControlTimers({heldFor:1,disabledFor:1},{status:"moving"},false,5,.1),{heldFor:0,disabledFor:0});
  assert.equal(advanceControlTimers({heldFor:0,disabledFor:1},{status:"moving"},false,0,.1).disabledFor,0,"rotation alone also prevents disabled-stop completion");
});
test("Rapier whole-body parking geometry agrees with the enclosure certificate and opened-side counterexample",async()=>{
  await RAPIER.init();const world=new RAPIER.World({x:0,y:0,z:0});
  try {
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(target.x,0,0).enabledTranslations(true,false,true).enabledRotations(false,true,false));
    for(const strip of vehicleColliderStrips("suspect"))world.createCollider(RAPIER.ColliderDesc.cuboid(strip.halfWidth,.48,strip.halfLength).setTranslation(0,0,strip.z).setMass(strip.mass),body);
    for(const c of cage) {
      const b=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x,0,c.z).setRotation({x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)}));
      for(const strip of vehicleColliderStrips(c.model))world.createCollider(RAPIER.ColliderDesc.cuboid(strip.halfWidth,.48,strip.halfLength).setTranslation(0,0,strip.z),b);
    }
    world.createCollider(RAPIER.ColliderDesc.cuboid(.16,.31,36).setTranslation(-5.5,0,0));
    let timers={heldFor:0,disabledFor:0};
    for(let i=0;i<90;i++) {
      world.step();const p=body.translation(),v=body.linvel(),q=body.rotation();
      const snapshot={...target,x:p.x,z:p.z,yaw:2*Math.atan2(q.y,q.w),speed:-v.z,lateralSpeed:v.x,angularSpeed:body.angvel().y};
      const assessment=assessVehicleControl(snapshot,cage,road());assert.equal(assessment.status,"blocked");
      timers=advanceControlTimers(timers,assessment,true,Math.hypot(v.x,v.z),1/60);
    }
    assert.equal(pitMissionResolution(true,0,0,timers.heldFor),"contained");
    assert.notEqual(assessVehicleControl(target,cage.slice(0,2),road()).status,"blocked");
  } finally {world.free();}
});
test("assessment is bounded and deterministic (timings are diagnostic, not machine-dependent gates)",()=>{
  const g=road(), start=performance.now();let nodes=0;
  for(let i=0;i<60;i++) {const a=assessVehicleControl(target,cage,g);assert.equal(a.status,"blocked");nodes+=a.nodes;}
  console.log("control: 60 closed assessments ms",Math.round(performance.now()-start),"search nodes",nodes,"budget",CONTROL.maxNodes);
});
