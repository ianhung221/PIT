import type { CarSnapshot, GeneratedRoad, RadioFeedback } from "../types/game.ts";
import { SUSPECT, VEHICLES } from "./gameConfig.ts";
import { normalizeAngle } from "./gameRules.ts";
import { closestRoadSegment } from "./proceduralMap.ts";

type Point = { x: number; z: number };
export interface BlockadeState {
  phase: "waiting" | "approaching" | "holding" | "missed";
  elapsed: number;
  slowFor: number;
  fastFor: number;
  reason: string;
  anchor: (Point & { yaw: number; index: number; side: number; front: number; rear: number }) | null;
  stages: [number, number];
  settled: [number, number];
  blockedFor: [number, number];
}
export const makeBlockade = (): BlockadeState => ({ phase: "waiting", elapsed: 0, slowFor: 0, fastFor: 0, reason: "", anchor: null, stages: [0, 0], settled: [0, 0], blockedFor: [0, 0] });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const planar = (car: CarSnapshot) => Math.hypot(car.speed, car.lateralSpeed);
export function blockadeLocal(origin: Point & { yaw: number }, point: Point) {
  const dx = point.x - origin.x, dz = point.z - origin.z;
  return { side: dx * Math.cos(origin.yaw) - dz * Math.sin(origin.yaw), forward: -dx * Math.sin(origin.yaw) - dz * Math.cos(origin.yaw) };
}
function pointAt(origin: Point & { yaw: number }, side: number, forward: number): Point {
  return { x: origin.x + Math.cos(origin.yaw) * side - Math.sin(origin.yaw) * forward, z: origin.z - Math.sin(origin.yaw) * side - Math.cos(origin.yaw) * forward };
}
function extent(yaw: number, length: number, width: number) {
  return { side: Math.abs(Math.sin(yaw)) * length / 2 + Math.abs(Math.cos(yaw)) * width / 2,
    forward: Math.abs(Math.cos(yaw)) * length / 2 + Math.abs(Math.sin(yaw)) * width / 2 };
}
function inRoad(road: GeneratedRoad, point: Point, yaw: number, index: number, unit: number) {
  const i = closestRoadSegment(road, point.x, point.z, index), segment = road.segments[i];
  const dimensions = unit === 0 ? VEHICLES.patrol : VEHICLES.suv;
  const half = extent(yaw - segment.yaw, dimensions.length, dimensions.width).side;
  const local = blockadeLocal(segment, point);
  return Math.abs(local.side) + half + .35 < Math.min(segment.startWidth ?? segment.width, segment.endWidth ?? segment.width) / 2;
}

/** Select once per attempt. A rotating suspect cannot flip the chosen passing side. */
export function planBlockade(road: GeneratedRoad, index: number, suspect: CarSnapshot, supports: CarSnapshot[], player: CarSnapshot) {
  const yaw = road.segments[index].yaw;
  const targetExtent = extent(suspect.yaw - yaw, SUSPECT.length, SUSPECT.width);
  const origin = { x: suspect.x, z: suspect.z, yaw, index };
  const front = targetExtent.forward + VEHICLES.patrol.length / 2 + .8;
  const rear = targetExtent.forward + VEHICLES.suv.length / 2 + .8;
  const passing = targetExtent.side + VEHICLES.patrol.width / 2 + 1.1;
  const currentSide = blockadeLocal(origin, supports[0]).side;
  const sides = [passing, -passing].sort((a, b) => Math.abs(a - currentSide) - Math.abs(b - currentSide));
  for (const side of sides) {
    let clear = true;
    for (let forward = -10; forward <= 14; forward += 2) {
      const p = pointAt(origin, side, forward);
      if (!inRoad(road, p, yaw, index, 0)) { clear = false; break; }
      const relative = blockadeLocal({ ...p, yaw }, player);
      if (Math.abs(relative.side) < 2.7 && Math.abs(relative.forward) < 5) { clear = false; break; }
    }
    if (clear && inRoad(road, pointAt(origin, 0, front), yaw, index, 0) && inRoad(road, pointAt(origin, 0, -rear), yaw, index, 1)) {
      return { ...origin, side, front, rear };
    }
  }
  return null;
}

export function missBlockade(state: BlockadeState, reason: string) {
  state.phase = "missed"; state.elapsed = 0; state.slowFor = 0; state.fastFor = 0;
  state.anchor = null; state.settled = [0, 0]; state.reason = reason;
}
export function stepBlockade(state: BlockadeState, input: { road: GeneratedRoad; index: number; suspect: CarSnapshot; supports: CarSnapshot[]; player: CarSnapshot; dt: number }) {
  const { suspect, supports, dt } = input;
  state.elapsed += dt;
  const speed = planar(suspect);
  state.slowFor = speed < 4.2 ? state.slowFor + dt : 0;
  state.fastFor = speed > 7 ? state.fastFor + dt : 0;
  if (state.phase === "missed") {
    if (state.elapsed <= 3) return;
    if (speed >= 4.2) { Object.assign(state, makeBlockade()); return; }
  }
  if (state.phase === "waiting" || state.phase === "missed") {
    if (state.slowFor < .35) return;
    if (supports.some(car => Math.hypot(car.x - suspect.x, car.z - suspect.z) > 65)) {
      missBlockade(state, "後援距離過遠"); return;
    }
    const anchor = planBlockade(input.road, input.index, suspect, supports, input.player);
    if (!anchor) { missBlockade(state, "沒有安全進場通道"); return; }
    state.anchor = anchor; state.phase = "approaching"; state.elapsed = 0;
    const frontPosition = blockadeLocal(anchor, supports[0]);
    state.stages = [frontPosition.forward > anchor.front + 2 ? 2 : frontPosition.forward > -6 && Math.abs(frontPosition.side - anchor.side) < 1 ? 1 : 0, 0];
    state.settled = [0, 0]; state.blockedFor = [0, 0];
    return;
  }
  if (!state.anchor) return;
  if (state.fastFor > .65 || Math.hypot(suspect.x - state.anchor.x, suspect.z - state.anchor.z) > 7) {
    missBlockade(state, "嫌犯已離開封鎖位置"); return;
  }
  if (state.blockedFor.some(t => t > 5) || (state.phase === "approaching" && state.elapsed > 35)) {
    missBlockade(state, "進場受阻或未能及時就位"); return;
  }
  const held = state.settled.every(t => t > .8);
  if (held && state.phase !== "holding") { state.phase = "holding"; state.elapsed = 0; }
  if (!held && state.phase === "holding" && state.elapsed > .6) { state.phase = "approaching"; state.elapsed = 0; }
}

/** Low-speed local manoeuvre; ordinary road pursuit and wall recovery remain separate. */
export function blockadeControl(state: BlockadeState, unit: 0 | 1, car: CarSnapshot, suspect: CarSnapshot, neighbors: CarSnapshot[], road: GeneratedRoad, dt: number, grip: number) {
  const a = state.anchor;
  if (!a || (state.phase !== "approaching" && state.phase !== "holding")) return null;
  const local = blockadeLocal(a, car);
  const finalForward = unit === 0 ? a.front : -a.rear;
  const final = pointAt(a, 0, finalForward);
  const stage = state.stages[unit];
  const frontClear = state.stages[0] >= 2;
  let target = unit === 0
    ? pointAt(a, stage === 0 || stage === 1 ? a.side : 0, stage === 0 ? -8 : stage === 1 ? a.front + 4 : stage === 2 ? a.front + 9 : a.front)
    : pointAt(a, 0, frontClear ? -a.rear : -a.rear - 6);
  let distance = Math.hypot(target.x - car.x, target.z - car.z);
  if (unit === 0 && stage < 3 && distance < 1.2) {
    state.stages[0]++; target = pointAt(a, state.stages[0] === 1 ? a.side : 0, state.stages[0] === 1 ? a.front + 4 : state.stages[0] === 2 ? a.front + 9 : a.front);
    distance = Math.hypot(target.x - car.x, target.z - car.z);
  }
  const targetLocal = blockadeLocal(a, target);
  const reverse = (unit === 1 || state.stages[0] === 3 || state.stages[0] === 0)
    && local.forward > targetLocal.forward + .25;
  const targetYaw = distance < .65 ? a.yaw : Math.atan2(-(target.x - car.x), -(target.z - car.z)) + (reverse ? Math.PI : 0);
  const yawError = normalizeAngle(targetYaw - car.yaw);
  let speed = Math.min(reverse ? 2.8 : 6, distance * 1.1, Math.sqrt(Math.max(0, distance - .25) * 5 * grip)) * clamp(1 - Math.abs(yawError) / .85, 0, 1) * (reverse ? -1 : 1);
  let blocked = false;
  // Project both car footprints along our actual motion, including a swept stopping margin.
  for (const other of neighbors) {
    const relative = blockadeLocal(car, other);
    const otherExtent = extent(other.yaw - car.yaw, 4.6, 2.15);
    const ahead = relative.forward * (reverse ? -1 : 1);
    const clearance = ahead - 2.3 - otherExtent.forward;
    if (ahead > 0 && Math.abs(relative.side) < 1.075 + otherExtent.side + .25) {
      const limit = Math.sqrt(Math.max(0, clearance - .3) * 8 * grip);
      speed = Math.sign(speed) * Math.min(Math.abs(speed), limit);
      if (clearance < .5) blocked = true;
    }
  }
  const projected = { x: car.x - Math.sin(car.yaw) * speed * .5, z: car.z - Math.cos(car.yaw) * speed * .5 };
  if (!inRoad(road, projected, car.yaw, a.index, unit)) { speed = 0; blocked = true; }
  state.blockedFor[unit] = blocked && distance > 1.2 ? state.blockedFor[unit] + dt : 0;
  const suspectLocal = blockadeLocal(a, suspect);
  const dimensions = unit === 0 ? VEHICLES.patrol : VEHICLES.suv;
  const minimumGap = extent(suspect.yaw - a.yaw, SUSPECT.length, SUSPECT.width).forward
    + extent(car.yaw - a.yaw, dimensions.length, dimensions.width).forward + .15;
  const correctlyPlaced = unit === 0 ? local.forward - suspectLocal.forward > minimumGap : suspectLocal.forward - local.forward > minimumGap;
  const arrived = (unit === 1 ? frontClear : state.stages[0] === 3) && correctlyPlaced
    && Math.hypot(final.x - car.x, final.z - car.z) < 1.05 && Math.abs(local.side - suspectLocal.side) < .8
    && Math.abs(normalizeAngle(a.yaw - car.yaw)) < .25 && planar(car) < .65 && planar(suspect) < 1.2;
  state.settled[unit] = arrived ? state.settled[unit] + dt : 0;
  if (arrived) speed = 0;
  return { speed, yawError: arrived ? normalizeAngle(a.yaw - car.yaw) : yawError, arrived, modeChanged: false };
}

export function blockadeFeedback(state: BlockadeState): Pick<RadioFeedback, "phase" | "message"> {
  if (state.phase === "waiting") return { phase: "executing", message: "已待命，等待嫌犯減速；不需再次下令" };
  if (state.phase === "missed") return { phase: "unable", message: `錯過封鎖時機：${state.reason}；繼續追蹤並保持待命` };
  if (state.phase === "holding") return { phase: "completed", message: "前後單位已就位，持續守位；留意嫌犯再次逃逸" };
  return { phase: "executing", message: state.stages[0] < 2 ? "02 沿安全側進場，03 保留後方空間" : "02 前封停車中，03 正在後方就位" };
}
