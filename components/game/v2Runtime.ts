import { generateRoad } from "@/lib/proceduralMap";
import { pristineDamage } from "@/lib/vehicleDamage";
import { SCENES, type MissionConfig } from "@/lib/gameConfig";
import type {
  CarSnapshot,
  GeneratedRoad,
  MissionOutcome,
  PitAuthorization,
  PursuitRole,
  RadioCommand,
  RadioFeedback,
  VehicleDamage,
} from "@/types/game";
import type { SuspectRecoveryMode } from "@/lib/gameRules";
import { makeSupportAI, type SupportAIState } from "@/lib/supportUnitAI";

export type V2Result = "playing" | "success" | "failed" | "paused";

export interface PitCandidate {
  startYaw: number;
  startSpeed: number;
  expires: number;
  side: -1 | 1;
  authorized: boolean;
  quality: number;
}

export interface SupportUnitSnapshot extends CarSnapshot {
  role: PursuitRole;
  model: "patrol" | "suv";
}

export interface V2Runtime {
  player: CarSnapshot;
  suspect: CarSnapshot;
  supports: [SupportUnitSnapshot, SupportUnitSnapshot];
  road: GeneratedRoad;
  playerRoadIndex: number;
  suspectRoadIndex: number;
  supportRoadIndices: [number, number];
  elapsed: number;
  pit: number;
  collisionCooldown: number;
  pitCandidate: PitCandidate | null;
  pitQualified: boolean;
  containmentElapsed: number;
  suspectAi: { mode: SuspectRecoveryMode; modeElapsed: number; stalledFor: number };
  suspectDamage: VehicleDamage;
  playerDamage: VehicleDamage;
  authorization: PitAuthorization;
  authorizationReason: string;
  command: RadioCommand | null;
  tacticalCommand: RadioCommand | null;
  commandAt: number;
  radioFeedback: RadioFeedback | null;
  supportAi: [SupportAIState, SupportAIState];
  supportArrivedFor: [number, number];
  outcome: MissionOutcome;
  result: V2Result;
  attempts: number;
  successfulContacts: number;
  unsafeContacts: number;
  eventLog: string[];
}

const snapshot = (x: number, z: number, speed = 0): CarSnapshot => ({ x, z, yaw: 0, speed, lateralSpeed: 0 });

export function makeV2Runtime(config: MissionConfig): V2Runtime {
  const seed = config.seed?.trim() || "PIT-TRAINING";
  const initialSpeed = SCENES[config.scene].aiSpeed * .72;
  return {
    player: snapshot(0, 8),
    suspect: snapshot(.8, -24, initialSpeed),
    supports: [
      { ...snapshot(-2.1, 18, Math.min(8, initialSpeed)), role: "secondary", model: "patrol" },
      { ...snapshot(2.1, 29, Math.min(8, initialSpeed)), role: "tertiary", model: "suv" },
    ],
    road: generateRoad(seed, config.scene),
    playerRoadIndex: 0,
    suspectRoadIndex: 0,
    supportRoadIndices: [0, 0],
    elapsed: 0,
    pit: 0,
    collisionCooldown: 0,
    pitCandidate: null,
    pitQualified: false,
    containmentElapsed: 0,
    suspectAi: { mode: "driving", modeElapsed: 0, stalledFor: 0 },
    suspectDamage: pristineDamage(),
    playerDamage: pristineDamage(),
    authorization: "unknown",
    authorizationReason: "按住 Q，選擇「請求 PIT 授權」",
    command: null,
    tacticalCommand: null,
    commandAt: 0,
    radioFeedback: null,
    supportAi: [makeSupportAI(-2.1, 18), makeSupportAI(2.1, 29)],
    supportArrivedFor: [0, 0],
    outcome: "playing",
    result: "playing",
    attempts: 0,
    successfulContacts: 0,
    unsafeContacts: 0,
    eventLog: ["追捕開始：玩家為主追單位"],
  };
}

export function logRuntimeEvent(runtime: V2Runtime, message: string) {
  if (runtime.eventLog[0] === message) return;
  runtime.eventLog.unshift(message);
  runtime.eventLog.splice(60);
}

export function updateRadioFeedback(runtime: V2Runtime, feedback: Omit<RadioFeedback, "at">) {
  if (runtime.radioFeedback?.command === feedback.command && runtime.radioFeedback.phase === feedback.phase && runtime.radioFeedback.message === feedback.message) return;
  runtime.radioFeedback = { ...feedback, at: runtime.elapsed };
  logRuntimeEvent(runtime, feedback.message);
}
