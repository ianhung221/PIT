"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { ConvexHullCollider, CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import type { RoadSection } from "@/lib/roadGeometry";
import {
  GROUND_COLLISION_GROUPS, GROUND_HALF_THICKNESS, PRACTICE_SURFACE_Y,
  SHOULDER_SURFACE_Y, groundBounds, roadSupportPrisms,
} from "@/lib/groundPhysics";

interface PhysicsGroundProps {
  sections?: readonly RoadSection[];
  height?: number;
  halfSize?: number;
  color?: string;
}

/** Shared visual + bearing floor. Supplying road sections adds the raised road surface.
 * No car-position dependency: airborne or distant cars never lose their landing area. */
export function PhysicsGround({ sections, height, halfSize = 1250, color = "#454c4d" }: PhysicsGroundProps) {
  const surfaceY = height ?? (sections?.length ? SHOULDER_SURFACE_Y : PRACTICE_SURFACE_Y);
  const bounds = useMemo(() => groundBounds(sections ?? [], halfSize), [sections, halfSize]);
  const road = useMemo(() => roadSupportPrisms(sections ?? []), [sections]);
  return <group name="bearing-ground">
    <mesh receiveShadow position={[bounds.center[0], surfaceY, bounds.center[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[bounds.halfSize[0] * 2, bounds.halfSize[1] * 2]} />
      <meshStandardMaterial color={color} />
    </mesh>
    <RigidBody type="fixed" name="bearing-ground-body" colliders={false}>
      <CuboidCollider
        args={[bounds.halfSize[0], GROUND_HALF_THICKNESS, bounds.halfSize[1]]}
        position={[bounds.center[0], surfaceY - GROUND_HALF_THICKNESS, bounds.center[1]]}
        collisionGroups={GROUND_COLLISION_GROUPS} friction={.7} restitution={.02}
      />
      {road.map((prism, index) => <ConvexHullCollider key={index}
        args={[prism.vertices]} position={prism.position} collisionGroups={GROUND_COLLISION_GROUPS}
        friction={.7} restitution={.02}
      />)}
    </RigidBody>
  </group>;
}
