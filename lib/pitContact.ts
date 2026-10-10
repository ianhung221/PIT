import type { CarSnapshot } from "../types/game.ts";
import { normalizeAngle, evaluatePitOutcome } from "./gameRules.ts";

export const V2_PIT = { rearStart: .5, maxAngle: Math.PI * 35 / 180, minNormalSpeed: .35, maxClosingSpeed: 12, minContactTime: 1 / 60, window: 2.5 } as const;
export interface PhysicalContact {
  localX: number; localZ: number; playerLocalX: number; playerLocalZ: number;
  normalSide: number; closingSpeed: number; normalSpeed: number; headingDelta: number;
  halfWidth: number; halfLength: number; playerHalfLength: number; authorized: boolean;
}
export type ContactClassification = "scrape" | "effective" | "excessive" | "unsafe";
export interface ContactFeedback { classification: ContactClassification; message: string; at: number }

export function localPoint(car: Pick<CarSnapshot, "x" | "z" | "yaw">, point: {x: number; z: number}) {
  const dx = point.x - car.x, dz = point.z - car.z;
  return { x: dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw), z: dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw) };
}
export function classifyPhysicalContact(c: PhysicalContact): {classification: ContactClassification; reason: string} {
  if (![c.localX,c.localZ,c.playerLocalZ,c.normalSide,c.closingSpeed,c.normalSpeed].every(Number.isFinite)) return { classification: "scrape", reason: "接觸資料不足" };
  if (c.closingSpeed > V2_PIT.maxClosingSpeed || c.normalSpeed > 8) return { classification: "excessive", reason: "過度撞擊：相對速度或側向撞擊過高" };
  const zone = c.localZ >= c.halfLength * V2_PIT.rearStart && c.localZ <= c.halfLength + .08
    && Math.abs(c.localX) >= c.halfWidth * .65 && Math.abs(c.localX) <= c.halfWidth + .08
    && c.playerLocalZ <= -c.playerHalfLength * .45 && c.playerLocalZ >= -c.playerHalfLength - .08
    && Math.abs(c.normalSide) > .6;
  if (!zone || Math.abs(normalizeAngle(c.headingDelta)) > V2_PIT.maxAngle || c.normalSpeed < V2_PIT.minNormalSpeed) {
    return { classification: "scrape", reason: "一般碰撞：接觸位置、方向、角度或閉合速度不符" };
  }
  if (!c.authorized) return { classification: "unsafe", reason: "未授權 PIT 接觸：當下授權無效" };
  return { classification: "effective", reason: "後側四分之一接觸成立，評估實際失控" };
}

export function physicalPitOutcome(startYaw: number, yaw: number, startPlanarSpeed: number, planarSpeed: number, lateralSpeed: number, contactTime: number) {
  const result = evaluatePitOutcome(startYaw, yaw, startPlanarSpeed, planarSpeed, lateralSpeed);
  // Forward speed alone drops when a car rotates; use actual planar speed.
  const success = result.success && contactTime >= V2_PIT.minContactTime && startPlanarSpeed > 4;
  return { ...result, progress: success ? 100 : Math.min(99, result.progress), success };
}

export function pitMissionResolution(qualified: boolean, driveable: boolean, planarSpeed: number, elapsed: number, heldFor: number): "disabled" | "contained" | null {
  if (!qualified) return null;
  if (!driveable && planarSpeed < 1.2 && elapsed > 1.2) return "disabled";
  if (heldFor > .8) return "contained";
  return null;
}
