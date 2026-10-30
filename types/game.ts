import type { CameraMode, MissionConfig, SceneId } from "../lib/gameConfig.ts";

export type MissionOutcome = "playing" | "contained" | "disabled" | "stopped-mobile" | "recovered" | "escaped-containment" | "unsafe-pit" | "failed" | "paused";
export type PursuitRole = "primary" | "secondary" | "tertiary" | "containment-front" | "containment-rear" | "unavailable";
export type RadioCommand = "request-pit" | "prepare-pit" | "move-up" | "block-front" | "take-primary" | "terminate";
export type PitAuthorization = "unknown" | "authorized" | "hold" | "denied" | "terminate";
export type RadioPhase = "received" | "executing" | "completed" | "unable";
export interface RadioFeedback { command: RadioCommand; phase: RadioPhase; message: string; at: number }

export interface VehicleVector3 { x: number; y: number; z: number }
export interface VehicleQuaternion extends VehicleVector3 { w: number }
export interface VehiclePose {
  y: number;
  quaternion: VehicleQuaternion;
  upDot: number;
  tilt: number;
  headingValid: boolean;
  groundedWheels: number;
  angularSpeed: number;
  rolloverDisabled: boolean;
  wheelSteering?: number;
  suspensionLengths?: number[];
}
export interface CarSnapshot { x: number; z: number; yaw: number; speed: number; lateralSpeed: number; pose?: VehiclePose }

export interface VehicleDamage {
  engine: number; cooling: number; steering: number;
  frontLeftGrip: number; frontRightGrip: number; rearLeftGrip: number; rearRightGrip: number;
  alignment: number; body: number;
}

export interface RoadSegment {
  id: string; index: number; biome: SceneId; x: number; z: number; yaw: number;
  length: number; width: number; turn: number; risk: number;
  startWidth?: number; endWidth?: number;
  kind: "straight" | "curve" | "junction" | "transition";
}

export interface GeneratedRoad { seed: string; code: string; segments: RoadSegment[]; geometryVersion?: number }
export interface V2MissionConfig extends MissionConfig { seed?: string; camera?: CameraMode }
