"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { CameraMode } from "@/lib/gameConfig";

export function CockpitView({ mode, steering }: {
  mode: CameraMode;
  steering: MutableRefObject<Set<string>>;
}) {
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!group.current) return;
    group.current.visible = mode === "driver" && !steering.current.has("r");
    group.current.position.copy(camera.position);
    group.current.quaternion.copy(camera.quaternion);
    if (wheel.current) {
      const left = steering.current.has("arrowleft") || steering.current.has("a");
      const right = steering.current.has("arrowright") || steering.current.has("d");
      wheel.current.rotation.z = ((left ? 1 : 0) - (right ? 1 : 0)) * .55;
    }
  });
  return <group ref={group} visible={false} name="cockpit-view">
    <mesh position={[.38, -.48, -.72]} castShadow><boxGeometry args={[1.7, .26, .5]} /><meshStandardMaterial color="#11181c" roughness={.75} /></mesh>
    <mesh position={[.38, -.19, -.87]} rotation={[-.18, 0, 0]}><boxGeometry args={[1.65, .08, .12]} /><meshStandardMaterial color="#202a2e" /></mesh>
    <mesh position={[-.4, -.04, -.46]} rotation={[0, 0, -.14]}><boxGeometry args={[.1, .95, .12]} /><meshStandardMaterial color="#151c20" /></mesh>
    <mesh position={[1.16, -.04, -.46]} rotation={[0, 0, .14]}><boxGeometry args={[.1, .95, .12]} /><meshStandardMaterial color="#151c20" /></mesh>
    <mesh ref={wheel} position={[0, -.29, -.49]} rotation={[Math.PI / 2.35, 0, 0]}><torusGeometry args={[.22, .028, 8, 24]} /><meshStandardMaterial color="#080b0d" roughness={.9} /></mesh>
    <mesh position={[.38, -.36, -.43]}><boxGeometry args={[.38, .13, .04]} /><meshStandardMaterial color="#17262c" emissive="#214b59" emissiveIntensity={.55} /></mesh>
  </group>;
}
