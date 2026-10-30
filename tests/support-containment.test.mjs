import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { makeBlockade, planBlockade, stepBlockade, blockadeControl, blockadeLocal, blockadeFeedback } from "../lib/supportContainment.ts";
import { driveSupport } from "../lib/supportDriving.ts";
import { coordinatePursuit, nextTacticalCommand } from "../lib/pursuitCoordinator.ts";
import { physicalWorld, physicsSnapshot, stepVehiclePhysics } from './helpers/vehicle-world.mjs';
import { chassisShapes,vehicleSpawnHeight,CHASSIS_COLLISION_GROUPS } from '../lib/vehiclePhysicsConfig.ts';

const road = { seed: "BLOCK", code: "BLOCK", segments: Array.from({length: 5}, (_, index) => ({ index, id: String(index), biome: "country", x: 0, z: -index * 72, yaw: 0, length: 74, width: 11, kind: "straight", turn: 0, risk: 0 })) };
const car = (x, forward, speed = 0, yaw = 0) => ({ x, z: -72 - forward, yaw, speed, lateralSpeed: 0 });
const base = () => ({ road, index: 1, suspect: car(0, 0), supports: [car(3, -18), car(-2, -32)], player: car(-3, -45), dt: 1 / 60 });

test("Q4 stays armed at speed and engages after slowdown without another command or PIT flag", () => {
  const state = makeBlockade(), input = base();
  input.suspect.speed = 24;
  for (let i = 0; i < 120; i++) stepBlockade(state, input);
  assert.equal(state.phase, "waiting");
  assert.equal(blockadeFeedback(state).phase, "executing");
  input.suspect.speed = 0;
  for (let i = 0; i < 30; i++) stepBlockade(state, input);
  assert.equal(state.phase, "approaching");
  const anchor = { ...state.anchor };
  input.suspect.yaw = Math.PI;
  for (let i = 0; i < 30; i++) stepBlockade(state, input);
  assert.deepEqual(state.anchor, anchor, "PIT spin must not flip the chosen road route");
});

test("narrow or occupied corridors and distant support report a missed opportunity without a false completion", () => {
  for (const setup of [
    args => { args.road = { ...road, segments: road.segments.map(s => ({ ...s, width: 6 })) }; },
    args => { args.supports[1] = car(0, -100); },
  ]) {
    const state = makeBlockade(), input = base(); setup(input);
    for (let i = 0; i < 30; i++) stepBlockade(state, input);
    assert.equal(state.phase, "missed"); assert.equal(blockadeFeedback(state).phase, "unable");
  }
  const input = base(); input.player = car(3, 1);
  const plan = planBlockade(road, 1, input.suspect, input.supports, input.player);
  assert.ok(plan.side < 0, "must choose the side not occupied by the player");
});

test("brief speed noise does not cancel approach; a real escape returns to armed pursuit", () => {
  const state = makeBlockade(), input = base();
  for (let i = 0; i < 30; i++) stepBlockade(state, input);
  input.suspect.speed = 7.5;
  for (let i = 0; i < 10; i++) stepBlockade(state, input);
  assert.equal(state.phase, "approaching");
  for (let i = 0; i < 40; i++) stepBlockade(state, input);
  assert.equal(state.phase, "missed");
  for (let i = 0; i < 190; i++) stepBlockade(state, input);
  assert.equal(state.phase, "waiting");
  assert.equal(nextTacticalCommand("block-front", "request-pit"), "block-front");
  for (const command of ["prepare-pit", "move-up", "take-primary", "terminate"]) assert.equal(nextTacticalCommand("block-front", command), command);
  const assigned = coordinatePursuit({ command: "block-front", blockadePhase: "missed", pitQualified: true, suspectStopped: true, suspectDriveable: true, playerDriveability: 1 });
  assert.equal(assigned.phase, "pursuit");
});

test("a car near the front point but beside the escape lane cannot count as held", () => {
  const state = makeBlockade(), input = base();
  for (let i = 0; i < 30; i++) stepBlockade(state, input);
  state.stages[0] = 3;
  for (let i = 0; i < 120; i++) {
    blockadeControl(state, 0, car(3, state.anchor.front), input.suspect, [], road, input.dt, 1);
    stepBlockade(state, input);
  }
  assert.equal(state.settled[0], 0); assert.notEqual(state.phase, "holding");
});

test("Rapier support cars pass, park front/rear and hold without touching the stationary target in clear/rain/snow", async () => {
  await RAPIER.init();
  for (const grip of [1, .78, .58]) {
    const sim = physicalWorld();
    sim.remove(sim.vehicle);
    const world = sim.world;
    const input = base(), state = makeBlockade();
    try {
      const target = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, vehicleSpawnHeight('suspect'), -72));
      const targetColliders = chassisShapes('suspect').map(shape=>world.createCollider(RAPIER.ColliderDesc.cuboid(...shape.halfExtents).setTranslation(...shape.position).setCollisionGroups(CHASSIS_COLLISION_GROUPS),target));
      const vehicles = input.supports.map((c,i)=>sim.add(i===0?'patrol':'suv',c.x,c.z));
      const bodies = vehicles.map(v=>v.body);
      for(let i=0;i<120;i++){for(const v of vehicles)stepVehiclePhysics(v,{throttle:0,brake:0,steer:0,gear:1},grip);world.step();}
      let holdingFor = 0, contacts = 0;
      for (let i = 0; i < 60 * 40; i++) {
        const frames = vehicles.map(physicsSnapshot);
        input.supports = frames;
        stepBlockade(state, input);
        for (let unit = 0; unit < 2; unit++) {
          const control = blockadeControl(state, unit, frames[unit], input.suspect, [input.suspect, input.player, frames[1 - unit]], road, input.dt, grip);
          driveSupport(bodies[unit], control?.yawError??0, control?.speed??0, 39, input.dt, grip, {forwardSpeed:frames[unit].speed});
          for(const tc of targetColliders)for(let c=0;c<bodies[unit].numColliders();c++)world.contactPair(tc,bodies[unit].collider(c),manifold=>{if(manifold.numSolverContacts()>0)contacts++;});
          assert.ok(Math.abs(frames[unit].x) < 5, "support escaped the road");
        }
        world.step();
        holdingFor = state.phase === "holding" ? holdingFor + input.dt : 0;
        if (holdingFor > 2) break;
      }
      assert.ok(holdingFor > 2, JSON.stringify({ grip, state, cars: input.supports.map(c => blockadeLocal(input.suspect, c)) }));
      assert.equal(contacts, 0, "parking must not push the target");
    } finally { sim.dispose(); }
  }
});
