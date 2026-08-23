"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { CameraMode } from "@/lib/gameConfig";
import type { CarSnapshot } from "@/types/game";

export function CockpitView({ runtime, mode, steering }: {
  runtime: MutableRefObject<{ player: CarSnapshot }>;
  mode: CameraMode;
  steering: MutableRefObject<Set<string>>;
}) {
  const group = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!group.current) return;
    const car = runtime.current.player;
    group.current.visible = mode === "driver";
    group.current.position.set(car.x, 0, car.z);
    group.current.rotation.y = car.yaw;
    if (wheel.current) {
      const left = steering.current.has("arrowleft") || steering.current.has("a");
      const right = steering.current.has("arrowright") || steering.current.has("d");
      wheel.current.rotation.z = ((left ? 1 : 0) - (right ? 1 : 0)) * .55;
    }
  });
  return <group ref={group} visible={false}>
    <mesh position={[0, .38, -.78]} castShadow><boxGeometry args={[1.7, .26, .5]} /><meshStandardMaterial color="#11181c" roughness={.75} /></mesh>
    <mesh position={[0, .67, -.93]} rotation={[-.18, 0, 0]}><boxGeometry args={[1.65, .08, .12]} /><meshStandardMaterial color="#202a2e" /></mesh>
    <mesh position={[-.78, .82, -.52]} rotation={[0, 0, -.14]}><boxGeometry args={[.1, .95, .12]} /><meshStandardMaterial color="#151c20" /></mesh>
    <mesh position={[.78, .82, -.52]} rotation={[0, 0, .14]}><boxGeometry args={[.1, .95, .12]} /><meshStandardMaterial color="#151c20" /></mesh>
    <mesh ref={wheel} position={[-.38, .57, -.55]} rotation={[Math.PI / 2.35, 0, 0]}><torusGeometry args={[.22, .028, 8, 24]} /><meshStandardMaterial color="#080b0d" roughness={.9} /></mesh>
    <mesh position={[0, .5, -.49]}><boxGeometry args={[.38, .13, .04]} /><meshStandardMaterial color="#17262c" emissive="#214b59" emissiveIntensity={.55} /></mesh>
  </group>;
}
