import type { CarSnapshot, GeneratedRoad, RadioCommand, PursuitRole } from "../types/game.ts";
import { normalizeAngle } from "./gameRules.ts";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export interface SupportAIState {
  mode: "driving" | "braking" | "reversing" | "realigning";
  modeElapsed: number;
  stalledFor: number;
  lastX: number;
  lastZ: number;
  reverseYaw: number;
}
export const makeSupportAI = (x: number, z: number): SupportAIState => ({ mode: "driving", modeElapsed: 0, stalledFor: 0, lastX: x, lastZ: z, reverseYaw: 0 });

/** Distance along the generated centreline, independent of the vehicle's heading. */
export function roadCoordinate(road: GeneratedRoad, car: Pick<CarSnapshot, "x" | "z">, index: number) {
  const s = road.segments[index];
  return index * 72 + 36 - (car.x - s.x) * Math.sin(s.yaw) - (car.z - s.z) * Math.cos(s.yaw);
}
export function roadPoint(road: GeneratedRoad, distance: number, side = 0) {
  const bounded = clamp(distance, 0, road.segments.length * 72 - .01);
  const index = Math.floor(bounded / 72);
  const segment = road.segments[index];
  const offset = bounded - index * 72 - 36;
  const width = (segment.startWidth ?? segment.width) + ((segment.endWidth ?? segment.width) - (segment.startWidth ?? segment.width)) * (offset + 36) / 72;
  const lateral = clamp(side, -width / 2 + 2, width / 2 - 2);
  return { x: segment.x - Math.sin(segment.yaw) * offset + Math.cos(segment.yaw) * lateral,
    z: segment.z - Math.cos(segment.yaw) * offset - Math.sin(segment.yaw) * lateral, yaw: segment.yaw, index };
}

export function supportSlot(input: { road: GeneratedRoad; player: CarSnapshot; suspect: CarSnapshot; playerIndex: number; suspectIndex: number; unit: number; role: PursuitRole; command: RadioCommand | null }) {
  const { road, player, suspect, unit, role, command } = input;
  const p = roadCoordinate(road, player, input.playerIndex);
  const s = roadCoordinate(road, suspect, input.suspectIndex);
  // Once the player is far behind, supports continue the pursuit within their own limits.
  const leader = s - p > 65 ? s - 24 : p;
  let distance = leader - (unit === 0 ? 13 : 26);
  let side = unit === 0 ? 2.5 : -2.5;
  let speed = s - p > 65 ? Math.max(0, suspect.speed) : Math.max(0, player.speed);
  if (role === "primary") { distance = s - 13; side = 0; speed = Math.max(0, suspect.speed); }
  else if (role === "containment-front" || role === "containment-rear") {
    const front = role === "containment-front";
    const x = suspect.x - Math.sin(suspect.yaw) * (front ? 6.2 : -5.4);
    const z = suspect.z - Math.cos(suspect.yaw) * (front ? 6.2 : -5.4);
    distance = roadCoordinate(road, { x, z }, input.suspectIndex);
    const segment = road.segments[input.suspectIndex];
    side = (x - segment.x) * Math.cos(segment.yaw) - (z - segment.z) * Math.sin(segment.yaw);
    speed = 0;
  } else if (command === "prepare-pit") { distance = s - (unit === 0 ? 24 : 38); speed = Math.max(0, suspect.speed); }
  else if (command === "move-up" && unit === 0) { distance = Math.min(s - 12, Math.max(p + 12, s - 35)); speed = Math.max(0, suspect.speed); }
  return { ...roadPoint(road, distance, side), distance, side, speed, role };
}

export function stepSupportAI(ai: SupportAIState, input: { car: CarSnapshot; road: GeneratedRoad; index: number; slot: ReturnType<typeof supportSlot>; dt: number; grip: number; maxSpeed: number; neighbors: CarSnapshot[] }) {
  const { car, road, index, slot, dt, grip, maxSpeed, neighbors } = input;
  const segment = road.segments[index];
  const progress = roadCoordinate(road, car, index);
  const gap = slot.distance - progress;
  const localX = (car.x - segment.x) * Math.cos(segment.yaw) - (car.z - segment.z) * Math.sin(segment.yaw);
  const width = Math.min(segment.startWidth ?? segment.width, segment.endWidth ?? segment.width);
  const edge = Math.abs(localX) > width / 2 - 2;
  const roadError = normalizeAngle(segment.yaw - car.yaw);
  const planar = Math.hypot(car.speed, car.lateralSpeed);
  const moved = Math.hypot(car.x - ai.lastX, car.z - ai.lastZ);
  const wantsMove = gap > 6 || slot.speed > 3;
  const blocked = wantsMove && planar < 1.25 && moved < .035 && (edge || Math.abs(roadError) > .65);
  ai.stalledFor = blocked ? ai.stalledFor + dt : Math.max(0, ai.stalledFor - dt * 2);
  ai.lastX = car.x; ai.lastZ = car.z;
  ai.modeElapsed += dt;
  const previousMode = ai.mode;
  if (ai.mode === "driving" && ai.stalledFor > 1.1) {
    ai.mode = "braking";
    ai.reverseYaw = segment.yaw - Math.sign(localX || 1) * .65;
  } else if (ai.mode === "braking" && ai.modeElapsed > .4 && planar < 1.5) ai.mode = "reversing";
  else if (ai.mode === "reversing" && ai.modeElapsed > 1.6) ai.mode = "realigning";
  else if (ai.mode === "realigning" && Math.abs(roadError) < .3 && car.speed > 1.2) ai.mode = "driving";
  else if (ai.mode === "realigning" && ai.modeElapsed > 3.5) ai.mode = "braking";
  if (previousMode !== ai.mode) { ai.modeElapsed = 0; ai.stalledFor = 0; }

  const lookAhead = clamp(8 + Math.max(0, car.speed) * .75, 8, 34);
  let approachSide = slot.role === "containment-front" && gap > 7 ? 3.3 : slot.side;
  for (const other of neighbors) {
    const otherProgress = roadCoordinate(road, other, index);
    const ahead = otherProgress - progress;
    const lateral = (other.x - segment.x) * Math.cos(segment.yaw) - (other.z - segment.z) * Math.sin(segment.yaw);
    if (ahead > -5 && ahead < 60 && slot.distance > otherProgress + 5 && other.speed < Math.max(5, slot.speed - 4)) {
      // A stopped player/target must not trap a support whose assigned slot is beyond it.
      approachSide = lateral > .5 ? -3.3 : lateral < -.5 ? 3.3 : Math.sign(Math.abs(localX) > .75 ? localX : slot.side || 1) * 3.3;
    }
  }
  const target = roadPoint(road, Math.min(slot.distance, progress + lookAhead), approachSide);
  const distance = Math.hypot(slot.x - car.x, slot.z - car.z);
  let desiredYaw = Math.atan2(-(target.x - car.x), -(target.z - car.z));
  // A reached/behind slot means brake in the road direction, never turn around.
  if (gap < 2 && distance < 8 || gap < -3) desiredYaw = segment.yaw;
  let speed = clamp(slot.speed + gap * .55, 0, maxSpeed);
  if (slot.speed < .5) speed = Math.min(speed, Math.sqrt(Math.max(0, distance - 1.8) * 6 * grip));
  const turnError = Math.abs(normalizeAngle(desiredYaw - car.yaw));
  speed *= clamp(1 - turnError / 1.2, 0, 1);
  if (edge) speed = Math.min(speed, 8 * grip);
  // Follow/stop behind a nearby vehicle; this also prevents pushing a parked player.
  let obstructed = false;
  for (const other of neighbors) {
    const dx = other.x - car.x, dz = other.z - car.z;
    const ahead = -dx * Math.sin(car.yaw) - dz * Math.cos(car.yaw);
    const lateral = Math.abs(dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw));
    if (ahead > 0 && lateral < 2.5 && ahead < 8 + Math.max(0, car.speed) * .7) {
      const otherForward = Math.max(0, other.speed * Math.cos(other.yaw - car.yaw));
      speed = Math.min(speed, Math.max(0, otherForward + (ahead - 8) * .65));
      obstructed = true;
    }
  }
  if (obstructed && !edge && Math.abs(roadError) < .65 && ai.mode === "driving") ai.stalledFor = 0;
  if (ai.mode === "braking") speed = 0;
  if (ai.mode === "reversing") {
    speed = -4 * grip;
    desiredYaw = ai.reverseYaw;
    for (const other of neighbors) {
      const dx = other.x - car.x, dz = other.z - car.z;
      const ahead = -dx * Math.sin(car.yaw) - dz * Math.cos(car.yaw);
      if (ahead < 0 && ahead > -7 && Math.abs(dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw)) < 2.5) speed = 0;
    }
  }
  if (ai.mode === "realigning") { desiredYaw = segment.yaw; speed = Math.abs(roadError) < .8 ? 5 * grip : 0; }
  const arrived = distance < 5 && Math.abs(car.speed - slot.speed) < 3 && Math.abs(roadError) < .45 && ai.mode === "driving";
  return { speed, yawError: normalizeAngle(desiredYaw - car.yaw), arrived, distance, gap, modeChanged: previousMode !== ai.mode };
}
