"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { CAMERA_SETTINGS, type CameraMode } from "@/lib/gameConfig";
import { computeHelicopterFrame } from "@/lib/cameraMath";
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
  const helicopterCenter = useMemo(() => new THREE.Vector3(), []);
  const helicopterTarget = useMemo(() => new THREE.Vector3(), []);
  const helicopterHeight = useRef(CAMERA_SETTINGS.helicopterMinHeight);
  const helicopterYaw = useRef(0);
  const previousMode = useRef<CameraMode | null>(null);

  useFrame((_, dt) => {
    const car = runtime.current.player;
    const suspect = runtime.current.suspect;
    const forwardX = -Math.sin(car.yaw), forwardZ = -Math.cos(car.yaw);
    const rightX = Math.cos(car.yaw), rightZ = -Math.sin(car.yaw);
    if (mode === "driver") {
      desired.set(car.x - rightX * .38 + forwardX * .2, .86, car.z - rightZ * .38 + forwardZ * .2);
      const rearView = keys.current.has("r");
      look.set(desired.x + forwardX * (rearView ? -18 : 18), .82, desired.z + forwardZ * (rearView ? -18 : 18));
      camera.position.copy(desired);
      camera.lookAt(look);
      previousMode.current = mode;
      return;
    } else if (mode === "auto") {
      const frame = computeHelicopterFrame(
        car,
        suspect,
        runtime.current.supports,
        CAMERA_SETTINGS.helicopterFocusDistance,
        CAMERA_SETTINGS.helicopterSupportRadius,
      );
      const height = THREE.MathUtils.clamp(18 + frame.separation * .75, CAMERA_SETTINGS.helicopterMinHeight, CAMERA_SETTINGS.helicopterMaxHeight);
      helicopterTarget.set(frame.centerX, .35, frame.centerZ);
      if (previousMode.current !== mode) {
        helicopterCenter.copy(helicopterTarget);
        helicopterHeight.current = height;
        helicopterYaw.current = car.yaw;
      } else {
        helicopterCenter.lerp(helicopterTarget, 1 - Math.exp(-dt * 2.15));
        helicopterHeight.current = THREE.MathUtils.damp(helicopterHeight.current, height, 2.2, dt);
        const yawDelta = Math.atan2(Math.sin(car.yaw - helicopterYaw.current), Math.cos(car.yaw - helicopterYaw.current));
        helicopterYaw.current += yawDelta * (1 - Math.exp(-dt * 1.15));
      }
      const stableForwardX = -Math.sin(helicopterYaw.current);
      const stableForwardZ = -Math.cos(helicopterYaw.current);
      const stableRightX = Math.cos(helicopterYaw.current);
      const stableRightZ = -Math.sin(helicopterYaw.current);
      const backDistance = helicopterHeight.current * .72;
      const sideDistance = helicopterHeight.current * .16;
      desired.set(
        helicopterCenter.x - stableForwardX * backDistance + stableRightX * sideDistance,
        helicopterHeight.current,
        helicopterCenter.z - stableForwardZ * backDistance + stableRightZ * sideDistance,
      );
      look.copy(helicopterCenter);
    } else {
      desired.set(car.x - forwardX * 8, 3.5, car.z - forwardZ * 8);
      look.set(car.x + forwardX * 8, .65, car.z + forwardZ * 8);
    }
    camera.position.lerp(desired, 1 - Math.exp(-dt * (mode === "driver" ? 12 : mode === "auto" ? 2.8 : 5)));
    camera.lookAt(look);
    previousMode.current = mode;
  });
  return null;
}
