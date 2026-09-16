"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import type { RoadSegment } from "@/types/game";
import { SCENES, type MissionConfig } from "@/lib/gameConfig";
import { alongRoad, loadedRoadIndices, roadSections, type RoadPoint, type RoadSection } from "@/lib/roadGeometry";
import type { V2Runtime } from "./v2Runtime";

function quad(vertices: number[], a: RoadPoint, b: RoadPoint, c: RoadPoint, d: RoadPoint, height: number) {
  for (const p of [a, b, c, b, d, c]) vertices.push(p.x, height, p.z);
}

function geometry(vertices: number[]) {
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  result.computeVertexNormals();
  return result;
}

function strip(vertices: number[], a: RoadPoint, b: RoadPoint, width: number, height: number) {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const x = -(b.z - a.z) / length * width / 2;
  const z = (b.x - a.x) / length * width / 2;
  quad(vertices, { x: a.x - x, z: a.z - z }, { x: a.x + x, z: a.z + z }, { x: b.x - x, z: b.z - z }, { x: b.x + x, z: b.z + z }, height);
}

function Barrier({ start, end }: { start: RoadPoint; end: RoadPoint }) {
  const length = Math.hypot(end.x - start.x, end.z - start.z) + .12;
  const position: [number, number, number] = [(start.x + end.x) / 2, .12, (start.z + end.z) / 2];
  const rotation: [number, number, number] = [0, Math.atan2(-(end.x - start.x), -(end.z - start.z)), 0];
  return <RigidBody type="fixed" colliders={false} position={position} rotation={rotation}>
    <mesh><boxGeometry args={[.32, .62, length]} /><meshStandardMaterial color="#7d898d" metalness={.65} roughness={.38} /></mesh>
    <CuboidCollider args={[.16, .31, length / 2]} friction={.74} restitution={.06} />
  </RigidBody>;
}

function RoadTile({ segment, section, config }: { segment: RoadSegment; section: RoadSection; config: MissionConfig }) {
  const surfaces = useMemo(() => {
    const pavement: number[] = [], markings: number[] = [], ground: number[] = [];
    quad(pavement, section.startLeft, section.startRight, section.endLeft, section.endRight, -.505);
    const startScale = 100 / (segment.startWidth ?? segment.width);
    const endScale = 100 / (segment.endWidth ?? segment.width);
    quad(ground, alongRoad(section, 0, -startScale), alongRoad(section, 0, startScale), alongRoad(section, 1, -endScale), alongRoad(section, 1, endScale), -.6);
    for (const side of [-.97, .97]) strip(markings, alongRoad(section, 0, side), alongRoad(section, 1, side), .12, -.49);
    // Six 6 m dashes per 72 m segment. One merged mesh, including highway lanes.
    for (const lane of segment.biome === "highway" ? [-1 / 3, 1 / 3] : [0]) {
      for (let i = 0; i < 6; i++) strip(markings, alongRoad(section, (i * 12 + 3) / 72, lane), alongRoad(section, (i * 12 + 9) / 72, lane), .14, -.485);
    }
    return { pavement: geometry(pavement), markings: geometry(markings), ground: geometry(ground) };
  }, [segment, section]);
  useEffect(() => () => Object.values(surfaces).forEach(item => item.dispose()), [surfaces]);
  const scene = SCENES[segment.biome];
  const snowy = config.weather === "snow", wet = config.weather === "rain";
  return <group name={`road-segment-${segment.index}`}>
    <mesh receiveShadow geometry={surfaces.pavement}><meshStandardMaterial color={snowy ? "#8d9695" : "#252a2c"} roughness={wet ? .2 : .86} metalness={wet ? .38 : 0} /></mesh>
    <mesh receiveShadow geometry={surfaces.ground}><meshStandardMaterial color={snowy ? "#c4cbca" : scene.ground} /></mesh>
    <mesh geometry={surfaces.markings}><meshStandardMaterial color="#ddd8be" /></mesh>
    <Barrier start={section.startLeft} end={section.endLeft} />
    <Barrier start={section.startRight} end={section.endRight} />
    <group position={[segment.x, 0, segment.z]} rotation={[0, segment.yaw, 0]}>
      {segment.index % 3 === 0 && segment.biome === "city" && [-1, 1].map(side => <mesh key={side} castShadow position={[side * (segment.width / 2 + 8), 4.2, 0]}><boxGeometry args={[7, 8.4 + segment.index % 4, 12]} /><meshStandardMaterial color={segment.index % 2 ? "#27333a" : "#1d292f"} /></mesh>)}
      {segment.index % 2 === 0 && segment.biome === "country" && [-1, 1].map(side => <group key={side} position={[side * (segment.width / 2 + 6), 0, -12]}><mesh position={[0, 1.2, 0]}><cylinderGeometry args={[.18, .24, 2.5, 7]} /><meshStandardMaterial color="#3b2c20" /></mesh><mesh position={[0, 3, 0]}><coneGeometry args={[1.55, 3.7, 8]} /><meshStandardMaterial color="#183d25" /></mesh></group>)}
    </group>
  </group>;
}

export function ProceduralWorld({ runtime, config }: { runtime: MutableRefObject<V2Runtime>; config: MissionConfig }) {
  const road = runtime.current.road;
  const sections = useMemo(() => roadSections(road), [road]);
  const [indices, setIndices] = useState(() => loadedRoadIndices(road.segments.length, [0, 0, 0, 0]));
  const lastKey = useRef("0,0,0,0");
  const timer = useRef(0);
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < .1) return;
    timer.current = 0;
    const state = runtime.current;
    const cars = [state.playerRoadIndex, state.suspectRoadIndex, ...state.supportRoadIndices];
    const key = cars.join(",");
    if (lastKey.current === key) return;
    lastKey.current = key;
    setIndices(loadedRoadIndices(road.segments.length, cars));
  });
  return <group name="procedural-world">{indices.map(index => <RoadTile key={road.segments[index].id} segment={road.segments[index]} section={sections[index]} config={config} />)}</group>;
}
