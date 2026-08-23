import { PIT_RULES } from "./gameConfig.ts";

export type PitContactClass = "scrape" | "effective" | "excessive" | "unsafe";

export interface PitImpactInput {
  localX: number;
  localZ: number;
  halfWidth: number;
  halfLength: number;
  relativeSpeed: number;
  headingDelta: number;
  effectiveMass: number;
  roadGrip: number;
  authorized: boolean;
}

export interface PitImpactAssessment {
  classification: PitContactClass;
  impulse: number;
  leverArm: number;
  yawTorque: number;
  quality: number;
  reason: string;
}

export function assessPitImpact(input: PitImpactInput): PitImpactAssessment {
  const speed = Math.max(0, input.relativeSpeed);
  const impulse = speed * Math.max(.1, input.effectiveMass);
  const leverArm = Math.abs(input.localX);
  const yawTorque = impulse * leverArm * Math.max(.35, input.roadGrip);
  const rearQuarter = input.localZ > input.halfLength * PIT_RULES.rearZoneStart
    && Math.abs(input.localX) > input.halfWidth * PIT_RULES.sideZoneStart;
  const aligned = Math.abs(input.headingDelta) <= PIT_RULES.maxHeadingDelta;
  const quality = Math.max(0, Math.min(1,
    (leverArm / input.halfWidth) * .48
    + (input.localZ / input.halfLength) * .22
    + Math.min(1, speed / 5) * .3,
  ));

  if (!input.authorized) {
    return { classification: "unsafe", impulse, leverArm, yawTorque, quality, reason: "尚未取得有效 PIT 授權" };
  }
  if (speed > 12 || impulse > 17) {
    return { classification: "excessive", impulse, leverArm, yawTorque, quality, reason: "相對速度或預估衝量過高" };
  }
  if (!rearQuarter || !aligned || speed < PIT_RULES.minClosingSpeed) {
    return { classification: "scrape", impulse, leverArm, yawTorque, quality, reason: "接觸點、角度或閉合速度不足" };
  }
  return { classification: "effective", impulse, leverArm, yawTorque, quality, reason: "後側四分之一接觸與偏航力矩成立" };
}
