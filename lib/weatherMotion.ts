import type { WeatherId } from "./gameConfig.ts";

export function createWeatherParticles(count = 680) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (((i * 47) % 101) / 101 - .5) * 60;
    positions[i * 3 + 1] = ((i * 31) % 97) / 97 * 18;
    positions[i * 3 + 2] = (((i * 71) % 103) / 103 - .5) * 80;
    speeds[i] = .75 + ((i * 37) % 107) / 107 * .5;
  }
  return { positions, speeds };
}

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** Local volume follows the car; subtracting its actual movement preserves world
 * motion once (also under collisions/reverse). Modulo keeps overshoot and phase. */
export function advanceWeather(particles: ReturnType<typeof createWeatherParticles>, weather: WeatherId, delta: number, travelX: number, travelZ: number) {
  if (weather === "clear") return;
  const dt = Math.max(0, Math.min(delta, .1));
  for (let i = 0; i < particles.speeds.length; i++) {
    const offset = i * 3;
    particles.positions[offset] = wrap(particles.positions[offset] - travelX + 30, 60) - 30;
    particles.positions[offset + 1] = wrap(particles.positions[offset + 1] - dt * (weather === "rain" ? 26 : 4) * particles.speeds[i], 18);
    particles.positions[offset + 2] = wrap(particles.positions[offset + 2] - travelZ + 40, 80) - 40;
  }
}
