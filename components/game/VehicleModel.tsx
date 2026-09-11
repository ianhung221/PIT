"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { Clone, useGLTF } from "@react-three/drei";
import { Component, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { SUSPECT, VEHICLES, VEHICLE_VISUALS, type VehicleId } from "@/lib/gameConfig";
import { publicPath } from "@/lib/publicPath";

const ASSETS = {
  patrol: publicPath("/assets/kenney-car-kit/police.glb"),
  interceptor: publicPath("/assets/kenney-car-kit/race.glb"),
  suv: publicPath("/assets/kenney-car-kit/suv.glb"),
  suspect: publicPath("/assets/kenney-car-kit/sedan-sports.glb"),
} as const;

class VehicleAssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function LoadedVehicle({ asset, kind }: { asset: string; kind: VehicleId | "suspect" }) {
  const { scene } = useGLTF(asset);
  const clone = useMemo(() => {
    const instance = scene.clone(true);
    instance.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    });
    return instance;
  }, [scene]);
  const visual = VEHICLE_VISUALS[kind];
  return <group position={[0, visual.positionY, 0]} rotation={[0, visual.rotationY, 0]} scale={visual.scale}>
    <Clone object={clone} />
  </group>;
}

function FallbackVehicle({ police, model }: { police: boolean; model: VehicleId }) {
  const shape = police ? VEHICLES[model] : SUSPECT;
  return <group>
    <mesh castShadow><boxGeometry args={[shape.width, shape.height, shape.length]} /><meshStandardMaterial color={police ? shape.color : SUSPECT.color} roughness={.34} metalness={.48} /></mesh>
    <mesh castShadow position={[0, shape.height / 2 + .22, .18]}><boxGeometry args={[shape.width * .76, .46, shape.length * .46]} /><meshStandardMaterial color="#182126" roughness={.25} /></mesh>
  </group>;
}

export function VehicleModel({ police = false, model = "patrol", unit = "", hideExterior = false }: {
  police?: boolean;
  model?: VehicleId;
  unit?: string;
  hideExterior?: boolean;
}) {
  const kind = police ? model : "suspect";
  const shape = police ? VEHICLES[model] : SUSPECT;
  return <group visible={!hideExterior} name={unit === "01" ? "player-exterior" : undefined}>
    <VehicleAssetBoundary fallback={<FallbackVehicle police={police} model={model} />}><LoadedVehicle asset={ASSETS[kind]} kind={kind} /></VehicleAssetBoundary>
    {police && <>
      <pointLight position={[-.36, shape.height / 2 + .73, .08]} color="#ff251c" intensity={3.2} distance={10} />
      <pointLight position={[.36, shape.height / 2 + .73, .08]} color="#198dff" intensity={3.2} distance={10} />
      {unit && <mesh position={[0, .2, shape.length / 2 + .031]}><planeGeometry args={[.72, .18]} /><meshBasicMaterial color="#111820" /></mesh>}
    </>}
  </group>;
}

Object.values(ASSETS).forEach((asset) => useGLTF.preload(asset));
