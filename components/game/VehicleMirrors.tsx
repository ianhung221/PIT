"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { CAMERA_SETTINGS, QUALITY_SETTINGS, type CameraMode, type QualityId } from "@/lib/gameConfig";
import type { CarSnapshot } from "@/types/game";

export function VehicleMirrors({ runtime, mode, quality = "high" }: {
  runtime: MutableRefObject<{ player: CarSnapshot }>;
  mode: CameraMode;
  quality?: QualityId;
}) {
  const { gl, scene, camera } = useThree();
  const qualitySettings = QUALITY_SETTINGS[quality];
  const group = useRef<THREE.Group>(null);
  const frame = useRef(0);
  const targets = useMemo(() => {
    const settings = QUALITY_SETTINGS[quality];
    const sizes = settings.sideMirrors ? [[320, 90], [144, 80], [144, 80]] : [[240, 72]];
    return sizes.map(([width, height]) => new THREE.WebGLRenderTarget(Math.round(width * settings.mirrorScale), Math.round(height * settings.mirrorScale)));
  }, [quality]);
  const mirrorCameras = useMemo(() => targets.map((target) => {
    target.texture.colorSpace = THREE.SRGBColorSpace;
    target.texture.wrapS = THREE.RepeatWrapping;
    target.texture.repeat.x = -1;
    target.texture.offset.x = 1;
    return new THREE.PerspectiveCamera(58, target.width / target.height, .1, CAMERA_SETTINGS.mirrorFar);
  }), [targets]);
  const look = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => () => targets.forEach((target) => target.dispose()), [targets]);

  useFrame(() => {
    if (!group.current) return;
    group.current.visible = mode === "driver";
    if (mode !== "driver") return;
    group.current.position.copy(camera.position);
    group.current.quaternion.copy(camera.quaternion);
    group.current.translateZ(-.68);
    frame.current += 1;
    if (frame.current % qualitySettings.mirrorFrameSkip !== 0) return;
    group.current.visible = false;
    const car = runtime.current.player;
    const forwardX = -Math.sin(car.yaw), forwardZ = -Math.cos(car.yaw);
    const rightX = Math.cos(car.yaw), rightZ = -Math.sin(car.yaw);
    const viewAngles = [0, -.36, .36];
    const cameraOffsets = [
      { side: 0, forward: .05, height: 1.02 },
      { side: -.82, forward: .2, height: .82 },
      { side: .82, forward: .2, height: .82 },
    ];
    const cockpit = scene.getObjectByName("cockpit-view");
    const cockpitVisible = cockpit?.visible ?? false;
    if (cockpit) cockpit.visible = false;
    const previousTarget = gl.getRenderTarget();
    mirrorCameras.forEach((mirrorCamera, index) => {
      const offset = cameraOffsets[index];
      const angle = car.yaw + viewAngles[index];
      mirrorCamera.position.set(
        car.x + rightX * offset.side + forwardX * offset.forward,
        offset.height,
        car.z + rightZ * offset.side + forwardZ * offset.forward,
      );
      look.set(
        mirrorCamera.position.x + Math.sin(angle) * 28,
        .65,
        mirrorCamera.position.z + Math.cos(angle) * 28,
      );
      mirrorCamera.lookAt(look);
      gl.setRenderTarget(targets[index]);
      gl.render(scene, mirrorCamera);
    });
    gl.setRenderTarget(previousTarget);
    if (cockpit) cockpit.visible = cockpitVisible;
    group.current.visible = true;
  }, -1);

  return <group ref={group} visible={false}>
    <mesh position={[0, .25, 0]} renderOrder={1000}><planeGeometry args={[.62, .16]} /><meshBasicMaterial map={targets[0].texture} toneMapped={false} depthTest={false} depthWrite={false} /></mesh>
    {qualitySettings.sideMirrors && <>
      <mesh position={[-.48, -.02, 0]} rotation={[0, .16, 0]} renderOrder={1000}><planeGeometry args={[.25, .15]} /><meshBasicMaterial map={targets[1].texture} toneMapped={false} depthTest={false} depthWrite={false} /></mesh>
      <mesh position={[.48, -.02, 0]} rotation={[0, -.16, 0]} renderOrder={1000}><planeGeometry args={[.25, .15]} /><meshBasicMaterial map={targets[2].texture} toneMapped={false} depthTest={false} depthWrite={false} /></mesh>
    </>}
  </group>;
}
