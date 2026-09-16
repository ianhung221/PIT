import type { GeneratedRoad } from "../types/game.ts";

export interface RoadPoint { x: number; z: number }
export const ROAD_WINDOW_LIMIT = 4 * 15;

/** Four independent 15-segment windows: never evict a car's safety area to satisfy a cap. */
export function loadedRoadIndices(count: number, cars: readonly number[]): number[] {
  const indices = new Set<number>();
  for (const index of cars.slice(0, 4)) {
    const center = Math.max(0, Math.min(count - 1, Math.floor(index)));
    for (let i = Math.max(0, center - 3); i < Math.min(count, center + 12); i++) indices.add(i);
  }
  return [...indices].sort((a, b) => a - b);
}

/** Generator advances 72 m; legacy length includes 2 m visual overlap. Shared
 * cross-sections replace that overlap, including identical mitred barrier endpoints. */
export function roadSections(road: GeneratedRoad) {
  const segments = road.segments;
  const boundaries = segments.map((segment, index) => {
    const half = (segment.length - 2) / 2;
    const center = { x: segment.x + Math.sin(segment.yaw) * half, z: segment.z + Math.cos(segment.yaw) * half };
    const previousYaw = segments[Math.max(0, index - 1)].yaw;
    const yaw = (previousYaw + segment.yaw) / 2;
    const halfWidth = (segment.startWidth ?? segment.width) / 2 / Math.cos((segment.yaw - previousYaw) / 2);
    return { center, left: { x: center.x - Math.cos(yaw) * halfWidth, z: center.z + Math.sin(yaw) * halfWidth }, right: { x: center.x + Math.cos(yaw) * halfWidth, z: center.z - Math.sin(yaw) * halfWidth } };
  });
  const last = segments.at(-1);
  if (!last) return [];
  const half = (last.length - 2) / 2;
  const center = { x: last.x - Math.sin(last.yaw) * half, z: last.z - Math.cos(last.yaw) * half };
  const width = (last.endWidth ?? last.width) / 2;
  boundaries.push({ center, left: { x: center.x - Math.cos(last.yaw) * width, z: center.z + Math.sin(last.yaw) * width }, right: { x: center.x + Math.cos(last.yaw) * width, z: center.z - Math.sin(last.yaw) * width } });
  return segments.map((_, i) => ({ start: boundaries[i].center, end: boundaries[i + 1].center, startLeft: boundaries[i].left, startRight: boundaries[i].right, endLeft: boundaries[i + 1].left, endRight: boundaries[i + 1].right }));
}

export type RoadSection = ReturnType<typeof roadSections>[number];

export function alongRoad(section: RoadSection, t: number, lateral = 0): RoadPoint {
  const leftX = section.startLeft.x + (section.endLeft.x - section.startLeft.x) * t;
  const leftZ = section.startLeft.z + (section.endLeft.z - section.startLeft.z) * t;
  const rightX = section.startRight.x + (section.endRight.x - section.startRight.x) * t;
  const rightZ = section.startRight.z + (section.endRight.z - section.startRight.z) * t;
  return { x: leftX + (rightX - leftX) * (lateral + 1) / 2, z: leftZ + (rightZ - leftZ) * (lateral + 1) / 2 };
}
