"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { Clone, useGLTF } from "@react-three/drei";
import { Component, type ReactNode } from "react";
import { SUSPECT, VEHICLES, type VehicleId } from "@/lib/gameConfig";

const ASSETS = {
  patrol: "/assets/kenney-car-kit/police.glb",
  interceptor: "/assets/kenney-car-kit/race.glb",
  suv: "/assets/kenney-car-kit/suv.glb",
  suspect: "/assets/kenney-car-kit/sedan-sports.glb",
} as const;

const SCALE: Record<VehicleId | "suspect", [number, number, number]> = {
  patrol: [1.35, 1, 1.52],
  interceptor: [1.62, 1.2, 1.76],
  suv: [1.43, 1.12, 1.8],
  suspect: [1.5, 1.08, 1.72],
};

class VehicleAssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function LoadedVehicle({ asset, scale }: { asset: string; scale: [number, number, number] }) {
  const { scene } = useGLTF(asset);
  return <group position={[0, -.18, 0]} scale={scale}><Clone object={scene} castShadow receiveShadow /></group>;
}

function FallbackVehicle({ police, model }: { police: boolean; model: VehicleId }) {
  const shape = police ? VEHICLES[model] : SUSPECT;
  return <group>
    <mesh castShadow><boxGeometry args={[shape.width, shape.height, shape.length]} /><meshStandardMaterial color={police ? shape.color : SUSPECT.color} roughness={.34} metalness={.48} /></mesh>
    <mesh castShadow position={[0, shape.height / 2 + .22, .18]}><boxGeometry args={[shape.width * .76, .46, shape.length * .46]} /><meshStandardMaterial color="#182126" roughness={.25} /></mesh>
  </group>;
}

export function VehicleModel({ police = false, model = "patrol", unit = "" }: { police?: boolean; model?: VehicleId; unit?: string }) {
  const kind = police ? model : "suspect";
  const shape = police ? VEHICLES[model] : SUSPECT;
  return <group>
    <VehicleAssetBoundary fallback={<FallbackVehicle police={police} model={model} />}><LoadedVehicle asset={ASSETS[kind]} scale={SCALE[kind]} /></VehicleAssetBoundary>
    {police && <>
      <pointLight position={[-.36, shape.height / 2 + .73, .08]} color="#ff251c" intensity={3.2} distance={10} />
      <pointLight position={[.36, shape.height / 2 + .73, .08]} color="#198dff" intensity={3.2} distance={10} />
      {unit && <mesh position={[0, .2, shape.length / 2 + .031]}><planeGeometry args={[.72, .18]} /><meshBasicMaterial color="#111820" /></mesh>}
    </>}
  </group>;
}

Object.values(ASSETS).forEach((asset) => useGLTF.preload(asset));
