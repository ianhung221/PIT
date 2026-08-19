"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */
/* eslint-disable react-hooks/immutability -- The render loop intentionally updates mutable simulation refs without React renders. */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CAMERA_LABELS, MissionConfig, SCENES, VEHICLES, WEATHER, type CameraMode } from "@/lib/gameConfig";
import { evaluatePitContact } from "@/lib/gameRules";

type Result = "playing" | "success" | "failed" | "paused";
type CarState = { x: number; z: number; yaw: number; speed: number; spin: number; disabled: boolean };
type Runtime = {
  player: CarState;
  suspect: CarState;
  elapsed: number;
  pit: number;
  collisionCooldown: number;
  result: Result;
};

const CAMERA_ORDER: CameraMode[] = ["chase", "driver", "auto"];

function useControls(onCamera: () => void, onPause: () => void) {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
      if (!event.repeat && event.key.toLowerCase() === "c") onCamera();
      if (!event.repeat && (event.key === "Escape" || event.key.toLowerCase() === "p")) onPause();
      keys.current.add(event.key);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key);
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [onCamera, onPause]);
  return keys;
}

function Car({ car, police, model }: { car: CarState; police?: boolean; model?: MissionConfig["vehicle"] }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    group.current.position.set(car.x, .55, car.z);
    group.current.rotation.y = car.yaw;
  });
  const shape = model === "suv" ? [2.15, .78, 4.6] : model === "interceptor" ? [1.95, .55, 4.5] : [2.05, .65, 4.45];
  return <group ref={group}>
    <mesh castShadow position={[0, shape[1] / 2, 0]}><boxGeometry args={shape as [number, number, number]} /><meshStandardMaterial color={police ? VEHICLES[model ?? "patrol"].color : "#8d261b"} roughness={.32} metalness={.55} /></mesh>
    <mesh castShadow position={[0, shape[1] + .22, .25]}><boxGeometry args={[shape[0] * .78, .5, shape[2] * .48]} /><meshStandardMaterial color={police ? "#172128" : "#1c1515"} roughness={.25} metalness={.55} /></mesh>
    {police && <>
      <mesh position={[0, shape[1] + .55, .1]}><boxGeometry args={[1.05, .09, .16]} /><meshStandardMaterial color="#151b20" /></mesh>
      <pointLight position={[-.37, shape[1] + .6, .1]} color="#ff251c" intensity={3.5} distance={9} />
      <pointLight position={[.37, shape[1] + .6, .1]} color="#198dff" intensity={3.5} distance={9} />
      <mesh position={[0, .42, shape[2] / 2 + .02]}><boxGeometry args={[1.2, .2, .05]} /><meshStandardMaterial color="#11191d" /></mesh>
    </>}
    {[-1, 1].flatMap((x) => [-1, 1].map((z) => <mesh key={`${x}-${z}`} position={[x * shape[0] * .48, .25, z * shape[2] * .32]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.33, .33, .22, 12]} /><meshStandardMaterial color="#080a0b" /></mesh>))}
  </group>;
}

function RoadWorld({ config }: { config: MissionConfig }) {
  const scene = SCENES[config.scene];
  const roadside = useMemo(() => Array.from({ length: 74 }, (_, i) => ({ z: 38 - i * 30, side: i % 2 ? -1 : 1, scale: .7 + ((i * 17) % 10) / 10 })), []);
  return <>
    <mesh receiveShadow position={[0, -.08, -1050]}><boxGeometry args={[scene.roadWidth, .15, 2200]} /><meshStandardMaterial color={config.weather === "snow" ? "#8d9695" : "#252a2c"} roughness={config.weather === "rain" ? .18 : .86} metalness={config.weather === "rain" ? .45 : 0} /></mesh>
    <mesh receiveShadow position={[0, -.2, -1050]}><boxGeometry args={[180, .2, 2200]} /><meshStandardMaterial color={config.weather === "snow" ? "#c4cbca" : scene.ground} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * scene.roadWidth / 2, .02, -1050]}><boxGeometry args={[.18, .04, 2200]} /><meshStandardMaterial color="#d8d7c6" /></mesh>)}
    {[-1, 0, 1].map((lane) => config.scene === "highway" || lane === 0 ? <mesh key={lane} position={[lane * scene.roadWidth / 3, .015, -1050]}><boxGeometry args={[.08, .02, 2200]} /><meshStandardMaterial color="#d2d2c5" transparent opacity={lane === 0 && config.scene !== "highway" ? .8 : .35} /></mesh> : null)}
    {roadside.map((item, i) => config.scene === "city" ? <mesh key={i} castShadow position={[item.side * (scene.roadWidth / 2 + 5 + (i % 3) * 2), 4 * item.scale, item.z]}><boxGeometry args={[5 * item.scale, 8 * item.scale, 6]} /><meshStandardMaterial color={i % 3 === 0 ? "#29343b" : "#202a30"} /></mesh> : config.scene === "country" ? <group key={i} position={[item.side * (scene.roadWidth / 2 + 4 + (i % 4)), 0, item.z]}><mesh position={[0, 1.3, 0]}><cylinderGeometry args={[.18, .25, 2.6, 8]} /><meshStandardMaterial color="#35291d" /></mesh><mesh position={[0, 3, 0]}><coneGeometry args={[1.5 * item.scale, 3.6, 8]} /><meshStandardMaterial color="#163d25" /></mesh></group> : <mesh key={i} position={[item.side * (scene.roadWidth / 2 + 2), 1.8, item.z]}><cylinderGeometry args={[.08, .08, 3.6, 6]} /><meshStandardMaterial color="#879194" /></mesh>)}
  </>;
}

function Weather({ config }: { config: MissionConfig }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const data = new Float32Array(750 * 3);
    for (let i = 0; i < data.length; i += 3) {
      const seed = i / 3;
      data[i] = (((seed * 47) % 101) / 100 - .5) * 42;
      data[i + 1] = ((seed * 31) % 97) / 96 * 18;
      data[i + 2] = (((seed * 71) % 103) / 102 - .5) * 55;
    }
    return data;
  }, []);
  useFrame((_, dt) => {
    if (!points.current || config.weather === "clear") return;
    const arr = points.current.geometry.attributes.position.array as Float32Array;
    for (let i = 1; i < arr.length; i += 3) { arr[i] -= dt * (config.weather === "rain" ? 26 : 4); if (arr[i] < 0) arr[i] = 18; }
    points.current.geometry.attributes.position.needsUpdate = true;
  });
  if (config.weather === "clear") return null;
  return <points ref={points}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><pointsMaterial color={config.weather === "snow" ? "white" : "#9bc6df"} size={config.weather === "snow" ? .12 : .045} transparent opacity={.72} /></points>;
}

function CameraRig({ runtime, mode }: { runtime: React.MutableRefObject<Runtime>; mode: CameraMode }) {
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  const desired = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const car = runtime.current.player;
    const sin = Math.sin(car.yaw), cos = Math.cos(car.yaw);
    if (mode === "driver") desired.set(car.x + sin * 1.0, 1.35, car.z + cos * 1.0);
    else if (mode === "auto") desired.set(car.x - sin * 9 + 6, 5.2, car.z + cos * 9 + 3);
    else desired.set(car.x - sin * 7, 3.5, car.z + cos * 8);
    camera.position.lerp(desired, 1 - Math.exp(-dt * (mode === "driver" ? 12 : 5)));
    look.set(car.x + sin * (mode === "driver" ? 16 : 7), mode === "driver" ? .85 : .65, car.z - cos * (mode === "driver" ? 16 : 7));
    camera.lookAt(look);
  });
  return null;
}

function ChaseScene({ config, runtime, keys, cameraMode, onUpdate, onFinish }: { config: MissionConfig; runtime: React.MutableRefObject<Runtime>; keys: React.MutableRefObject<Set<string>>; cameraMode: CameraMode; onUpdate: (data: { speed: number; distance: number; pit: number }) => void; onFinish: (result: "success" | "failed") => void }) {
  const player = runtime.current.player;
  const suspect = runtime.current.suspect;
  const lastUi = useRef(0);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, .04), state = runtime.current;
    if (state.result !== "playing") return;
    state.elapsed += dt; state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
    const grip = WEATHER[config.weather].grip, spec = VEHICLES[config.vehicle];
    const throttle = keys.current.has("ArrowUp") || keys.current.has("w");
    const brake = keys.current.has("ArrowDown") || keys.current.has("s");
    const steer = (keys.current.has("ArrowLeft") || keys.current.has("a") ? 1 : 0) - (keys.current.has("ArrowRight") || keys.current.has("d") ? 1 : 0);
    if (throttle) player.speed += spec.acceleration * grip * dt;
    else player.speed -= (2.3 + player.speed * .025) * dt;
    if (brake) player.speed -= (player.speed > 0 ? 24 * grip : 7) * dt;
    player.speed = THREE.MathUtils.clamp(player.speed, -7, spec.maxSpeed);
    const steerScale = THREE.MathUtils.clamp(Math.abs(player.speed) / 13, .15, 1);
    player.yaw += steer * spec.steering * grip * steerScale * dt * (player.speed >= 0 ? 1 : -1);
    player.x += Math.sin(player.yaw) * player.speed * dt; player.z -= Math.cos(player.yaw) * player.speed * dt;
    const roadLimit = SCENES[config.scene].roadWidth / 2 - 1.1;
    if (Math.abs(player.x) > roadLimit) { player.speed *= 1 - dt * 2.2; player.x = THREE.MathUtils.clamp(player.x, -roadLimit - 1.5, roadLimit + 1.5); }

    if (!suspect.disabled) {
      const distance = Math.hypot(suspect.x - player.x, suspect.z - player.z);
      const targetSpeed = SCENES[config.scene].aiSpeed * (.86 + grip * .14) + (distance < 16 ? 3 : 0);
      suspect.speed += THREE.MathUtils.clamp(targetSpeed - suspect.speed, -7 * dt, 5 * dt);
      const lane = Math.sin(state.elapsed * .52) * Math.min(2.5, roadLimit * .5);
      const desiredYaw = THREE.MathUtils.clamp((lane - suspect.x) * .055, -.22, .22);
      suspect.yaw = THREE.MathUtils.lerp(suspect.yaw, desiredYaw + suspect.spin, dt * 1.8 * grip);
      suspect.x += Math.sin(suspect.yaw) * suspect.speed * dt; suspect.z -= Math.cos(suspect.yaw) * suspect.speed * dt;
    } else { suspect.speed *= Math.max(0, 1 - dt * 2.5); suspect.yaw += suspect.spin * dt; suspect.spin *= 1 - dt * .8; suspect.x += Math.sin(suspect.yaw) * suspect.speed * dt; suspect.z -= Math.cos(suspect.yaw) * suspect.speed * dt; }

    const dx = suspect.x - player.x, dz = suspect.z - player.z, collision = Math.hypot(dx, dz);
    if (collision < 3.2 && state.collisionCooldown <= 0) {
      const relativeSpeed = player.speed - suspect.speed;
      const pitContact = evaluatePitContact({ dx, dz, relativeSpeed, grip: WEATHER[config.weather].grip, cooldown: state.collisionCooldown });
      if (pitContact.valid) {
        suspect.spin += pitContact.spinImpulse;
        suspect.speed *= .9; state.pit = Math.min(100, state.pit + pitContact.pitGain);
        if (state.pit >= 98 || Math.abs(suspect.spin) > 1.5) suspect.disabled = true;
      } else { player.speed *= .72; suspect.speed += Math.max(0, relativeSpeed) * .35; }
      state.collisionCooldown = .42;
    }
    if (suspect.disabled && suspect.speed < 6) { state.result = "success"; onFinish("success"); }
    if (state.elapsed >= 60) { state.result = "failed"; onFinish("failed"); }
    lastUi.current += dt;
    if (lastUi.current > .08) { lastUi.current = 0; onUpdate({ speed: Math.max(0, player.speed), distance: Math.hypot(dx, dz), pit: state.pit }); }
  });
  const fogColor = config.time === "night" ? SCENES[config.scene].fogNight : SCENES[config.scene].fogDay;
  return <>
    <color attach="background" args={[fogColor]} /><fog attach="fog" args={[fogColor, 28 * WEATHER[config.weather].visibility, 175 * WEATHER[config.weather].visibility]} />
    <ambientLight intensity={config.time === "night" ? .28 : 1.25} /><directionalLight castShadow position={[15, 28, 10]} intensity={config.time === "night" ? .35 : 2.2} color={config.time === "night" ? "#85a7d9" : "#fff1cc"} />
    <RoadWorld config={config} /><Car car={player} police model={config.vehicle} /><Car car={suspect} /><Weather config={config} /><CameraRig runtime={runtime} mode={cameraMode} />
  </>;
}

export function PitGame({ config, onExit }: { config: MissionConfig; onExit: () => void }) {
  const runtime = useRef<Runtime>({ player: { x: 0, z: 8, yaw: 0, speed: 0, spin: 0, disabled: false }, suspect: { x: .8, z: -24, yaw: 0, speed: SCENES[config.scene].aiSpeed * .72, spin: 0, disabled: false }, elapsed: 0, pit: 0, collisionCooldown: 0, result: "playing" });
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");
  const [result, setResult] = useState<Result>("playing");
  const [hud, setHud] = useState({ speed: 0, distance: 32, pit: 0, time: 60 });
  const cycleCamera = () => setCameraMode((current) => CAMERA_ORDER[(CAMERA_ORDER.indexOf(current) + 1) % CAMERA_ORDER.length]);
  const togglePause = () => setResult((current) => {
    if (current === "success" || current === "failed") return current;
    const next = current === "paused" ? "playing" : "paused"; runtime.current.result = next; return next;
  });
  const keys = useControls(cycleCamera, togglePause);
  useEffect(() => {
    const timer = window.setInterval(() => setHud((old) => ({ ...old, time: Math.max(0, 60 - runtime.current.elapsed) })), 100);
    return () => window.clearInterval(timer);
  }, []);
  const restart = () => window.location.reload();
  return <main className="game-shell">
    <Canvas shadows camera={{ fov: 56, near: .1, far: 350 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
      <ChaseScene config={config} runtime={runtime} keys={keys} cameraMode={cameraMode} onUpdate={(data) => setHud((old) => ({ ...old, ...data }))} onFinish={(value) => setResult(value)} />
    </Canvas>
    <div className="game-vignette" />
    <header className="game-top"><div className="game-logo"><b>PIT</b> UNIT</div><div className="objective"><small>PRIMARY OBJECTIVE</small><strong>使嫌犯車輛失去行動能力</strong></div><button onClick={togglePause} aria-label="暫停遊戲">Ⅱ</button></header>
    <section className="hud-speed"><span>{Math.round(hud.speed * 3.6)}</span><small>KM/H</small><i style={{ "--speed": `${Math.min(100, hud.speed / VEHICLES[config.vehicle].maxSpeed * 100)}%` } as React.CSSProperties} /></section>
    <section className="hud-timer"><small>TIME REMAINING</small><strong>{Math.floor(hud.time / 60).toString().padStart(2, "0")}:{Math.floor(hud.time % 60).toString().padStart(2, "0")}</strong></section>
    <section className="hud-target"><small>TARGET DISTANCE</small><strong>{hud.distance.toFixed(1)} M</strong><div><i style={{ width: `${hud.pit}%` }} /></div><span>PIT EFFECTIVENESS {Math.round(hud.pit)}%</span></section>
    <section className="hud-camera"><small>CAMERA</small><strong>{CAMERA_LABELS[cameraMode]}</strong><span>C 切換</span></section>
    <div className="game-controls"><kbd>↑</kbd> 加速 · <kbd>↓</kbd> 煞車 · <kbd>←</kbd><kbd>→</kbd> 轉向 · <kbd>C</kbd> 視角 · <kbd>P</kbd> 暫停</div>
    {result !== "playing" && <div className="result-overlay"><div className={`result-card result-card--${result}`}><span>{result === "paused" ? "OPERATION PAUSED" : result === "success" ? "PURSUIT TERMINATED" : "TARGET ESCAPED"}</span><h2>{result === "paused" ? "任務暫停" : result === "success" ? "攔截成功" : "攔截失敗"}</h2><p>{result === "paused" ? "準備好後繼續追逐。" : result === "success" ? "嫌犯車輛已安全失去行動能力。" : "嫌犯已超出攔截時限，重新整備後再試一次。"}</p><div>{result === "paused" ? <button onClick={togglePause}>繼續任務</button> : <button onClick={restart}>重新挑戰</button>}<button className="secondary" onClick={onExit}>返回設定</button></div></div></div>}
  </main>;
}
