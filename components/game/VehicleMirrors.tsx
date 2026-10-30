"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { CAMERA_SETTINGS, QUALITY_SETTINGS, type CameraMode, type QualityId, type VehicleId } from "@/lib/gameConfig";
import { mirrorCameraFrame } from "@/lib/vehicleCamera";
import type { CarSnapshot } from "@/types/game";

export function VehicleMirrors({ runtime, mode, quality = "high", vehicle="patrol" }: {
  runtime: MutableRefObject<{ player: CarSnapshot }>;
  mode: CameraMode;
  quality?: QualityId;
  vehicle?: VehicleId;
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
    return new THREE.PerspectiveCamera(58, target.width / target.height, .45, CAMERA_SETTINGS.mirrorFar);
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
    const cockpit = scene.getObjectByName("cockpit-view");
    const cockpitVisible = cockpit?.visible ?? false;
    const weather = scene.getObjectByName("weather-particles") as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | undefined;
    const weatherMaterial = weather?.material instanceof THREE.PointsMaterial ? weather.material : undefined;
    const weatherSize = weatherMaterial?.size;
    const weatherOpacity = weatherMaterial?.opacity;
    if (cockpit) cockpit.visible = false;
    const previousTarget = gl.getRenderTarget();
    if (weatherMaterial) {
      weatherMaterial.size *= Number(weather?.userData.mirrorSizeScale ?? .2);
      weatherMaterial.opacity *= Number(weather?.userData.mirrorOpacityScale ?? .5);
      group.current.userData.lastWeatherSize = weatherMaterial.size;
      group.current.userData.lastWeatherOpacity = weatherMaterial.opacity;
    }
    try {
      mirrorCameras.forEach((mirrorCamera, index) => {
        const frame=mirrorCameraFrame(car,vehicle,index);
        mirrorCamera.position.set(frame.position.x,frame.position.y,frame.position.z);
        mirrorCamera.up.set(frame.up.x,frame.up.y,frame.up.z);
        look.set(frame.target.x,frame.target.y,frame.target.z);
        mirrorCamera.lookAt(look);
        gl.setRenderTarget(targets[index]);
        gl.render(scene, mirrorCamera);
      });
    } finally {
      gl.setRenderTarget(previousTarget);
      if (weatherMaterial && weatherSize !== undefined && weatherOpacity !== undefined) {
        weatherMaterial.size = weatherSize;
        weatherMaterial.opacity = weatherOpacity;
      }
      if (cockpit) cockpit.visible = cockpitVisible;
      group.current.visible = true;
    }
  });

  return <group ref={group} visible={false} name="vehicle-mirrors">
    <mesh position={[0, .25, 0]} renderOrder={1000}><planeGeometry args={[.62, .16]} /><meshBasicMaterial map={targets[0].texture} toneMapped={false} depthTest={false} depthWrite={false} /></mesh>
    {qualitySettings.sideMirrors && <>
      <mesh position={[-.48, -.02, 0]} rotation={[0, .16, 0]} renderOrder={1000}><planeGeometry args={[.25, .15]} /><meshBasicMaterial map={targets[1].texture} toneMapped={false} depthTest={false} depthWrite={false} /></mesh>
      <mesh position={[.48, -.02, 0]} rotation={[0, -.16, 0]} renderOrder={1000}><planeGeometry args={[.25, .15]} /><meshBasicMaterial map={targets[2].texture} toneMapped={false} depthTest={false} depthWrite={false} /></mesh>
    </>}
  </group>;
}
