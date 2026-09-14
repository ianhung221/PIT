import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePitRisk } from "../lib/pitPolicy.ts";
import { applyImpactDamage, pristineDamage, vehicleCanContinue, vehicleDriveability } from "../lib/vehicleDamage.ts";
import { coordinatePursuit } from "../lib/pursuitCoordinator.ts";
import { generateRoad } from "../lib/proceduralMap.ts";
import { assessPitImpact } from "../lib/pitSimulation.ts";
import { VEHICLE_VISUALS } from "../lib/gameConfig.ts";
import { computeHelicopterFrame } from "../lib/cameraMath.ts";
import { existsSync } from "node:fs";

test("authorizes a low-risk PIT and holds an unsafe one", () => {
  const safe = evaluatePitRisk({ speedKph: 52, weatherGrip: 1, visibility: 1, roadRisk: .1, trafficDensity: 0, obstacleRisk: 0, offenseSeverity: .8, supportUnits: 2 });
  assert.equal(safe.authorization, "authorized");
  const unsafe = evaluatePitRisk({ speedKph: 112, weatherGrip: .58, visibility: .68, roadRisk: .9, trafficDensity: .7, obstacleRisk: .8, offenseSeverity: .8, supportUnits: 2 });
  assert.ok(["hold", "denied"].includes(unsafe.authorization));
});

test("refuses PIT against a vulnerable target class", () => {
  const result = evaluatePitRisk({ speedKph: 20, weatherGrip: 1, visibility: 1, roadRisk: 0, trafficDensity: 0, obstacleRisk: 0, offenseSeverity: 1, supportUnits: 2, targetClass: "vulnerable" });
  assert.equal(result.authorization, "denied");
});

test("classifies PIT force separately from policy authorization", () => {
  const base = { localX: .9, localZ: 1.5, halfWidth: 1, halfLength: 2.2, relativeSpeed: 3.4, headingDelta: .1, effectiveMass: 1, roadGrip: 1 };
  assert.equal(assessPitImpact({ ...base, authorized: true }).classification, "effective");
  assert.equal(assessPitImpact({ ...base, authorized: false }).classification, "unsafe");
  assert.equal(assessPitImpact({ ...base, authorized: true, relativeSpeed: 14 }).classification, "excessive");
  assert.equal(assessPitImpact({ ...base, authorized: true, localZ: -1.8 }).classification, "scrape");
});

test("applies localized component damage without a single hit-point pool", () => {
  const rear = applyImpactDamage(pristineDamage(), { impulse: 20, localX: -1, localZ: 2, halfWidth: 1, halfLength: 2.2 });
  assert.ok(rear.rearLeftGrip < rear.engine);
  const front = applyImpactDamage(pristineDamage(), { impulse: 26, localX: .8, localZ: -2, halfWidth: 1, halfLength: 2.2 });
  assert.ok(front.engine < 1 && front.steering < 1);
  assert.ok(vehicleDriveability(front) > 0 && vehicleDriveability(front) < 1);
});

test("marks a severely damaged vehicle unable to continue", () => {
  assert.equal(vehicleCanContinue({ ...pristineDamage(), engine: .1, steering: .15 }), false);
});

test("assigns support units to containment and preserves player primary role", () => {
  const result = coordinatePursuit({ pitQualified: true, suspectStopped: true, suspectDriveable: true, playerDriveability: 1 });
  assert.equal(result.player, "primary");
  assert.equal(result.unit2, "containment-front");
  assert.equal(result.unit3, "containment-rear");
});

test("moves unit two into primary only when commanded or player driveability is poor", () => {
  const commanded = coordinatePursuit({ command: "take-primary", pitQualified: false, suspectStopped: false, suspectDriveable: true, playerDriveability: 1 });
  assert.equal(commanded.unit2, "primary");
  assert.equal(commanded.player, "secondary");
  const pitReady = coordinatePursuit({ command: "prepare-pit", pitQualified: false, suspectStopped: false, suspectDriveable: true, playerDriveability: 1 });
  assert.equal(pitReady.phase, "pit-ready");
  assert.equal(pitReady.player, "primary");
});

test("uses the same seed for the same road and different seeds for variation", () => {
  const first = generateRoad("TRAINING-42", "city", 36);
  const replay = generateRoad("TRAINING-42", "city", 36);
  const different = generateRoad("TRAINING-43", "city", 36);
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first.segments.map((item) => item.turn), different.segments.map((item) => item.turn));
  assert.equal(first.segments.length, 36);
  assert.ok(first.segments.every((item) => Number.isFinite(item.x) && Number.isFinite(item.z)));
});

test("generated roads cross all three biomes without disconnected metadata", () => {
  const road = generateRoad("BIOME-CHECK", "country", 72);
  assert.deepEqual(new Set(road.segments.map((segment) => segment.biome)), new Set(["city", "country", "highway"]));
  assert.ok(road.segments.every((segment, index) => segment.index === index && segment.length > 0 && segment.width > 0));
  assert.ok(road.segments.slice(1).every((segment, index) => {
    const previous = road.segments[index];
    const centerDistance = Math.hypot(segment.x - previous.x, segment.z - previous.z);
    return centerDistance > 68 && centerDistance < 76;
  }));
});

test("defines a visual adapter for every vehicle without changing the physics forward axis", () => {
  assert.deepEqual(Object.keys(VEHICLE_VISUALS).sort(), ["interceptor", "patrol", "suspect", "suv"]);
  for (const visual of Object.values(VEHICLE_VISUALS)) {
    assert.equal(visual.rotationY, Math.PI);
    assert.equal(visual.scale.length, 3);
    assert.ok(visual.scale.every((value) => Number.isFinite(value) && value > 0));
  }
});

test("ships the CC0 colormap referenced by every Kenney GLB", () => {
  assert.equal(existsSync("public/assets/kenney-car-kit/Textures/colormap.png"), true);
});

test("keeps the player in the helicopter frame when the suspect is far away", () => {
  const player = { x: 0, z: 0, yaw: 0, speed: 20, lateralSpeed: 0 };
  const suspect = { x: 0, z: -250, yaw: 0, speed: 25, lateralSpeed: 0 };
  const frame = computeHelicopterFrame(player, suspect, [], 90, 70);
  assert.ok(Math.hypot(frame.centerX - player.x, frame.centerZ - player.z) <= 30);
  assert.ok(frame.separation <= 120);
});

test("centers both pursuit vehicles at normal helicopter range", () => {
  const player = { x: 0, z: 0, yaw: 0, speed: 20, lateralSpeed: 0 };
  const suspect = { x: 0, z: -70, yaw: 0, speed: 25, lateralSpeed: 0 };
  const frame = computeHelicopterFrame(player, suspect, [], 90, 70);
  assert.equal(frame.centerZ, -35);
  assert.equal(frame.separation, 70);
});

test("blends helicopter framing continuously around the focus distance", () => {
  const player = { x: 0, z: 0, yaw: 0, speed: 20, lateralSpeed: 0 };
  const justInside = { x: 0, z: -89.9, yaw: 0, speed: 25, lateralSpeed: 0 };
  const justOutside = { x: 0, z: -90.1, yaw: 0, speed: 25, lateralSpeed: 0 };
  const before = computeHelicopterFrame(player, justInside, [], 90, 70);
  const after = computeHelicopterFrame(player, justOutside, [], 90, 70);
  assert.ok(Math.abs(before.centerZ - after.centerZ) < 1);
  assert.ok(Math.abs(before.separation - after.separation) < 1);
});
