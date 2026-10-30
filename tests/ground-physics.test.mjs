import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { generateRoad } from "../lib/proceduralMap.ts";
import { alongRoad, roadSections } from "../lib/roadGeometry.ts";
import {
  GROUND_COLLISION_GROUPS, BARRIER_COLLISION_GROUPS, GROUND_HALF_THICKNESS,
  ROAD_SURFACE_Y, SHOULDER_SURFACE_Y, PRACTICE_SURFACE_Y,
  groundBounds, roadSupportPrisms,
} from "../lib/groundPhysics.ts";
import { physicalWorld, physicsSnapshot } from "./helpers/vehicle-world.mjs";

await RAPIER.init();
const CHASSIS_GROUPS = (2 << 16) | 0xffff;
const GROUND_QUERY = 0xffff0001;

function createGround(world, sections = []) {
  const bounds = groundBounds(sections);
  const height = sections.length ? SHOULDER_SURFACE_Y : PRACTICE_SURFACE_Y;
  const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(bounds.halfSize[0], GROUND_HALF_THICKNESS, bounds.halfSize[1])
    .setTranslation(bounds.center[0], height - GROUND_HALF_THICKNESS, bounds.center[1])
    .setCollisionGroups(GROUND_COLLISION_GROUPS).setFriction(.7).setRestitution(.02));
  for (const prism of roadSupportPrisms(sections)) world.createCollider(RAPIER.ColliderDesc.convexHull(prism.vertices)
    .setTranslation(...prism.position).setCollisionGroups(GROUND_COLLISION_GROUPS).setFriction(.7).setRestitution(.02));
  return floor;
}

function chassis(world, point, height = 3) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(point.x, height, point.z).setCcdEnabled(true));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.9, .4, 2).setMass(1200).setCollisionGroups(CHASSIS_GROUPS), body);
  return body;
}

test("wheel rays find an upward road surface on both sides of every bend and width seam", () => {
  for (const biome of ["city", "country", "highway"]) for (const seed of ["BEARING-1", "BEARING-2", "BEARING-3"]) {
    const sections = roadSections(generateRoad(seed, biome));
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      createGround(world, sections);
      world.step();
      for (const section of sections) for (const t of [0, .00001, .1, .2, .3, .4, .5, .6, .7, .8, .9, .99999, 1]) for (const lateral of [-.95, -.5, 0, .5, .95]) {
        const point = alongRoad(section, t, lateral);
        const ray = new RAPIER.Ray({ x: point.x, y: 2, z: point.z }, { x: 0, y: -1, z: 0 });
        const hit = world.castRayAndGetNormal(ray, 4, true, undefined, GROUND_QUERY);
        assert.ok(hit, `${biome}/${seed}: missing bearing surface`);
        // Rapier's convex GJK ray distance is approximate; a shoulder miss is 9.5 cm.
        assert.ok(Math.abs((2 - hit.timeOfImpact) - ROAD_SURFACE_Y) < .02, `${biome}/${seed} section ${sections.indexOf(section)} t=${t} lateral=${lateral}: seam falls to ${2 - hit.timeOfImpact}`);
        assert.ok(hit.normal.y > .999, `${biome}/${seed}: non-upward road normal`);
      }
    } finally { world.free(); }
  }
});

test("four widely separated vehicles land and remain supported independently of visual windows", () => {
  const sections = roadSections(generateRoad("FOUR-BEARING-WINDOWS", "city"));
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    createGround(world, sections);
    const cars = [2, 24, 47, 70].map(index => chassis(world, alongRoad(sections[index], .5)));
    for (let i = 0; i < 300; i++) world.step();
    cars.forEach(car => {
      assert.ok(Math.abs(car.translation().y - (ROAD_SURFACE_Y + .4)) < .02, `unsupported car at ${JSON.stringify(car.translation())}`);
      assert.ok(Math.abs(car.linvel().y) < .02);
    });
    assert.equal(world.colliders.len(), sections.length + 5, "bounded resident supports: one convex per road segment plus one base floor");
  } finally { world.free(); }
});

test("an airborne car beyond the guardrails lands on the matching shoulder instead of falling forever", () => {
  const sections = roadSections(generateRoad("OFFROAD-LANDING", "highway"));
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    createGround(world, sections);
    const cars = [-1, 1].map(side => {
      const point = alongRoad(sections[36], .5, side * 5);
      const car = chassis(world, point, 12);
      car.setLinvel({ x: side * 8, y: 3, z: 2 }, true);
      return car;
    });
    for (let i = 0; i < 600; i++) world.step();
    cars.forEach(car => {
      assert.ok(Math.abs(car.translation().y - (SHOULDER_SURFACE_Y + .4)) < .02);
      assert.ok(Math.abs(car.linvel().y) < .02);
    });
  } finally { world.free(); }
});

test("a physical chassis crossing every biome transition does not snag or bounce at road seams", () => {
  const road = generateRoad("TRANSITION-DRIVE", "city");
  const sections = roadSections(road);
  for (const segment of road.segments.filter(item => item.kind === "transition")) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    try {
      createGround(world, sections);
      const section = sections[segment.index];
      const previous = sections[segment.index - 1];
      const start = alongRoad(previous, .85);
      const end = alongRoad(section, .15);
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const car = chassis(world, start, ROAD_SURFACE_Y + .4);
      // Preserve the physics-owned vertical velocity while driving through the seam.
      let maxBounce = 0;
      for (let frame = 0; frame < Math.ceil(length / 14 * 60); frame++) {
        car.setLinvel({ x: (end.x - start.x) / length * 14, y: car.linvel().y, z: (end.z - start.z) / length * 14 }, true);
        world.step();
        maxBounce = Math.max(maxBounce, Math.abs(car.translation().y - (ROAD_SURFACE_Y + .4)));
      }
      assert.ok(maxBounce < .025, `transition ${segment.index} bounced ${maxBounce} m`);
      assert.ok(Math.hypot(car.translation().x - start.x, car.translation().z - start.z) > length * .9, "car caught on the seam");
    } finally { world.free(); }
  }
});

test("all four suspension-driven vehicles cross biome seams without losing wheels or sustained bouncing", () => {
  for (const kind of ["patrol", "interceptor", "suv", "suspect"]) for (const biome of ["city", "country", "highway"]) {
    const road = generateRoad("WHEEL-SEAMS", biome);
    const sections = roadSections(road);
    for (const segment of road.segments.filter(item => item.kind === "transition")) {
      const simulation = physicalWorld(kind);
      try {
        simulation.world.removeCollider(simulation.ground, true);
        createGround(simulation.world, sections);
        const start = alongRoad(sections[segment.index - 1], .85);
        const end = alongRoad(sections[segment.index], .4);
        const yaw = Math.atan2(-(end.x - start.x), -(end.z - start.z));
        const body = simulation.vehicle.body;
        body.setTranslation({ x: start.x, y: body.translation().y, z: start.z }, true);
        body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
        for (let i = 0; i < 120; i++) simulation.step();
        const restY = body.translation().y;
        let previousY = restY;
        body.setLinvel({ x: -Math.sin(yaw) * 12, y: 0, z: -Math.cos(yaw) * 12 }, true);
        for (let i = 0; i < 150; i++) {
          simulation.step({ throttle: .08, brake: 0, steer: 0, gear: 1 });
          const state = physicsSnapshot(simulation.vehicle);
          const description = `${kind}/${biome} transition ${segment.index}, frame ${i}`;
          assert.equal(state.pose.groundedWheels, 4, `${description}: a wheel lost its bearing surface`);
          assert.ok(Math.abs(state.pose.y - restY) < .015, `${description}: excessive body bounce`);
          assert.ok(Math.abs(state.pose.y - previousY) < .005, `${description}: abrupt height step`);
          previousY = state.pose.y;
        }
        assert.ok(Math.hypot(body.translation().x - start.x, body.translation().z - start.z) > 25, "vehicle must actually drive across the seam");
      } finally { simulation.dispose(); }
    }
  }
});

test("wheel queries ignore cars and barriers while chassis still lands on the practice ground", () => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    const floor = createGround(world);
    const car = chassis(world, { x: 0, z: 0 }, 1);
    const barrier = world.createCollider(RAPIER.ColliderDesc.cuboid(1, .3, 2).setTranslation(0, 4, 0).setCollisionGroups(BARRIER_COLLISION_GROUPS));
    world.step();
    const ray = new RAPIER.Ray({ x: 0, y: 8, z: 0 }, { x: 0, y: -1, z: 0 });
    assert.equal(world.castRay(ray, 10, true).collider.handle, barrier.handle);
    const hit = world.castRay(ray, 10, true, undefined, GROUND_QUERY);
    assert.equal(hit.collider.handle, floor.handle);
    assert.ok(Math.abs(8 - hit.timeOfImpact - PRACTICE_SURFACE_Y) < .001);
    for (let i = 0; i < 240; i++) world.step();
    assert.ok(Math.abs(car.translation().y - (PRACTICE_SURFACE_Y + .4)) < .02);
  } finally { world.free(); }
});
