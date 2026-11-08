import { generateRoad } from "@/lib/proceduralMap";
import { makePlayerDriving, type PlayerDriving } from "@/lib/playerDriving";
import { pristineDamage, vehicleCanPerformDriving } from "@/lib/vehicleDamage";
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
import { makeBlockade, type BlockadeState } from "@/lib/supportContainment";
import { evaluatePitRisk, missionPitRisk } from "@/lib/pitPolicy";
import type { ContactFeedback } from "@/lib/pitContact";
import { initialControl, type ControlAssessment } from "@/lib/vehicleControlAssessment";
import { makeDiagnostics, type PitDiagnostics } from "@/lib/pitDiagnostics";
import { makeContactEpisodes } from '@/lib/pitContactEpisode';
import { makeSuspectDecision, type SuspectDecision } from '@/lib/suspectDriving';
import { makeDamageEpisodes, type DamageEpisodes } from '@/lib/vehicleCollisionDamage';
import {generateNetwork} from '@/lib/networkGenerator';
import {networkIndex} from '@/lib/roadNetwork';
import {locationSegment,locateRoad} from '@/lib/roadLocation';
import {makeNetworkDriver,type NetworkDriver} from '@/lib/networkPursuit';
import {makeNetworkSupport,type NetworkSupportState} from '@/lib/networkSupport';
import {makePursuitEvents,type PursuitEvents} from '@/lib/pursuitEvents';
import {makeSuspectRecovery,type SuspectRecovery} from '@/lib/suspectRecovery';

export type V2Result = "playing" | "success" | "failed" | "paused";

export interface PitCandidate {
  startYaw: number;
  startSpeed: number;
  expires: number;
  side: -1 | 1;
  authorized: boolean;
  quality: number;
  contactTime: number;
}

export interface SupportUnitSnapshot extends CarSnapshot {
  role: PursuitRole;
  model: "patrol" | "suv";
}

export interface V2Runtime {
  suspectRecovery:SuspectRecovery;
  pursuitEvents:PursuitEvents;
  networkSupport:NetworkSupportState;
  networkDrivers:[NetworkDriver,NetworkDriver,NetworkDriver];
  damageEpisodes: DamageEpisodes;
  supportDamage: [VehicleDamage,VehicleDamage];
  decision: SuspectDecision;
  contactEpisodes: ReturnType<typeof makeContactEpisodes>;
  diagnostics: PitDiagnostics;
  driving: PlayerDriving;
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
  authorizationRequested: boolean;
  authorizationCheckedAt: number;
  authorizationExpires: number;
  contactFeedback: ContactFeedback | null;
  heldFor: number;
  disabledFor: number;
  control: ControlAssessment;
  controlCheckedAt: number;
  command: RadioCommand | null;
  tacticalCommand: RadioCommand | null;
  commandAt: number;
  radioFeedback: RadioFeedback | null;
  supportAi: [SupportAIState, SupportAIState];
  supportArrivedFor: [number, number];
  blockade: BlockadeState;
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
  const network=config.mapMode==='network'?generateNetwork(seed):undefined;
  const road:GeneratedRoad=network?{network,seed:network.seed,code:network.code,segments:network.edges.map(e=>locationSegment(network,{edge:e.id,from:e.a,to:e.b,distance:0,offset:0,deviation:0,nearJunction:false}))}:generateRoad(seed,config.scene);
  const start=(distance:number,speed:number):CarSnapshot=>{
    if(!network)return snapshot(0,0,speed);
    const index=networkIndex(network),edge=index.edges.get(network.spawn.edge)!,a=index.nodes.get(network.spawn.from)!,b=index.nodes.get(edge.a===a.id?edge.b:edge.a)!;
    const dx=(b.x-a.x)/edge.length,dz=(b.z-a.z)/edge.length;
    return {x:a.x+dx*distance-dz*2.7,z:a.z+dz*distance+dx*2.7,yaw:Math.atan2(-dx,-dz),speed,lateralSpeed:0};
  };
  return {
    suspectRecovery:makeSuspectRecovery(),
    pursuitEvents:makePursuitEvents(),
    networkSupport:makeNetworkSupport(),
    networkDrivers:[makeNetworkDriver(`${seed}-suspect`),makeNetworkDriver(`${seed}-02`),makeNetworkDriver(`${seed}-03`)],
    damageEpisodes:makeDamageEpisodes(),supportDamage:[pristineDamage(),pristineDamage()],
    decision: makeSuspectDecision(config.behaviorSeed ?? seed),
    contactEpisodes: makeContactEpisodes(),
    diagnostics: makeDiagnostics('mission', JSON.stringify(config)),
    driving: makePlayerDriving(),
    player: network?start(80,0):snapshot(0, 8),
    suspect: network?start(112,16):snapshot(.8, -24, initialSpeed),
    supports: [
      { ...(network?start(65,0):snapshot(-2.1, 18, Math.min(8, initialSpeed))), role: "secondary", model: "patrol" },
      { ...(network?start(50,0):snapshot(2.1, 29, Math.min(8, initialSpeed))), role: "tertiary", model: "suv" },
    ],
    road,
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
    authorizationRequested: false,
    authorizationCheckedAt: -1,
    authorizationExpires: 0,
    contactFeedback: null,
    heldFor: 0,
    disabledFor: 0,
    control: initialControl(),
    controlCheckedAt: -1,
    command: null,
    tacticalCommand: null,
    commandAt: 0,
    radioFeedback: null,
    supportAi: [makeSupportAI(-2.1, 18), makeSupportAI(2.1, 29)],
    supportArrivedFor: [0, 0],
    blockade: makeBlockade(),
    outcome: "playing",
    result: "playing",
    attempts: 0,
    successfulContacts: 0,
    unsafeContacts: 0,
    eventLog: ["追捕開始：玩家為主追單位"],
  };
}

export function logRuntimeEvent(runtime: V2Runtime, message: string) {
  if (runtime.eventLog[0]?.replace(/^\[\d+\.\ds\] /,'') === message) return;
  runtime.eventLog.unshift(`[${runtime.elapsed.toFixed(1)}s] ${message}`);
  runtime.eventLog.splice(60);
}

export function refreshPitAuthorization(runtime: V2Runtime, config: MissionConfig, suspect = runtime.suspect, force = false) {
  if (!runtime.authorizationRequested || (!force && runtime.elapsed - runtime.authorizationCheckedAt < .25)) return;
  const segment = runtime.road.network?locationSegment(runtime.road.network,locateRoad(runtime.road.network,suspect,runtime.networkDrivers[0].location)):runtime.road.segments[runtime.suspectRoadIndex];
  const supportUnits = runtime.supports.filter((c,i) => !c.pose?.rolloverDisabled&&vehicleCanPerformDriving(runtime.supportDamage[i])&&Math.hypot(c.x - suspect.x, c.z - suspect.z) < 150).length;
  const decision = evaluatePitRisk(missionPitRisk(config, segment, suspect, supportUnits));
  const reason = decision.reasons.join("、");
  if (runtime.authorization !== decision.authorization || runtime.authorizationReason !== reason) {
    logRuntimeEvent(runtime, `授權更新：${decision.authorization.toUpperCase()} — ${reason}`);
  }
  runtime.authorization = decision.authorization;
  runtime.authorizationReason = reason;
  runtime.authorizationCheckedAt = runtime.elapsed;
  runtime.authorizationExpires = runtime.elapsed + .5;
}

export function updateRadioFeedback(runtime: V2Runtime, feedback: Omit<RadioFeedback, "at">) {
  if (runtime.radioFeedback?.command === feedback.command && runtime.radioFeedback.phase === feedback.phase && runtime.radioFeedback.message === feedback.message) return;
  runtime.radioFeedback = { ...feedback, at: runtime.elapsed };
  logRuntimeEvent(runtime, feedback.message);
}
