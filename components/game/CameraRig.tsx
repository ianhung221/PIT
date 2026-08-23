"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, type MutableRefObject } from "react";
import * as THREE from "three";
import { CAMERA_SETTINGS, type CameraMode } from "@/lib/gameConfig";
import type { CarSnapshot } from "@/types/game";

type CameraRuntime = { player: CarSnapshot; suspect: CarSnapshot; supports?: CarSnapshot[] };

export function CameraRig({ runtime, mode, keys }: {
  runtime: MutableRefObject<CameraRuntime>;
  mode: CameraMode;
  keys: MutableRefObject<Set<string>>;
}) {
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  const desired = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const car = runtime.current.player;
    const suspect = runtime.current.suspect;
    const forwardX = -Math.sin(car.yaw), forwardZ = -Math.cos(car.yaw);
    const rightX = Math.cos(car.yaw), rightZ = -Math.sin(car.yaw);
    if (mode === "driver") {
      desired.set(car.x - rightX * .38 + forwardX * .2, .86, car.z - rightZ * .38 + forwardZ * .2);
      const rearView = keys.current.has("r");
      look.set(desired.x + forwardX * (rearView ? -18 : 18), .82, desired.z + forwardZ * (rearView ? -18 : 18));
    } else if (mode === "auto") {
      const vehicles = [car, suspect, ...(runtime.current.supports ?? [])];
      const centerX = vehicles.reduce((sum, vehicle) => sum + vehicle.x, 0) / vehicles.length;
      const centerZ = vehicles.reduce((sum, vehicle) => sum + vehicle.z, 0) / vehicles.length;
      const separation = vehicles.reduce((largest, vehicle) => Math.max(largest, Math.hypot(vehicle.x - centerX, vehicle.z - centerZ)), 0) * 2;
      const height = THREE.MathUtils.clamp(14 + separation * .38, CAMERA_SETTINGS.helicopterMinHeight, CAMERA_SETTINGS.helicopterMaxHeight);
      desired.set(centerX + height * .35, height, centerZ + height * .42);
      look.set(centerX, .2, centerZ);
    } else {
      desired.set(car.x - forwardX * 8, 3.5, car.z - forwardZ * 8);
      look.set(car.x + forwardX * 8, .65, car.z + forwardZ * 8);
    }
    camera.position.lerp(desired, 1 - Math.exp(-dt * (mode === "driver" ? 12 : mode === "auto" ? 2.8 : 5)));
    camera.lookAt(look);
  });
  return null;
}
