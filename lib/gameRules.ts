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

export function steeringInput(left: boolean, right: boolean): number {
  return (right ? 1 : 0) - (left ? 1 : 0);
}

export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
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
