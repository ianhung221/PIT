import type { PitAuthorization } from "../types/game.ts";

export interface PitRiskInput {
  speedKph: number; weatherGrip: number; visibility: number; roadRisk: number;
  trafficDensity: number; obstacleRisk: number; offenseSeverity: number; supportUnits: number;
  targetClass?: "car" | "suv" | "heavy" | "vulnerable";
}

export interface PitRiskDecision { authorization: PitAuthorization; score: number; reasons: string[] }

export function evaluatePitRisk(input: PitRiskInput): PitRiskDecision {
  const reasons: string[] = [];
  let score = input.speedKph / 80;
  score += (1 - input.weatherGrip) * 2.2;
  score += (1 - input.visibility) * 1.5;
  score += input.roadRisk * 1.4 + input.trafficDensity * 1.7 + input.obstacleRisk * 1.8;
  if (input.supportUnits < 1) { score += .8; reasons.push("缺少後援單位"); }
  if (input.speedKph > 105) reasons.push("速度過高");
  if (input.weatherGrip < .65) reasons.push("路面抓地力過低");
  if (input.trafficDensity > .65) reasons.push("一般交通過於密集");
  if (input.obstacleRisk > .72) reasons.push("附近固定障礙物風險過高");
  if (input.targetClass === "vulnerable") return { authorization: "denied", score: 10, reasons: ["目標車種不適用 PIT"] };
  if (input.offenseSeverity < .35 && score >= 3.2) return { authorization: "terminate", score, reasons: [...reasons, "追逐必要性低於公共風險"] };
  if (score >= 5.2) return { authorization: "denied", score, reasons: reasons.length ? reasons : ["綜合風險過高"] };
  if (score >= 3.2) return { authorization: "hold", score, reasons: reasons.length ? reasons : ["等待更安全路段"] };
  return { authorization: "authorized", score, reasons: reasons.length ? reasons : ["條件符合訓練規範"] };
}
