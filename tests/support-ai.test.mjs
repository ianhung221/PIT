import test from "node:test";
import assert from "node:assert/strict";
import { generateRoad } from "../lib/proceduralMap.ts";
import { makeSupportAI, roadPoint, roadCoordinate, supportSlot, stepSupportAI } from "../lib/supportUnitAI.ts";
import { coordinatePursuit, nextTacticalCommand, tacticalFeedback } from "../lib/pursuitCoordinator.ts";
const road = generateRoad("SUPPORT-TEST", "country");
const carAt = (distance, side = 0, speed = 0) => ({ ...roadPoint(road, distance, side), speed, lateralSpeed: 0 });
const slotFor = (command, role = "secondary", unit = 0) => supportSlot({ road, player: carAt(100, 0, 22), suspect: carAt(140, 0, 25), playerIndex: 1, suspectIndex: 1, unit, role, command });

test("tactical commands have distinct slots and request-pit preserves takeover", () => {
  assert.equal(nextTacticalCommand("take-primary", "request-pit"), "take-primary");
  assert.equal(nextTacticalCommand("take-primary", "prepare-pit"), "prepare-pit");
  const slots = [slotFor(null), slotFor("prepare-pit"), slotFor("move-up"), slotFor("take-primary", "primary")];
  assert.equal(new Set(slots.map(s => s.distance)).size, 4);
});
test("front blocking waits for slowdown and does not change PIT qualification", () => {
  const base = { command: "block-front", pitQualified: false, suspectDriveable: true, playerDriveability: 1 };
  assert.equal(coordinatePursuit({ ...base, suspectStopped: false }).phase, "pursuit");
  assert.equal(coordinatePursuit({ ...base, suspectStopped: true }).unit2, "containment-front");
  assert.equal(tacticalFeedback("block-front", false, true, false).phase, "unable");
  assert.equal(tacticalFeedback("block-front", true, true, false).phase, "completed");
});
test("road navigation respects transition width and round-trips longitudinal progress", () => {
  for (let i = 0; i < road.segments.length; i++) {
    const p = roadPoint(road, i * 72 + 20, 200);
    assert.ok(Math.abs(roadCoordinate(road, p, i) - (i * 72 + 20)) < 1e-6);
    const s = road.segments[i];
    assert.ok(Math.hypot(p.x - roadPoint(road, i * 72 + 20).x, p.z - roadPoint(road, i * 72 + 20).z) < s.width / 2);
  }
});
test("stopped formation does not creep or falsely enter recovery", () => {
  const car = carAt(70, 2.5), ai = makeSupportAI(car.x, car.z);
  const slot = { ...car, distance: 70, side: 2.5, speed: 0, role: "secondary" };
  for (let n = 0; n < 600; n++) {
    const c = stepSupportAI(ai, { car, road, index: 0, slot, dt: 1/60, grip: 1, maxSpeed: 43, neighbors: [] });
    assert.equal(c.speed, 0); assert.equal(ai.mode, "driving");
  }
});
test("each unit runs independent brake, reverse, realign and rejoin states", () => {
  for (const side of [-4, 4]) {
    const car = { ...carAt(50, side), yaw: -Math.sign(side) * Math.PI / 2 };
    const ai = makeSupportAI(car.x, car.z), untouched = makeSupportAI(0, 0);
    const modes = new Set();
    for (let n = 0; n < 300; n++) {
      stepSupportAI(ai, { car, road, index: 0, slot: slotFor(null), dt: 1/60, grip: .58, maxSpeed: 39, neighbors: [] });
      modes.add(ai.mode);
      if (ai.mode === "realigning") { car.yaw = 0; car.speed = 2; }
    }
    assert.ok(modes.has("braking") && modes.has("reversing") && modes.has("realigning"));
    assert.equal(ai.mode, "driving"); assert.equal(untouched.mode, "driving");
  }
});
test("catch-up respects top speed, braking distance and a stationary vehicle ahead", () => {
  const car = carAt(50, 0, 25), ai = makeSupportAI(car.x, car.z);
  const args = { car, road, index: 0, slot: slotFor("take-primary", "primary"), dt: 1/60, grip: 1, maxSpeed: 39, neighbors: [] };
  assert.ok(stepSupportAI(ai, args).speed <= 39);
  const blocked = stepSupportAI(ai, { ...args, neighbors: [carAt(57)] });
  assert.equal(blocked.speed, 0);
});

test("front blocker keeps its passing side when the suspect has a tiny yaw offset", () => {
  const suspect = { ...carAt(108), yaw: .003 };
  const car = carAt(90, 3);
  const slot = supportSlot({ road, player: carAt(60,-3), suspect, playerIndex: 0, suspectIndex: 1, unit: 0, role: "containment-front", command: "block-front" });
  const control = stepSupportAI(makeSupportAI(car.x,car.z), { car, road, index: 1, slot, dt: 1/60, grip: 1, maxSpeed: 43, neighbors: [suspect] });
  assert.ok(control.yawError < 0 && control.yawError > -.1, String(control.yawError));
  assert.ok(control.speed > 0);
});
