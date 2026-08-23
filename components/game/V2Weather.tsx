"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { MissionConfig } from "@/lib/gameConfig";
import type { V2Runtime } from "@/components/game/v2Runtime";

export function V2Weather({ config, runtime }: { config: MissionConfig; runtime: MutableRefObject<V2Runtime> }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const data = new Float32Array(680 * 3);
    for (let i = 0; i < data.length; i += 3) {
      const seed = i / 3;
      data[i] = (((seed * 47) % 101) / 100 - .5) * 42;
      data[i + 1] = ((seed * 31) % 97) / 96 * 18;
      data[i + 2] = (((seed * 71) % 103) / 102 - .5) * 55;
    }
    return data;
  }, []);
  useFrame((_, dt) => {
    if (!points.current || config.weather === "clear") return;
    points.current.position.x = runtime.current.player.x;
    points.current.position.z = runtime.current.player.z - 12;
    const values = points.current.geometry.attributes.position.array as Float32Array;
    for (let index = 1; index < values.length; index += 3) {
      values[index] -= dt * (config.weather === "rain" ? 26 : 4);
      if (values[index] < 0) values[index] = 18;
    }
    points.current.geometry.attributes.position.needsUpdate = true;
  });
  if (config.weather === "clear") return null;
  return <points ref={points}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <pointsMaterial color={config.weather === "snow" ? "white" : "#9bc6df"} size={config.weather === "snow" ? .12 : .045} transparent opacity={.72} />
  </points>;
}
