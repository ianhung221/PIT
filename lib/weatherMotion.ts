import type { WeatherId } from "./gameConfig.ts";

const WIDTH = 60;
const HEIGHT = 18;
const DEPTH = 80;

function hash01(index: number, channel: number, cycle = 0) {
  let value = (
    Math.imul(index + 1, 0x9e3779b1)
    ^ Math.imul(channel + 1, 0x85ebca6b)
    ^ Math.imul(cycle + 1, 0xc2b2ae35)
  ) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

export function createWeatherParticles(count = 680) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const swayRates = new Float32Array(count);
  const swayStrengths = new Float32Array(count);
  const respawns = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (hash01(i, 0) - .5) * WIDTH;
    positions[i * 3 + 1] = hash01(i, 1) * HEIGHT;
    positions[i * 3 + 2] = (hash01(i, 2) - .5) * DEPTH;
    speeds[i] = .75 + hash01(i, 3) * .5;
    phases[i] = hash01(i, 4) * Math.PI * 2;
    swayRates[i] = .55 + hash01(i, 5) * 1.05;
    swayStrengths[i] = .08 + hash01(i, 6) * .18;
  }
  return { positions, speeds, phases, swayRates, swayStrengths, respawns };
}

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** Local volume follows the car; subtracting its actual movement preserves world
 * motion once (also under collisions/reverse). Modulo keeps overshoot and phase. */
export function advanceWeather(particles: ReturnType<typeof createWeatherParticles>, weather: WeatherId, delta: number, travelX: number, travelZ: number) {
  if (weather === "clear") return;
  const dt = Math.max(0, Math.min(delta, .1));
  for (let i = 0; i < particles.speeds.length; i++) {
    const offset = i * 3;
    particles.phases[i] = wrap(particles.phases[i] + particles.swayRates[i] * dt, Math.PI * 2);
    const snowSway = weather === "snow" ? particles.swayStrengths[i] * dt : 0;
    particles.positions[offset] = wrap(
      particles.positions[offset] - travelX + Math.cos(particles.phases[i]) * snowSway + WIDTH / 2,
      WIDTH,
    ) - WIDTH / 2;
    particles.positions[offset + 2] = wrap(
      particles.positions[offset + 2] - travelZ + Math.sin(particles.phases[i] * 1.31) * snowSway + DEPTH / 2,
      DEPTH,
    ) - DEPTH / 2;
    const nextY = particles.positions[offset + 1] - dt * (weather === "rain" ? 26 : 4) * particles.speeds[i];
    if (nextY >= 0) {
      particles.positions[offset + 1] = nextY;
      continue;
    }
    const cycle = ++particles.respawns[i];
    particles.positions[offset] = (hash01(i, 7, cycle) - .5) * WIDTH;
    particles.positions[offset + 1] = HEIGHT - wrap(-nextY, HEIGHT);
    particles.positions[offset + 2] = (hash01(i, 8, cycle) - .5) * DEPTH;
    particles.phases[i] = hash01(i, 9, cycle) * Math.PI * 2;
  }
}
