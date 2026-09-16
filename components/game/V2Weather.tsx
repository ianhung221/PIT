"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { MissionConfig } from "@/lib/gameConfig";
import type { V2Runtime } from "@/components/game/v2Runtime";
import { advanceWeather, createWeatherParticles } from "@/lib/weatherMotion";

export function V2Weather({ config, runtime }: { config: MissionConfig; runtime: MutableRefObject<V2Runtime> }) {
  const points = useRef<THREE.Points>(null);
  const particles = useMemo(() => createWeatherParticles(), []);
  const previous = useRef<{ x: number; z: number } | null>(null);
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
  return <points ref={points} name="weather-particles" frustumCulled={false}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[particles.positions, 3]} /></bufferGeometry>
    <pointsMaterial color={config.weather === "snow" ? "white" : "#9bc6df"} size={config.weather === "snow" ? .12 : .045} transparent opacity={.72} />
  </points>;
}
