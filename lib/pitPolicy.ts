import type { PitAuthorization } from "../types/game.ts";
import type { CarSnapshot, RoadSegment } from "../types/game.ts";
import { SCENES, WEATHER, type MissionConfig } from "./gameConfig.ts";

export interface PitRiskInput {
  speedKph: number; weatherGrip: number; visibility: number; roadRisk: number;
  trafficDensity: number; obstacleRisk: number; offenseSeverity: number; supportUnits: number;
  targetClass?: "car" | "suv" | "heavy" | "vulnerable";
}

export interface PitRiskDecision { authorization: PitAuthorization; score: number; reasons: string[] }

export const maxPitSpeed = (grip: number) => grip < .65 ? 65 : grip < .9 ? 90 : 105;

export function missionPitRisk(config: MissionConfig, segment: RoadSegment, suspect: CarSnapshot, supportUnits: number): PitRiskInput {
  return { speedKph: Math.hypot(suspect.speed, suspect.lateralSpeed) * 3.6,
    weatherGrip: WEATHER[config.weather].grip,
    visibility: WEATHER[config.weather].visibility * (config.time === "night" ? .85 : 1),
    roadRisk: segment.risk,
    // Scenario risk estimates; there are no simulated civilian cars yet.
    trafficDensity: segment.biome === "city" ? (segment.kind === "junction" ? .58 : .32) : segment.biome === "highway" ? .38 : .16,
    obstacleRisk: segment.biome === "city" ? (segment.kind === "junction" ? .5 : .3) : .2,
    offenseSeverity: .86, supportUnits, targetClass: "car" };
}

// Preview the next bend/junction so braking produces an opportunity before it.
export function suspectRoadCruise(segment: RoadSegment, ahead: RoadSegment, grip: number, pursuitBoost = 0) {
  const base = SCENES[segment.biome].aiSpeed * (.84 + grip * .16) + pursuitBoost;
  const caution = [segment, ahead].some(s => s.kind === "curve" || s.kind === "junction" || s.risk > .28);
  const margin = grip < .65 ? .5 : grip < .9 ? .66 : .72;
  return caution ? Math.min(base, maxPitSpeed(grip) / 3.6 * margin) : base;
}

export function evaluatePitRisk(input: PitRiskInput): PitRiskDecision {
  const reasons: string[] = [];
  let score = input.speedKph / 80;
  const speedExposure = Math.min(1, Math.max(0, input.speedKph) / 80);
  score += ((1 - input.weatherGrip) * 2.2 + (1 - input.visibility) * 1.5) * speedExposure;
  score += input.roadRisk * 1.4 + input.trafficDensity * 1.7 + input.obstacleRisk * 1.8;
  if (input.supportUnits < 1) { score += .8; reasons.push("缺少後援單位"); }
  if (input.speedKph > maxPitSpeed(input.weatherGrip)) reasons.push(`速度過高，等待降至 ${maxPitSpeed(input.weatherGrip)} km/h 以下`);
  if (input.weatherGrip < .65 && input.speedKph > maxPitSpeed(input.weatherGrip)) reasons.push("低抓地力下需降低車速");
  if (input.trafficDensity > .65) reasons.push("一般交通過於密集");
  if (input.obstacleRisk > .72) reasons.push("附近固定障礙物風險過高");
  if (input.targetClass === "vulnerable" || input.targetClass === "heavy") return { authorization: "denied", score: 10, reasons: ["目標車種不適用 PIT"] };
  if (input.offenseSeverity < .35 && score >= 3.2) return { authorization: "terminate", score, reasons: [...reasons, "追逐必要性低於公共風險"] };
  if (score >= 5.2) return { authorization: "denied", score, reasons: reasons.length ? reasons : ["綜合風險過高"] };
  if (score >= 3.2 || input.speedKph > maxPitSpeed(input.weatherGrip) || input.supportUnits < 1) return { authorization: "hold", score, reasons: reasons.length ? reasons : ["等待更安全路段"] };
  return { authorization: "authorized", score, reasons: ["當下速度與環境符合訓練規範"] };
}
