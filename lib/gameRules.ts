export interface PitContact {
  dx: number;
  dz: number;
  relativeSpeed: number;
  grip: number;
  cooldown: number;
}

export interface PitContactResult {
  valid: boolean;
  pitGain: number;
  spinImpulse: number;
}

export function evaluatePitContact(contact: PitContact): PitContactResult {
  const sideContact = Math.abs(contact.dx) > 0.65;
  const rearQuarter = contact.dz < 0.8;
  const valid = contact.cooldown <= 0 && sideContact && rearQuarter && contact.relativeSpeed > 1.8;
  if (!valid) return { valid: false, pitGain: 0, spinImpulse: 0 };
  return {
    valid: true,
    pitGain: 38 + contact.relativeSpeed * 2.2,
    spinImpulse: (contact.dx > 0 ? -1 : 1) * (0.72 + contact.relativeSpeed * 0.025) / contact.grip,
  };
}
