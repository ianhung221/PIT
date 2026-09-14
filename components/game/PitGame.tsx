"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */
/* eslint-disable react-hooks/immutability -- The render loop intentionally updates mutable simulation refs without React renders. */

import { Canvas, useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  Physics,
  RigidBody,
  useBeforePhysicsStep,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CameraRig } from "@/components/game/CameraRig";
import { CockpitView } from "@/components/game/CockpitView";
import { VehicleMirrors } from "@/components/game/VehicleMirrors";
import {
  CAMERA_LABELS,
  MissionConfig,
  PIT_RULES,
  SCENES,
  SUSPECT,
  VEHICLES,
  WEATHER,
  type CameraMode,
} from "@/lib/gameConfig";
import {
  evaluatePitContact,
  evaluatePitOutcome,
  isSuspectRecoveryNeeded,
  nextSuspectRecoveryMode,
  normalizeAngle,
  SUSPECT_RECOVERY,
  steeringInput,
  suspectForwardSpeedScale,
  suspectReverseEscapeYaw,
  type SuspectRecoveryMode,
} from "@/lib/gameRules";

type Result = "playing" | "success" | "failed" | "paused";
type CarSnapshot = { x: number; z: number; yaw: number; speed: number; lateralSpeed: number };
type PitCandidate = { startYaw: number; startSpeed: number; expires: number; side: -1 | 1 };
type SuspectAiState = { mode: SuspectRecoveryMode; modeElapsed: number; stalledFor: number };
type Runtime = {
  player: CarSnapshot;
  suspect: CarSnapshot;
  elapsed: number;
  pit: number;
  collisionCooldown: number;
  pitCandidate: PitCandidate | null;
  suspectAi: SuspectAiState;
  result: Result;
};

const CAMERA_ORDER: CameraMode[] = ["chase", "driver", "auto"];
const INITIAL_PLAYER: CarSnapshot = { x: 0, z: 8, yaw: 0, speed: 0, lateralSpeed: 0 };

function makeRuntime(config: MissionConfig): Runtime {
  return {
    player: { ...INITIAL_PLAYER },
    suspect: { x: .8, z: -24, yaw: 0, speed: SCENES[config.scene].aiSpeed * .72, lateralSpeed: 0 },
    elapsed: 0,
    pit: 0,
    collisionCooldown: 0,
    pitCandidate: null,
    suspectAi: { mode: "driving", modeElapsed: 0, stalledFor: 0 },
    result: "playing",
  };
}

function useControls(onCamera: () => void, onPause: () => void) {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const clear = () => keys.current.clear();
    const down = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
      const key = event.key.toLowerCase();
      if (!event.repeat && key === "c") onCamera();
      if (!event.repeat && (key === "escape" || key === "p")) onPause();
      keys.current.add(key);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [onCamera, onPause]);
  return keys;
}

function CarModel({ police, model }: { police?: boolean; model?: MissionConfig["vehicle"] }) {
  const shape = police ? VEHICLES[model ?? "patrol"] : SUSPECT;
  return <group>
    <mesh castShadow position={[0, 0, 0]}>
      <boxGeometry args={[shape.width, shape.height, shape.length]} />
      <meshStandardMaterial color={police ? shape.color : SUSPECT.color} roughness={.32} metalness={.55} />
    </mesh>
    <mesh castShadow position={[0, shape.height / 2 + .25, .2]}>
      <boxGeometry args={[shape.width * .78, .5, shape.length * .48]} />
      <meshStandardMaterial color={police ? "#172128" : "#1c1515"} roughness={.25} metalness={.55} />
    </mesh>
    {police && <>
      <mesh position={[0, shape.height / 2 + .58, .08]}>
        <boxGeometry args={[1.05, .09, .16]} />
        <meshStandardMaterial color="#151b20" />
      </mesh>
      <pointLight position={[-.37, shape.height / 2 + .62, .08]} color="#ff251c" intensity={3.5} distance={9} />
      <pointLight position={[.37, shape.height / 2 + .62, .08]} color="#198dff" intensity={3.5} distance={9} />
      <mesh position={[0, -.05, -shape.length / 2 - .02]}>
        <boxGeometry args={[1.2, .2, .05]} />
        <meshStandardMaterial color="#11191d" />
      </mesh>
    </>}
    {[-1, 1].flatMap((x) => [-1, 1].map((z) =>
      <mesh key={`${x}-${z}`} position={[x * shape.width * .48, -.28, z * shape.length * .32]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[.33, .33, .22, 12]} />
        <meshStandardMaterial color="#080a0b" />
      </mesh>,
    ))}
  </group>;
}

function RoadWorld({ config, runtime }: { config: MissionConfig; runtime: React.MutableRefObject<Runtime> }) {
  const scene = SCENES[config.scene];
  const group = useRef<THREE.Group>(null);
  const roadside = useMemo(() => Array.from({ length: 74 }, (_, i) => ({
    z: 900 - i * 25,
    side: i % 2 ? -1 : 1,
    scale: .7 + ((i * 17) % 10) / 10,
  })), []);
  useFrame(() => {
    if (group.current) group.current.position.z = Math.round(runtime.current.player.z / 900) * 900;
  });
  return <>
    <group ref={group}>
      <mesh receiveShadow position={[0, -.58, 0]}>
        <boxGeometry args={[scene.roadWidth, .15, 2000]} />
        <meshStandardMaterial color={config.weather === "snow" ? "#8d9695" : "#252a2c"} roughness={config.weather === "rain" ? .18 : .86} metalness={config.weather === "rain" ? .45 : 0} />
      </mesh>
      <mesh receiveShadow position={[0, -.7, 0]}>
        <boxGeometry args={[180, .2, 2000]} />
        <meshStandardMaterial color={config.weather === "snow" ? "#c4cbca" : scene.ground} />
      </mesh>
      {[-1, 1].map((side) => <group key={side}>
        <mesh position={[side * scene.roadWidth / 2, -.46, 0]}>
          <boxGeometry args={[.16, .06, 2000]} />
          <meshStandardMaterial color="#d8d7c6" />
        </mesh>
        <mesh position={[side * (scene.roadWidth / 2 + .16), .18, 0]}>
          <boxGeometry args={[.18, .65, 2000]} />
          <meshStandardMaterial color={config.scene === "country" ? "#6b716b" : "#858f93"} metalness={.65} roughness={.4} />
        </mesh>
      </group>)}
      {[-1, 0, 1].map((lane) => config.scene === "highway" || lane === 0 ? <mesh key={lane} position={[lane * scene.roadWidth / 3, -.495, 0]}>
        <boxGeometry args={[.08, .02, 2000]} />
        <meshStandardMaterial color="#d2d2c5" transparent opacity={lane === 0 && config.scene !== "highway" ? .8 : .35} />
      </mesh> : null)}
      {roadside.map((item, i) => config.scene === "city" ? <mesh key={i} castShadow position={[item.side * (scene.roadWidth / 2 + 5 + (i % 3) * 2), 4 * item.scale, item.z]}>
        <boxGeometry args={[5 * item.scale, 8 * item.scale, 6]} /><meshStandardMaterial color={i % 3 === 0 ? "#29343b" : "#202a30"} />
      </mesh> : config.scene === "country" ? <group key={i} position={[item.side * (scene.roadWidth / 2 + 4 + (i % 4)), 0, item.z]}>
        <mesh position={[0, 1.3, 0]}><cylinderGeometry args={[.18, .25, 2.6, 8]} /><meshStandardMaterial color="#35291d" /></mesh>
        <mesh position={[0, 3, 0]}><coneGeometry args={[1.5 * item.scale, 3.6, 8]} /><meshStandardMaterial color="#163d25" /></mesh>
      </group> : <mesh key={i} position={[item.side * (scene.roadWidth / 2 + 2), 1.8, item.z]}>
        <cylinderGeometry args={[.08, .08, 3.6, 6]} /><meshStandardMaterial color="#879194" />
      </mesh>)}
    </group>
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[.22, 1, 4000]} position={[-scene.roadWidth / 2 - .12, .25, -1600]} friction={.72} restitution={.08} />
      <CuboidCollider args={[.22, 1, 4000]} position={[scene.roadWidth / 2 + .12, .25, -1600]} friction={.72} restitution={.08} />
    </RigidBody>
  </>;
}

function Weather({ config, runtime }: { config: MissionConfig; runtime: React.MutableRefObject<Runtime> }) {
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
    points.current.position.x = runtime.current.player.x;
    points.current.position.z = runtime.current.player.z - 12;
    const arr = points.current.geometry.attributes.position.array as Float32Array;
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] -= dt * (config.weather === "rain" ? 26 : 4);
      if (arr[i] < 0) arr[i] = 18;
    }
    points.current.geometry.attributes.position.needsUpdate = true;
  });
  if (config.weather === "clear") return null;
  return <points ref={points}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <pointsMaterial color={config.weather === "snow" ? "white" : "#9bc6df"} size={config.weather === "snow" ? .12 : .045} transparent opacity={.72} />
  </points>;
}

function VehicleSimulation({
  config,
  runtime,
  keys,
  onUpdate,
  onFinish,
}: {
  config: MissionConfig;
  runtime: React.MutableRefObject<Runtime>;
  keys: React.MutableRefObject<Set<string>>;
  onUpdate: (data: { speed: number; distance: number; pit: number }) => void;
  onFinish: (result: "success" | "failed") => void;
}) {
  const playerRef = useRef<RapierRigidBody>(null);
  const suspectRef = useRef<RapierRigidBody>(null);
  const lastUi = useRef(0);
  const temp = useMemo(() => ({
    quaternion: new THREE.Quaternion(),
    inverseQuaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    impulse: new THREE.Vector3(),
    relative: new THREE.Vector3(),
    toSuspect: new THREE.Vector3(),
    localContact: new THREE.Vector3(),
    euler: new THREE.Euler(0, 0, 0, "YXZ"),
  }), []);

  const bodyFrame = useCallback((body: RapierRigidBody) => {
    const rotation = body.rotation();
    temp.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    temp.euler.setFromQuaternion(temp.quaternion, "YXZ");
    temp.forward.set(0, 0, -1).applyQuaternion(temp.quaternion);
    temp.right.set(1, 0, 0).applyQuaternion(temp.quaternion);
    const velocity = body.linvel();
    temp.velocity.set(velocity.x, 0, velocity.z);
    return {
      yaw: temp.euler.y,
      forwardX: temp.forward.x,
      forwardZ: temp.forward.z,
      rightX: temp.right.x,
      rightZ: temp.right.z,
      velocityX: temp.velocity.x,
      velocityZ: temp.velocity.z,
      forwardSpeed: temp.velocity.dot(temp.forward),
      lateralSpeed: temp.velocity.dot(temp.right),
    };
  }, [temp]);

  const handleVehicleCollision = (event: CollisionEnterPayload) => {
    const player = playerRef.current, suspect = suspectRef.current;
    if (!player || !suspect || event.other.rigidBody?.handle !== suspect.handle) return;
    const state = runtime.current;
    const playerPosition = player.translation(), suspectPosition = suspect.translation();
    const suspectRotation = suspect.rotation(), playerRotation = player.rotation();
    const playerVelocity = player.linvel(), suspectVelocity = suspect.linvel();
    temp.quaternion.set(suspectRotation.x, suspectRotation.y, suspectRotation.z, suspectRotation.w);
    temp.inverseQuaternion.copy(temp.quaternion).invert();
    temp.localContact.set(playerPosition.x - suspectPosition.x, 0, playerPosition.z - suspectPosition.z).applyQuaternion(temp.inverseQuaternion);
    temp.toSuspect.set(suspectPosition.x - playerPosition.x, 0, suspectPosition.z - playerPosition.z).normalize();
    temp.relative.set(playerVelocity.x - suspectVelocity.x, 0, playerVelocity.z - suspectVelocity.z);
    const closingSpeed = temp.relative.dot(temp.toSuspect);
    temp.quaternion.set(playerRotation.x, playerRotation.y, playerRotation.z, playerRotation.w);
    const playerYaw = temp.euler.setFromQuaternion(temp.quaternion, "YXZ").y;
    temp.quaternion.set(suspectRotation.x, suspectRotation.y, suspectRotation.z, suspectRotation.w);
    const suspectYaw = temp.euler.setFromQuaternion(temp.quaternion, "YXZ").y;
    const result = evaluatePitContact({
      localX: temp.localContact.x,
      localZ: temp.localContact.z,
      suspectHalfWidth: SUSPECT.width / 2,
      suspectHalfLength: SUSPECT.length / 2,
      closingSpeed,
      headingDelta: normalizeAngle(playerYaw - suspectYaw),
      cooldown: state.collisionCooldown,
      hasCandidate: state.pitCandidate !== null,
    });
    state.collisionCooldown = .5;
    if (!result.valid || result.side === 0) return;
    const suspectFrame = bodyFrame(suspect);
    state.pitCandidate = {
      startYaw: suspectFrame.yaw,
      startSpeed: Math.max(1, suspectFrame.forwardSpeed),
      expires: state.elapsed + PIT_RULES.evaluationWindow,
      side: result.side,
    };
    state.pit = 20;
    suspect.applyTorqueImpulse({ x: 0, y: result.side * (1.6 / WEATHER[config.weather].grip), z: 0 }, true);
  };

  useBeforePhysicsStep((world) => {
    const player = playerRef.current, suspect = suspectRef.current, state = runtime.current;
    if (!player || !suspect || state.result !== "playing") return;
    const dt = world.timestep;
    state.elapsed += dt;
    state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
    const grip = WEATHER[config.weather].grip, spec = VEHICLES[config.vehicle];

    const playerFrame = bodyFrame(player);
    const throttle = keys.current.has("arrowup") || keys.current.has("w");
    const brake = keys.current.has("arrowdown") || keys.current.has("s");
    const steer = steeringInput(keys.current.has("arrowleft") || keys.current.has("a"), keys.current.has("arrowright") || keys.current.has("d"));
    const playerMass = player.mass();
    if (throttle) {
      temp.impulse.set(playerFrame.forwardX, 0, playerFrame.forwardZ).multiplyScalar(playerMass * spec.acceleration * grip * dt);
      player.applyImpulse(temp.impulse, true);
    }
    if (brake) {
      const braking = playerFrame.forwardSpeed > .8 ? -Math.min(playerFrame.forwardSpeed, 24 * grip * dt) : -7 * grip * dt;
      temp.impulse.set(playerFrame.forwardX, 0, playerFrame.forwardZ).multiplyScalar(playerMass * braking);
      player.applyImpulse(temp.impulse, true);
    }
    const lateralCorrection = -playerFrame.lateralSpeed * playerMass * Math.min(1, grip * 8 * dt);
    player.applyImpulse({ x: playerFrame.rightX * lateralCorrection, y: 0, z: playerFrame.rightZ * lateralCorrection }, true);
    player.applyImpulse({ x: -playerFrame.velocityX * playerMass * .12 * dt, y: 0, z: -playerFrame.velocityZ * playerMass * .12 * dt }, true);
    const speedFactor = THREE.MathUtils.clamp(Math.abs(playerFrame.forwardSpeed) / 13, .12, 1);
    const desiredTurn = -steer * spec.steering * grip * speedFactor * (playerFrame.forwardSpeed >= 0 ? 1 : -1);
    const currentPlayerAng = player.angvel();
    player.setAngvel({ x: 0, y: THREE.MathUtils.lerp(currentPlayerAng.y, desiredTurn, Math.min(1, dt * 8)), z: 0 }, true);
    const playerVelocityAfter = player.linvel();
    const planarSpeed = Math.hypot(playerVelocityAfter.x, playerVelocityAfter.z);
    if (planarSpeed > spec.maxSpeed) {
      const limit = spec.maxSpeed / planarSpeed;
      player.setLinvel({ x: playerVelocityAfter.x * limit, y: 0, z: playerVelocityAfter.z * limit }, true);
    }

    const suspectPosition = suspect.translation();
    const suspectFrame = bodyFrame(suspect);
    const roadLimit = SCENES[config.scene].roadWidth / 2 - 1.35;
    const laneTarget = THREE.MathUtils.clamp(Math.sin(state.elapsed * .52) * Math.min(2.5, roadLimit * .5), -roadLimit, roadLimit);
    const boundaryPressure = Math.abs(suspectPosition.x) > roadLimit * .78 ? THREE.MathUtils.clamp(-suspectPosition.x / roadLimit, -1, 1) * 3.4 : 0;
    const targetX = THREE.MathUtils.clamp(laneTarget + boundaryPressure, -roadLimit * .78, roadLimit * .78);
    const desiredYaw = Math.atan2(-(targetX - suspectPosition.x), 42);
    const yawError = normalizeAngle(desiredYaw - suspectFrame.yaw);
    const planarSuspectSpeed = Math.hypot(suspectFrame.velocityX, suspectFrame.velocityZ);
    const boundaryRatio = Math.abs(suspectPosition.x) / Math.max(.1, roadLimit);
    const ai = state.suspectAi;
    const looksStuck = planarSuspectSpeed < SUSPECT_RECOVERY.stuckSpeed && (boundaryRatio >= .72 || Math.abs(yawError) >= Math.PI * 48 / 180 || suspectFrame.forwardSpeed < -.5);
    ai.stalledFor = !state.pitCandidate && looksStuck ? ai.stalledFor + dt : Math.max(0, ai.stalledFor - dt * 2);
    if (ai.mode === "driving" && isSuspectRecoveryNeeded({
      planarSpeed: planarSuspectSpeed,
      forwardSpeed: suspectFrame.forwardSpeed,
      yawError,
      boundaryRatio,
      stalledFor: ai.stalledFor,
      pitActive: state.pitCandidate !== null,
    })) {
      ai.mode = "braking";
      ai.modeElapsed = 0;
      ai.stalledFor = 0;
    }
    if (ai.mode !== "driving" && !state.pitCandidate) {
      ai.modeElapsed += dt;
      const nextMode = nextSuspectRecoveryMode(ai.mode, ai.modeElapsed, yawError, suspectFrame.forwardSpeed);
      if (nextMode !== ai.mode) {
        ai.mode = nextMode;
        ai.modeElapsed = 0;
        if (nextMode === "driving") ai.stalledFor = 0;
      }
    }
    const candidateControl = state.pitCandidate ? .12 : 1;
    const effectiveMode = state.pitCandidate ? "driving" : ai.mode;
    const steeringYaw = effectiveMode === "reversing" ? suspectReverseEscapeYaw(suspectPosition.x) : desiredYaw;
    const steeringYawError = normalizeAngle(steeringYaw - suspectFrame.yaw);
    const recoveryTurnLimit = effectiveMode === "reversing" ? .88 : effectiveMode === "realigning" ? .66 : .7;
    const recoveryTurnGain = effectiveMode === "reversing" ? 3.2 : 2.6;
    const targetAngVel = THREE.MathUtils.clamp(steeringYawError * recoveryTurnGain, -recoveryTurnLimit, recoveryTurnLimit);
    const currentSuspectAng = suspect.angvel();
    const steeringResponse = effectiveMode === "reversing" || effectiveMode === "realigning" ? 3.5 : 2.4;
    suspect.setAngvel({ x: 0, y: THREE.MathUtils.lerp(currentSuspectAng.y, targetAngVel, Math.min(1, dt * steeringResponse * grip * candidateControl)), z: 0 }, true);
    const pursuitBoost = Math.hypot(suspectPosition.x - runtime.current.player.x, suspectPosition.z - runtime.current.player.z) < 16 ? 3 : 0;
    const cruiseSpeed = (SCENES[config.scene].aiSpeed * (.86 + grip * .14) + pursuitBoost) * suspectForwardSpeedScale(yawError);
    let targetSpeed = cruiseSpeed;
    if (effectiveMode === "braking") targetSpeed = 0;
    if (effectiveMode === "reversing") targetSpeed = -6 * grip;
    if (effectiveMode === "realigning") targetSpeed = Math.abs(yawError) > Math.PI * 45 / 180 ? 0 : Math.min(8 * grip, cruiseSpeed);
    const aiAcceleration = THREE.MathUtils.clamp(targetSpeed - suspectFrame.forwardSpeed, -10, effectiveMode === "reversing" ? 3.5 : 5.5);
    const suspectMass = suspect.mass();
    suspect.applyImpulse({ x: suspectFrame.forwardX * suspectMass * aiAcceleration * dt, y: 0, z: suspectFrame.forwardZ * suspectMass * aiAcceleration * dt }, true);
    const aiLateral = -suspectFrame.lateralSpeed * suspectMass * Math.min(1, grip * 7 * dt * candidateControl);
    suspect.applyImpulse({ x: suspectFrame.rightX * aiLateral, y: 0, z: suspectFrame.rightZ * aiLateral }, true);

    const playerPosition = player.translation();
    const finalPlayerFrame = bodyFrame(player), finalSuspectFrame = bodyFrame(suspect);
    state.player = { x: playerPosition.x, z: playerPosition.z, yaw: finalPlayerFrame.yaw, speed: finalPlayerFrame.forwardSpeed, lateralSpeed: finalPlayerFrame.lateralSpeed };
    state.suspect = { x: suspectPosition.x, z: suspectPosition.z, yaw: finalSuspectFrame.yaw, speed: finalSuspectFrame.forwardSpeed, lateralSpeed: finalSuspectFrame.lateralSpeed };

    if (state.pitCandidate) {
      const outcome = evaluatePitOutcome(state.pitCandidate.startYaw, finalSuspectFrame.yaw, state.pitCandidate.startSpeed, Math.max(0, finalSuspectFrame.forwardSpeed), finalSuspectFrame.lateralSpeed);
      state.pit = outcome.progress;
      if (outcome.success) {
        state.result = "success";
        onFinish("success");
        return;
      }
      if (state.elapsed >= state.pitCandidate.expires) {
        state.pitCandidate = null;
        state.pit = 0;
      }
    }
    if (state.elapsed >= 60) {
      state.result = "failed";
      onFinish("failed");
      return;
    }
    lastUi.current += dt;
    if (lastUi.current >= .08) {
      lastUi.current = 0;
      onUpdate({
        speed: Math.max(0, finalPlayerFrame.forwardSpeed),
        distance: Math.hypot(suspectPosition.x - playerPosition.x, suspectPosition.z - playerPosition.z),
        pit: state.pit,
      });
    }
  });

  const playerSpec = VEHICLES[config.vehicle];
  return <>
    <RigidBody
      ref={playerRef}
      name="police-car"
      colliders={false}
      position={[0, .02, 8]}
      enabledTranslations={[true, false, true]}
      enabledRotations={[false, true, false]}
      linearDamping={.08}
      angularDamping={1.8}
      ccd
      canSleep={false}
      onCollisionEnter={handleVehicleCollision}
    >
      <CuboidCollider args={[playerSpec.width / 2, .48, playerSpec.length / 2]} mass={playerSpec.mass} friction={.68 * WEATHER[config.weather].grip} restitution={.08} contactSkin={.025} />
      <CarModel police model={config.vehicle} />
    </RigidBody>
    <RigidBody
      ref={suspectRef}
      name="suspect-car"
      colliders={false}
      position={[.8, .02, -24]}
      linearVelocity={[0, 0, -SCENES[config.scene].aiSpeed * .72]}
      enabledTranslations={[true, false, true]}
      enabledRotations={[false, true, false]}
      linearDamping={.06}
      angularDamping={.55}
      ccd
      canSleep={false}
    >
      <CuboidCollider args={[SUSPECT.width / 2, .48, SUSPECT.length / 2]} mass={SUSPECT.mass} friction={.66 * WEATHER[config.weather].grip} restitution={.08} contactSkin={.025} />
      <CarModel />
    </RigidBody>
  </>;
}

function ChaseScene({ config, runtime, keys, cameraMode, onUpdate, onFinish }: {
  config: MissionConfig;
  runtime: React.MutableRefObject<Runtime>;
  keys: React.MutableRefObject<Set<string>>;
  cameraMode: CameraMode;
  onUpdate: (data: { speed: number; distance: number; pit: number }) => void;
  onFinish: (result: "success" | "failed") => void;
}) {
  const fogColor = config.time === "night" ? SCENES[config.scene].fogNight : SCENES[config.scene].fogDay;
  return <>
    <color attach="background" args={[fogColor]} />
    <fog attach="fog" args={[fogColor, 28 * WEATHER[config.weather].visibility, 175 * WEATHER[config.weather].visibility]} />
    <ambientLight intensity={config.time === "night" ? .28 : 1.25} />
    <directionalLight castShadow position={[15, 28, 10]} intensity={config.time === "night" ? .35 : 2.2} color={config.time === "night" ? "#85a7d9" : "#fff1cc"} />
    <Physics gravity={[0, 0, 0]} timeStep={1 / 60} maxCcdSubsteps={4} numSolverIterations={8} paused={runtime.current.result !== "playing"}>
      <RoadWorld config={config} runtime={runtime} />
      <VehicleSimulation config={config} runtime={runtime} keys={keys} onUpdate={onUpdate} onFinish={onFinish} />
    </Physics>
    <Weather config={config} runtime={runtime} />
    <CameraRig runtime={runtime} mode={cameraMode} keys={keys} />
    <CockpitView mode={cameraMode} steering={keys} />
    <VehicleMirrors runtime={runtime} mode={cameraMode} />
  </>;
}

export function PitGame({ config, onExit }: { config: MissionConfig; onExit: () => void }) {
  const runtime = useRef<Runtime>(makeRuntime(config));
  const [runId, setRunId] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");
  const [result, setResult] = useState<Result>("playing");
  const [hud, setHud] = useState({ speed: 0, distance: 32, pit: 0, time: 60 });
  const cycleCamera = useCallback(() => setCameraMode((current) => CAMERA_ORDER[(CAMERA_ORDER.indexOf(current) + 1) % CAMERA_ORDER.length]), []);
  const togglePause = useCallback(() => setResult((current) => {
    if (current === "success" || current === "failed") return current;
    const next = current === "paused" ? "playing" : "paused";
    runtime.current.result = next;
    return next;
  }), []);
  const keys = useControls(cycleCamera, togglePause);
  useEffect(() => {
    const timer = window.setInterval(() => setHud((old) => ({ ...old, time: Math.max(0, 60 - runtime.current.elapsed) })), 100);
    return () => window.clearInterval(timer);
  }, []);
  const restart = () => {
    keys.current.clear();
    runtime.current = makeRuntime(config);
    setHud({ speed: 0, distance: 32, pit: 0, time: 60 });
    setCameraMode("chase");
    setResult("playing");
    setRunId((current) => current + 1);
  };
  return <main className="game-shell">
    <Canvas shadows camera={{ fov: 56, near: .1, far: 350 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
      <ChaseScene key={runId} config={config} runtime={runtime} keys={keys} cameraMode={cameraMode} onUpdate={(data) => setHud((old) => ({ ...old, ...data }))} onFinish={(value) => setResult(value)} />
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
