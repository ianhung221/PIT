"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { MissionConfig } from "@/lib/gameConfig";
import type { V2Runtime } from "@/components/game/v2Runtime";
import { advanceWeather, createWeatherParticles } from "@/lib/weatherMotion";

function createSoftParticleTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    const dx = (x + .5) / size * 2 - 1;
    const dy = (y + .5) / size * 2 - 1;
    const distance = Math.hypot(dx, dy);
    const alpha = Math.max(0, Math.min(1, (1 - distance) / .34));
    data[offset] = data[offset + 1] = data[offset + 2] = 255;
    data[offset + 3] = Math.round(alpha * alpha * (3 - 2 * alpha) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function V2Weather({ config, runtime }: { config: MissionConfig; runtime: MutableRefObject<V2Runtime> }) {
  const points = useRef<THREE.Points>(null);
  const particles = useMemo(() => createWeatherParticles(), []);
  const particleTexture = useMemo(() => createSoftParticleTexture(), []);
  const previous = useRef<{ x: number; z: number } | null>(null);
  useEffect(() => () => particleTexture.dispose(), [particleTexture]);
  useFrame((_, dt) => {
    if (!points.current || config.weather === "clear") return;
    const player = runtime.current.player;
    const last = previous.current ?? player;
    if (runtime.current.result === "playing") advanceWeather(particles, config.weather, dt, player.x - last.x, player.z - last.z);
    previous.current = { x: player.x, z: player.z };
    points.current.position.set(player.x, 0, player.z);
    points.current.geometry.attributes.position.needsUpdate = true;
  });
  if (config.weather === "clear") return null;
  const snow = config.weather === "snow";
  return <points ref={points} name="weather-particles" frustumCulled={false} userData={{ mirrorSizeScale: snow ? .18 : .25, mirrorOpacityScale: .52 }}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[particles.positions, 3]} /></bufferGeometry>
    <pointsMaterial
      name="weather-particle-material"
      alphaMap={particleTexture}
      alphaTest={.015}
      color={snow ? "#edf1ef" : "#8fb7ca"}
      size={snow ? .105 : .04}
      transparent
      opacity={snow ? .62 : .5}
      depthWrite={false}
    />
  </points>;
}
