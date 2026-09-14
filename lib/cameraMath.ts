import type { CarSnapshot } from "@/types/game";

export interface HelicopterFrame {
  centerX: number;
  centerZ: number;
  separation: number;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
}

export function computeHelicopterFrame(
  player: CarSnapshot,
  suspect: CarSnapshot,
  supports: CarSnapshot[] = [],
  maxFocusDistance = 60,
  supportRadius = 70,
): HelicopterFrame {
  const deltaX = suspect.x - player.x;
  const deltaZ = suspect.z - player.z;
  const targetDistance = Math.hypot(deltaX, deltaZ);
  const targetScale = targetDistance > maxFocusDistance ? maxFocusDistance / targetDistance : 1;
  const framedSuspect = {
    x: player.x + deltaX * targetScale,
    z: player.z + deltaZ * targetScale,
  };
  const focusBlend = smoothstep(maxFocusDistance * .9, maxFocusDistance * 1.15, targetDistance);
  const playerWeight = 1 + focusBlend;
  const primaryWeight = playerWeight + 1;
  const primaryCenterX = (player.x * playerWeight + framedSuspect.x) / primaryWeight;
  const primaryCenterZ = (player.z * playerWeight + framedSuspect.z) / primaryWeight;
  let weightedX = primaryCenterX * primaryWeight;
  let weightedZ = primaryCenterZ * primaryWeight;
  let totalWeight = primaryWeight;
  const weightedSupports: Array<{ vehicle: CarSnapshot; weight: number }> = [];

  for (const vehicle of supports) {
    const distance = Math.hypot(vehicle.x - primaryCenterX, vehicle.z - primaryCenterZ);
    const weight = 1 - smoothstep(supportRadius * .72, supportRadius, distance);
    if (weight <= 0) continue;
    weightedX += vehicle.x * weight;
    weightedZ += vehicle.z * weight;
    totalWeight += weight;
    weightedSupports.push({ vehicle, weight });
  }

  const centerX = weightedX / totalWeight;
  const centerZ = weightedZ / totalWeight;
  let halfSpan = Math.max(
    Math.hypot(player.x - centerX, player.z - centerZ),
    Math.hypot(framedSuspect.x - centerX, framedSuspect.z - centerZ),
  );
  for (const { vehicle, weight } of weightedSupports) {
    halfSpan = Math.max(halfSpan, Math.hypot(vehicle.x - centerX, vehicle.z - centerZ) * weight);
  }
  const separation = halfSpan * 2;

  return { centerX, centerZ, separation };
}
