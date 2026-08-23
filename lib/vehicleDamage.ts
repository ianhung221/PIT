import type { VehicleDamage } from "../types/game.ts";

export const pristineDamage = (): VehicleDamage => ({
  engine: 1, cooling: 1, steering: 1,
  frontLeftGrip: 1, frontRightGrip: 1, rearLeftGrip: 1, rearRightGrip: 1,
  alignment: 1, body: 1,
});

export interface ImpactInput { impulse: number; localX: number; localZ: number; halfWidth: number; halfLength: number }
const clampHealth = (value: number) => Math.max(0, Math.min(1, value));

export function applyImpactDamage(current: VehicleDamage, impact: ImpactInput): VehicleDamage {
  const severity = Math.max(0, Math.min(.72, (impact.impulse - 2) / 26));
  if (severity <= 0) return { ...current };
  const front = impact.localZ < -impact.halfLength * .3;
  const rear = impact.localZ > impact.halfLength * .3;
  const left = impact.localX < 0;
  const wheelHit = Math.abs(impact.localX) > impact.halfWidth * .45;
  const next = { ...current };
  next.body = clampHealth(next.body - severity * .5);
  next.alignment = clampHealth(next.alignment - severity * (wheelHit ? .72 : .28));
  if (front) {
    next.engine = clampHealth(next.engine - severity * .62);
    next.cooling = clampHealth(next.cooling - severity * .8);
    next.steering = clampHealth(next.steering - severity * .64);
  }
  if (rear) {
    if (left) next.rearLeftGrip = clampHealth(next.rearLeftGrip - severity * .86);
    else next.rearRightGrip = clampHealth(next.rearRightGrip - severity * .86);
  }
  if (wheelHit && !rear) {
    if (left) next.frontLeftGrip = clampHealth(next.frontLeftGrip - severity * .78);
    else next.frontRightGrip = clampHealth(next.frontRightGrip - severity * .78);
  }
  return next;
}

export function vehicleDriveability(damage: VehicleDamage): number {
  const grip = (damage.frontLeftGrip + damage.frontRightGrip + damage.rearLeftGrip + damage.rearRightGrip) / 4;
  return Math.max(0, Math.min(1, damage.engine * .36 + damage.steering * .25 + grip * .25 + damage.alignment * .14));
}

export function vehicleCanContinue(damage: VehicleDamage): boolean {
  return damage.engine > .16 && damage.steering > .2 && vehicleDriveability(damage) > .28;
}
