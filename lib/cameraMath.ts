import type { CarSnapshot } from "@/types/game";

export interface HelicopterFrame {
  centerX: number;
  centerZ: number;
  separation: number;
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
  const primaryCenterX = (player.x + framedSuspect.x) / 2;
  const primaryCenterZ = (player.z + framedSuspect.z) / 2;
  const nearbySupports = supports.filter((vehicle) =>
    Math.hypot(vehicle.x - primaryCenterX, vehicle.z - primaryCenterZ) <= supportRadius
  );
  const points = targetDistance > maxFocusDistance
    ? [player, player, framedSuspect, ...nearbySupports]
    : [player, framedSuspect, ...nearbySupports];
  const centerX = points.reduce((sum, vehicle) => sum + vehicle.x, 0) / points.length;
  const centerZ = points.reduce((sum, vehicle) => sum + vehicle.z, 0) / points.length;
  const separation = points.reduce(
    (largest, vehicle) => Math.max(largest, Math.hypot(vehicle.x - centerX, vehicle.z - centerZ)),
    0,
  ) * 2;

  return { centerX, centerZ, separation };
}
