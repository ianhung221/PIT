import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { makeBlockade, planBlockade, stepBlockade, blockadeControl, blockadeLocal, blockadeFeedback } from "../lib/supportContainment.ts";
import { driveSupport } from "../lib/supportDriving.ts";
import { coordinatePursuit, nextTacticalCommand } from "../lib/pursuitCoordinator.ts";
import { VEHICLES } from "../lib/gameConfig.ts";

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
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const input = base(), state = makeBlockade();
    try {
      const target = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -72));
      const targetCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(1, .48, 2.2), target);
      const bodies = input.supports.map((c, i) => {
        const spec = i === 0 ? VEHICLES.patrol : VEHICLES.suv;
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, 0, c.z).enabledTranslations(true, false, true).enabledRotations(false, true, false).setLinearDamping(i === 0 ? .09 : .1).setAngularDamping(i === 0 ? 1.5 : 1.6).setCcdEnabled(true));
        world.createCollider(RAPIER.ColliderDesc.cuboid(spec.width / 2, .48, spec.length / 2).setMass(spec.mass), body);
        return body;
      });
      let holdingFor = 0, contacts = 0;
      for (let i = 0; i < 60 * 40; i++) {
        const frames = bodies.map(b => {
          const position = b.translation(), r = b.rotation(), v = b.linvel(), yaw = 2 * Math.atan2(r.y, r.w);
          const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw), rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
          const forwardSpeed = v.x * forwardX + v.z * forwardZ, lateralSpeed = v.x * rightX + v.z * rightZ;
          return { x: position.x, z: position.z, yaw, speed: forwardSpeed, lateralSpeed, forwardX, forwardZ, rightX, rightZ, forwardSpeed };
        });
        input.supports = frames;
        stepBlockade(state, input);
        for (let unit = 0; unit < 2; unit++) {
          const control = blockadeControl(state, unit, frames[unit], input.suspect, [input.suspect, input.player, frames[1 - unit]], road, input.dt, grip);
          if (control) driveSupport(bodies[unit], control.yawError, control.speed, 39, input.dt, grip, frames[unit]);
          world.contactPair(targetCollider, bodies[unit].collider(0), manifold => { if (manifold.numContacts() > 0) contacts++; });
          assert.ok(Math.abs(frames[unit].x) < 5, "support escaped the road");
        }
        world.step();
        holdingFor = state.phase === "holding" ? holdingFor + input.dt : 0;
        if (holdingFor > 2) break;
      }
      assert.ok(holdingFor > 2, JSON.stringify({ grip, state, cars: input.supports.map(c => blockadeLocal(input.suspect, c)) }));
      assert.equal(contacts, 0, "parking must not push the target");
    } finally { world.free(); }
  }
});
