import { BIOME_ORDER, ROAD_MODULES } from "./roadModules.ts";
import { createSeededRandom } from "./seededRandom.ts";
import { SCENES, type SceneId } from "./gameConfig.ts";
import type { GeneratedRoad, RoadSegment } from "../types/game.ts";

function biomeSequence(start: SceneId, random: () => number): SceneId[] {
  const remaining = BIOME_ORDER.filter((scene) => scene !== start);
  if (random() > .5) remaining.reverse();
  return [start, ...remaining];
}

export function generateRoad(seed: string, start: SceneId, count = 72): GeneratedRoad {
  const random = createSeededRandom(seed);
  const biomes = biomeSequence(start, random);
  const segments: RoadSegment[] = [];
  const length = 72;
  let startX = 0;
  let startZ = 36;
  let yaw = 0;
  let previousTurn = 0;

  for (let index = 0; index < count; index += 1) {
    const biomeIndex = Math.min(2, Math.floor(index / Math.max(1, Math.floor(count / 3))));
    const biome = biomes[biomeIndex];
    const options = ROAD_MODULES[biome];
    const choice = options[Math.floor(random() * options.length)];
    let turn = choice.turn;
    if (Math.abs(previousTurn + turn) > .08) turn *= -.5;
    if (index < 3 || index % 18 === 0) turn = 0;
    const isTransition = index > 0 && biome !== segments[index - 1]?.biome;
    if (isTransition) turn = 0;
    const nextYaw = yaw + turn;
    const midYaw = yaw + turn / 2;
    const forwardX = -Math.sin(midYaw);
    const forwardZ = -Math.cos(midYaw);
    const centerX = startX + forwardX * length / 2;
    const centerZ = startZ + forwardZ * length / 2;
    segments.push({
      id: `${seed}-${index}`,
      index,
      biome,
      x: centerX,
      z: centerZ,
      yaw: midYaw,
      length: length + 2,
      width: SCENES[biome].roadWidth,
      turn,
      risk: Math.min(1, choice.risk + Math.abs(turn) * 2),
      kind: isTransition ? "transition" : choice.kind,
    });
    startX += forwardX * length;
    startZ += forwardZ * length;
    yaw = nextYaw;
    previousTurn = turn;
  }
  return { seed, code: `${start.toUpperCase()}-${seed}`, segments };
}

export function closestRoadSegment(road: GeneratedRoad, x: number, z: number, hint = 0): number {
  let best = Math.max(0, Math.min(road.segments.length - 1, hint));
  let distance = Number.POSITIVE_INFINITY;
  const from = Math.max(0, best - 3);
  const to = Math.min(road.segments.length - 1, best + 7);
  for (let index = from; index <= to; index += 1) {
    const segment = road.segments[index];
    const nextDistance = Math.hypot(segment.x - x, segment.z - z);
    if (nextDistance < distance) {
      best = index;
      distance = nextDistance;
    }
  }
  return best;
}

export function roadTarget(road: GeneratedRoad, index: number, lookAhead = 2): RoadSegment {
  return road.segments[Math.min(road.segments.length - 1, index + lookAhead)];
}
