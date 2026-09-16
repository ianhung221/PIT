import test from "node:test";
import assert from "node:assert/strict";
import { generateRoad } from "../lib/proceduralMap.ts";
import { roadSections, loadedRoadIndices, ROAD_WINDOW_LIMIT } from "../lib/roadGeometry.ts";
import { createWeatherParticles, advanceWeather } from "../lib/weatherMotion.ts";
import RAPIER from "@dimforge/rapier3d-compat";

test("Rapier barriers stop a vehicle at both sides of every width transition", async () => {
  await RAPIER.init();
  for (const biome of ["city", "country", "highway"]) {
    const road = generateRoad("BARRIER-CHECK", biome);
    const sections = roadSections(road);
    for (const segment of road.segments.filter(s => s.kind === "transition")) for (const side of ["Left", "Right"]) {
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      try {
        for (let i = segment.index - 1; i <= segment.index + 1; i++) {
          const start = sections[i][`start${side}`], end = sections[i][`end${side}`];
          const yaw = Math.atan2(-(end.x - start.x), -(end.z - start.z));
          const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((start.x + end.x) / 2, .12, (start.z + end.z) / 2).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
          world.createCollider(RAPIER.ColliderDesc.cuboid(.16, .31, (Math.hypot(end.x - start.x, end.z - start.z) + .12) / 2), wall);
        }
        const point = sections[segment.index][`start${side}`];
        const center = sections[segment.index].start;
        const distance = Math.hypot(point.x - center.x, point.z - center.z);
        const nx = (point.x - center.x) / distance, nz = (point.z - center.z) / distance;
        const car = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(point.x - nx * 4, .02, point.z - nz * 4).setLinvel(nx * 35, 0, nz * 35).setCcdEnabled(true));
        world.createCollider(RAPIER.ColliderDesc.cuboid(1.075, .48, 2.3), car);
        for (let frame = 0; frame < 60; frame++) world.step();
        const position = car.translation();
        assert.ok((position.x - point.x) * nx + (position.z - point.z) * nz < 0, `${biome} transition ${segment.index} ${side} escaped`);
      } finally { world.free(); }
    }
  }
});

test("all biome transitions and bends share exact road and barrier endpoints", () => {
  for (const biome of ["city", "country", "highway"]) for (const seed of ["TRAINING-42", "TRAINING-43", "BIOME-CHECK"]) {
    const road = generateRoad(seed, biome);
    const sections = roadSections(road);
    for (let i = 1; i < sections.length; i++) {
      assert.deepEqual(sections[i - 1].end, sections[i].start);
      assert.deepEqual(sections[i - 1].endLeft, sections[i].startLeft);
      assert.deepEqual(sections[i - 1].endRight, sections[i].startRight);
      assert.equal(road.segments[i].startWidth, road.segments[i - 1].endWidth);
    }
    for (const section of sections) {
      assert.ok(Math.hypot(section.end.x - section.start.x, section.end.z - section.start.z) > 70);
      assert.ok(section.startLeft.x !== section.startRight.x || section.startLeft.z !== section.startRight.z);
    }
  }
});

test("four dispersed cars keep every safety window without unbounded loading", () => {
  const cars = [3, 40, 80, 120];
  const loaded = loadedRoadIndices(160, cars);
  for (const car of cars) for (let i = car - 3; i < car + 12; i++) assert.ok(loaded.includes(i));
  assert.equal(loaded.length, ROAD_WINDOW_LIMIT);
  assert.equal(new Set(loaded).size, loaded.length);
  assert.deepEqual(loadedRoadIndices(5, [0, 0, 4, 4]), [0, 1, 2, 3, 4]);
});

test("rain and snow stay dispersed through long runs and large frame deltas", () => {
  for (const weather of ["rain", "snow"]) {
    const particles = createWeatherParticles(680);
    for (let i = 0; i < 60 * 180; i++) advanceWeather(particles, weather, 1 / 60, 0, 0);
    advanceWeather(particles, weather, 30, 200, -200);
    const heights = Array.from(particles.positions).filter((_, i) => i % 3 === 1);
    assert.ok(new Set(heights.map(y => Math.floor(y))).size >= 16);
    assert.ok(heights.every(y => y >= 0 && y < 18));
    assert.ok(Array.from(particles.positions).every(Number.isFinite));
  }
});

test("precipitation compensates actual world travel including reverse and sideways motion", () => {
  const forward = createWeatherParticles(1);
  const reverse = createWeatherParticles(1);
  forward.positions.set([0, 10, 0]);
  reverse.positions.set([0, 10, 0]);
  advanceWeather(forward, "rain", .01, 2, -3);
  advanceWeather(reverse, "rain", .01, -2, 3);
  assert.equal(forward.positions[0], -2);
  assert.equal(forward.positions[2], 3);
  assert.equal(reverse.positions[0], 2);
  assert.equal(reverse.positions[2], -3);
});
