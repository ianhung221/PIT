import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { classifyPhysicalContact, physicalPitOutcome, pitMissionResolution, localPoint } from "../lib/pitContact.ts";
import { evaluatePitRisk, maxPitSpeed, suspectRoadCruise, missionPitRisk } from "../lib/pitPolicy.ts";
import { SUSPECT, VEHICLES, VEHICLE_PROFILES, vehicleColliderStrips } from "../lib/gameConfig.ts";
import { containmentPose } from "../lib/supportContainment.ts";
import { generateRoad } from "../lib/proceduralMap.ts";
import { measureVehicle } from "../scripts/measure-vehicle-profile.mjs";

const base = {localX:.975,localZ:1.5,playerLocalX:-.9,playerLocalZ:-2,normalSide:-1,closingSpeed:5,normalSpeed:3,headingDelta:.1,halfWidth:.975,halfLength:2.193,playerHalfLength:2.356,authorized:true};
test("physical classification uses both actual faces, contact direction and authorization", () => {
  assert.equal(classifyPhysicalContact(base).classification,"effective");
  for(const change of [{localZ:0},{localZ:.9},{playerLocalZ:1},{normalSide:0},{headingDelta:1},{normalSpeed:0},{localZ:NaN}]) assert.equal(classifyPhysicalContact({...base,...change}).classification,"scrape");
  assert.equal(classifyPhysicalContact({...base,authorized:false}).classification,"unsafe");
  assert.equal(classifyPhysicalContact({...base,closingSpeed:20}).classification,"excessive");
  assert.equal(classifyPhysicalContact({...base,normalSpeed:10}).classification,"excessive");
});
test("turning sideways alone cannot masquerade as a planar slowdown; a brief contact cannot qualify", () => {
  assert.equal(physicalPitOutcome(0,1.1,20,20,2,.1).success,false);
  assert.equal(physicalPitOutcome(0,1.1,20,12,2,0).success,false);
  assert.equal(physicalPitOutcome(0,1.1,20,12,2,.1).success,true);
  assert.equal(physicalPitOutcome(0,1.1,1,0,0,.1).success,false);
});
test("authorized always agrees with speed warning and four policy branches are reachable", () => {
  const input={speedKph:50,weatherGrip:1,visibility:1,roadRisk:.1,trafficDensity:0,obstacleRisk:0,offenseSeverity:.86,supportUnits:2};
  assert.equal(evaluatePitRisk(input).authorization,"authorized");
  for(const grip of [1,.78,.58]) {
    assert.equal(evaluatePitRisk({...input,weatherGrip:grip,speedKph:maxPitSpeed(grip)+1}).authorization,"hold");
    const safe=evaluatePitRisk({...input,weatherGrip:grip,speedKph:maxPitSpeed(grip)-10});
    assert.equal(safe.authorization,"authorized"); assert.ok(!safe.reasons.join().includes("過高"));
  }
  assert.equal(evaluatePitRisk({...input,targetClass:"heavy"}).authorization,"denied");
  assert.equal(evaluatePitRisk({...input,speedKph:180,weatherGrip:.58,visibility:.4,roadRisk:1,trafficDensity:1,obstacleRisk:1}).authorization,"denied");
  assert.equal(evaluatePitRisk({...input,speedKph:180,weatherGrip:.58,visibility:.4,roadRisk:1,trafficDensity:1,obstacleRisk:1,offenseSeverity:.2}).authorization,"terminate");
});
test("all scene/seed/weather samples have a cautious road cruise beneath policy speed without changing maps", () => {
  for(const scene of ["city","country","highway"]) for(const seed of ["PIT-TRAINING","BATCH3-country","42","HELLO"]) for(const weather of ["clear","rain","snow"]) {
    const grip={clear:1,rain:.78,snow:.58}[weather], road=generateRoad(seed,scene);
    assert.ok(road.segments.slice(0,30).some((s,i) => {
      const speed=suspectRoadCruise(s,road.segments[i+1],grip);
      const risk=missionPitRisk({scene,weather,time:"day",vehicle:"patrol"},s,{x:s.x,z:s.z,yaw:s.yaw,speed,lateralSpeed:0},2);
      return speed*3.6<maxPitSpeed(grip) && evaluatePitRisk(risk).authorization==="authorized";
    }),scene+"/"+seed+"/"+weather);
  }
});
test("compound footprints match measured GLB envelopes and preserve total mass/center", () => {
  for(const kind of ["patrol","interceptor","suv","suspect"]) {
    const measured=measureVehicle(kind), spec=kind==="suspect"?SUSPECT:VEHICLES[kind], strips=vehicleColliderStrips(kind);
    assert.ok(Math.abs(spec.length-measured.length)<.001);
    assert.ok(Math.abs(spec.width-measured.width)<.001);
    assert.ok(Math.abs(measured.center+VEHICLE_PROFILES[kind].positionZ)<.001);
    assert.ok(Math.abs(strips.reduce((s,b)=>s+b.mass,0)-spec.mass)<1e-6);
    assert.ok(Math.abs(strips.reduce((s,b)=>s+b.z*b.mass,0))<1e-6);
  }
});
test("containment rejects close but off-axis, rotating, moving or overlapping units", () => {
  const suspect={x:0,z:0,yaw:0,speed:0,lateralSpeed:0};
  const front={...suspect,z:-(SUSPECT.length+VEHICLES.patrol.length)/2-.6};
  const rear={...suspect,z:(SUSPECT.length+VEHICLES.suv.length)/2+.6};
  assert.ok(containmentPose(0,front,suspect,0)); assert.ok(containmentPose(1,rear,suspect,0));
  for(const change of [{x:2},{z:-2},{yaw:.6},{speed:4},{lateralSpeed:2},{z:-10}]) assert.equal(containmentPose(0,{...front,...change},suspect,0),false);
  assert.equal(containmentPose(0,front,{...suspect,lateralSpeed:3},0),false);
});
test("a PIT is distinct from mission victory, disabled targets must actually slow and hold needs stable time", () => {
  assert.equal(pitMissionResolution(false,false,0,10,2),null);
  assert.equal(pitMissionResolution(true,true,0,10,0),null);
  assert.equal(pitMissionResolution(true,true,0,10,.7),null);
  assert.equal(pitMissionResolution(true,true,0,10,.9),"contained");
  assert.equal(pitMissionResolution(true,false,15,2,0),null);
  assert.equal(pitMissionResolution(true,false,0,2,0),"disabled");
});
test("Rapier compound bodies collide at visible surfaces, supply real points and stay inside walls for all models", async () => {
  await RAPIER.init();
  for(const kind of ["patrol","interceptor","suv","suspect"]) for(const grip of [1,.78,.58]) {
    const world=new RAPIER.World({x:0,y:0,z:0});
    try {
      const spec=kind==="suspect"?SUSPECT:VEHICLES[kind];
      const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,0,0).setLinvel(3,0,0).enabledTranslations(true,false,true).enabledRotations(false,true,false).setCcdEnabled(true));
      const colliders=vehicleColliderStrips(kind).map(s=>world.createCollider(RAPIER.ColliderDesc.cuboid(s.halfWidth,.48,s.halfLength).setTranslation(0,0,s.z).setMass(s.mass).setFriction(.68*grip),body));
      const wall=world.createCollider(RAPIER.ColliderDesc.cuboid(.2,1,6).setTranslation(2.2,0,0));
      let contacts=0;
      for(let frame=0;frame<150;frame++) {
        world.step();
        for(const c of colliders) world.contactPair(c,wall,m=>{
          for(let j=0;j<m.numSolverContacts();j++) {
            const p=m.solverContactPoint(j); const local=localPoint({...body.translation(),yaw:2*Math.atan2(body.rotation().y,body.rotation().w)},p);
            assert.ok(Math.abs(local.x)<=spec.width/2+.04); contacts++;
          }
        });
      }
      assert.ok(contacts>0); assert.ok(body.translation().x+spec.width/2<2.09,"crossed wall");
      assert.ok(Math.abs(body.mass()-spec.mass)<1e-5);
    } finally {world.free();}
  }
});
