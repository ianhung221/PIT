import type { RoadSection } from "./roadGeometry.ts";

// Membership bits identify supports independently of chassis and guardrail contacts.
export const GROUND_COLLISION_GROUPS = (1 << 16) | 0xffff;
export const BARRIER_COLLISION_GROUPS = (4 << 16) | 0xffff;
export const ROAD_SURFACE_Y = -.505;
export const SHOULDER_SURFACE_Y = -.6;
export const PRACTICE_SURFACE_Y = -.49;
export const GROUND_HALF_THICKNESS = .5;
// Exceeds one complete 90 s mission of travel away from the route at 200 km/h.
export const OFFROAD_LANDING_MARGIN = 6000;

export interface GroundBounds {
  center: [number, number];
  halfSize: [number, number];
}

/** Keep the cheap bearing floor resident independently of visual tile windows. */
export function groundBounds(sections: readonly RoadSection[], practiceHalfSize = 1250): GroundBounds {
  if (!sections.length) return { center: [0, 0], halfSize: [practiceHalfSize, practiceHalfSize] };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const section of sections) {
    for (const point of [section.startLeft, section.startRight, section.endLeft, section.endRight]) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
    }
  }
  return {
    center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    halfSize: [(maxX - minX) / 2 + OFFROAD_LANDING_MARGIN, (maxZ - minZ) / 2 + OFFROAD_LANDING_MARGIN],
  };
}

/** Flat convex tops have no internal triangle edge for a wheel ray to miss.
 * The 2 cm end overlaps cover floating-point seam cracks without introducing a step.
 * Local coordinates also avoid unnecessarily large hull coordinates far along a route. */
export function roadSupportPrisms(sections: readonly RoadSection[], height = ROAD_SURFACE_Y) {
  return sections.map(section => {
    const centerX = (section.start.x + section.end.x) / 2;
    const centerZ = (section.start.z + section.end.z) / 2;
    const length = Math.hypot(section.end.x - section.start.x, section.end.z - section.start.z);
    const extendX = (section.end.x - section.start.x) / length * .02;
    const extendZ = (section.end.z - section.start.z) / length * .02;
    const corners = [
      { x: section.startLeft.x - extendX, z: section.startLeft.z - extendZ },
      { x: section.startRight.x - extendX, z: section.startRight.z - extendZ },
      { x: section.endLeft.x + extendX, z: section.endLeft.z + extendZ },
      { x: section.endRight.x + extendX, z: section.endRight.z + extendZ },
    ];
    return {
      position: [centerX, height, centerZ] as [number, number, number],
      vertices: new Float32Array([0, -.2].flatMap(y => corners.flatMap(point => [point.x - centerX, y, point.z - centerZ]))),
    };
  });
}
