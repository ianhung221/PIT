import { PIT_RULES } from "./gameConfig.ts";

export interface PitContact {
  localX: number;
  localZ: number;
  suspectHalfWidth: number;
  suspectHalfLength: number;
  closingSpeed: number;
  headingDelta: number;
  cooldown: number;
  hasCandidate: boolean;
}

export interface PitContactResult {
  valid: boolean;
  side: -1 | 0 | 1;
  reason: "valid" | "cooldown" | "active" | "contact-zone" | "heading" | "closing-speed";
}

export interface PitOutcome {
  success: boolean;
  progress: number;
  yawChange: number;
  speedDrop: number;
}

export type SuspectRecoveryMode = "driving" | "braking" | "reversing" | "realigning";

export interface SuspectRecoveryInput {
  planarSpeed: number;
  forwardSpeed: number;
  yawError: number;
  boundaryRatio: number;
  stalledFor: number;
  pitActive: boolean;
}

export const SUSPECT_RECOVERY = {
  stuckSpeed: 1.25,
  stuckDelay: 1,
  brakingTime: .35,
  reversingTime: 1.25,
  realignTimeout: 2.4,
  alignedYaw: Math.PI * 14 / 180,
} as const;

export function steeringInput(left: boolean, right: boolean): number {
  return (right ? 1 : 0) - (left ? 1 : 0);
}

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function isSuspectRecoveryNeeded(input: SuspectRecoveryInput): boolean {
  if (input.pitActive || input.stalledFor < SUSPECT_RECOVERY.stuckDelay) return false;
  const obstructed = input.boundaryRatio >= .72 || Math.abs(input.yawError) >= Math.PI * 48 / 180 || input.forwardSpeed < -.5;
  return input.planarSpeed < SUSPECT_RECOVERY.stuckSpeed && obstructed;
}

export function suspectForwardSpeedScale(yawError: number): number {
  const error = Math.abs(normalizeAngle(yawError));
  if (error >= Math.PI * 78 / 180) return 0;
  if (error <= Math.PI * 18 / 180) return 1;
  return 1 - (error - Math.PI * 18 / 180) / (Math.PI * 60 / 180) * .82;
}

export function suspectReverseEscapeYaw(lateralPosition: number): number {
  if (Math.abs(lateralPosition) < .1) return 0;
  return -Math.sign(lateralPosition) * Math.PI * 35 / 180;
}

export function nextSuspectRecoveryMode(mode: SuspectRecoveryMode, modeElapsed: number, yawError: number, forwardSpeed: number): SuspectRecoveryMode {
  if (mode === "braking" && modeElapsed >= SUSPECT_RECOVERY.brakingTime) return "reversing";
  if (mode === "reversing" && modeElapsed >= SUSPECT_RECOVERY.reversingTime) return "realigning";
  if (mode === "realigning") {
    if (Math.abs(normalizeAngle(yawError)) <= SUSPECT_RECOVERY.alignedYaw && forwardSpeed >= 1.5) return "driving";
    if (modeElapsed >= SUSPECT_RECOVERY.realignTimeout) return "braking";
  }
  return mode;
}

export function evaluatePitContact(contact: PitContact): PitContactResult {
  if (contact.cooldown > 0) return { valid: false, side: 0, reason: "cooldown" };
  if (contact.hasCandidate) return { valid: false, side: 0, reason: "active" };

  const inRearZone = contact.localZ >= contact.suspectHalfLength * PIT_RULES.rearZoneStart;
  const onSide = Math.abs(contact.localX) >= contact.suspectHalfWidth * PIT_RULES.sideZoneStart;
  if (!inRearZone || !onSide) return { valid: false, side: 0, reason: "contact-zone" };
  if (Math.abs(normalizeAngle(contact.headingDelta)) > PIT_RULES.maxHeadingDelta) {
    return { valid: false, side: 0, reason: "heading" };
  }
  if (contact.closingSpeed < PIT_RULES.minClosingSpeed || contact.closingSpeed > PIT_RULES.maxClosingSpeed) {
    return { valid: false, side: 0, reason: "closing-speed" };
  }
  return { valid: true, side: contact.localX > 0 ? 1 : -1, reason: "valid" };
}

export function evaluatePitOutcome(startYaw: number, currentYaw: number, startSpeed: number, currentSpeed: number, lateralSpeed: number): PitOutcome {
  const yawChange = Math.abs(normalizeAngle(currentYaw - startYaw));
  const speedDrop = startSpeed <= .1 ? 0 : Math.max(0, (startSpeed - currentSpeed) / startSpeed);
  const rotationProgress = Math.min(1, yawChange / PIT_RULES.requiredYawChange);
  const slowdownProgress = Math.min(1, speedDrop / PIT_RULES.requiredSpeedDrop);
  const progress = Math.round(Math.min(100, rotationProgress * 70 + slowdownProgress * 30));
  return {
    success: yawChange >= PIT_RULES.requiredYawChange && (speedDrop >= PIT_RULES.requiredSpeedDrop || Math.abs(lateralSpeed) >= 4),
    progress,
    yawChange,
    speedDrop,
  };
}
