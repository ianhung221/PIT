"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { CuboidCollider, RigidBody } from "@react-three/rapier";
import type { GeneratedRoad } from "@/types/game";
import { SCENES, type MissionConfig } from "@/lib/gameConfig";

export function ProceduralWorld({ road, config, activeIndex = 0 }: { road: GeneratedRoad; config: MissionConfig; activeIndex?: number }) {
  const visibleSegments = road.segments.slice(Math.max(0, activeIndex - 3), Math.min(road.segments.length, activeIndex + 12));
  return <group>
    {visibleSegments.map((segment) => {
      const scene = SCENES[segment.biome];
      const snowy = config.weather === "snow";
      const wet = config.weather === "rain";
      return <group key={segment.id} position={[segment.x, 0, segment.z]} rotation={[0, segment.yaw, 0]}>
        <mesh receiveShadow position={[0, -.58, 0]}><boxGeometry args={[segment.width, .15, segment.length]} /><meshStandardMaterial color={snowy ? "#8d9695" : "#252a2c"} roughness={wet ? .2 : .86} metalness={wet ? .38 : 0} /></mesh>
        <mesh receiveShadow position={[0, -.7, 0]}><boxGeometry args={[90, .2, segment.length]} /><meshStandardMaterial color={snowy ? "#c4cbca" : scene.ground} /></mesh>
        {[-1, 1].map((side) => <group key={side}>
          <mesh position={[side * segment.width / 2, -.46, 0]}><boxGeometry args={[.14, .06, segment.length]} /><meshStandardMaterial color="#ddd8be" /></mesh>
          <mesh position={[side * (segment.width / 2 + .16), .12, 0]}><boxGeometry args={[.2, .62, segment.length]} /><meshStandardMaterial color="#7d898d" metalness={.65} roughness={.38} /></mesh>
        </group>)}
        <mesh position={[0, -.49, 0]}><boxGeometry args={[.09, .025, segment.length]} /><meshStandardMaterial color="#d4d1ba" transparent opacity={segment.biome === "highway" ? .35 : .85} /></mesh>
        {segment.biome === "highway" && [-1, 1].map((lane) => <mesh key={lane} position={[lane * segment.width / 3, -.49, 0]}><boxGeometry args={[.07, .025, segment.length]} /><meshStandardMaterial color="#d4d1ba" transparent opacity={.45} /></mesh>)}
        {segment.index % 3 === 0 && segment.biome === "city" && [-1, 1].map((side) => <mesh key={side} castShadow position={[side * (segment.width / 2 + 8), 4.2, 0]}><boxGeometry args={[7, 8.4 + segment.index % 4, 12]} /><meshStandardMaterial color={segment.index % 2 ? "#27333a" : "#1d292f"} /></mesh>)}
        {segment.index % 2 === 0 && segment.biome === "country" && [-1, 1].map((side) => <group key={side} position={[side * (segment.width / 2 + 6), 0, -12]}><mesh position={[0, 1.2, 0]}><cylinderGeometry args={[.18, .24, 2.5, 7]} /><meshStandardMaterial color="#3b2c20" /></mesh><mesh position={[0, 3, 0]}><coneGeometry args={[1.55, 3.7, 8]} /><meshStandardMaterial color="#183d25" /></mesh></group>)}
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[.24, .9, segment.length / 2]} position={[-segment.width / 2 - .16, .22, 0]} friction={.74} restitution={.06} />
          <CuboidCollider args={[.24, .9, segment.length / 2]} position={[segment.width / 2 + .16, .22, 0]} friction={.74} restitution={.06} />
        </RigidBody>
      </group>;
    })}
  </group>;
}
