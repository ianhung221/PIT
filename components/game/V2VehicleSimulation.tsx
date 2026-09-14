"use client";
/* eslint-disable react-hooks/immutability -- Rapier state is intentionally updated inside the fixed physics loop. */

import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { VehicleModel } from "@/components/game/VehicleModel";
import type { V2Runtime, V2Result } from "@/components/game/v2Runtime";
import { logRuntimeEvent } from "@/components/game/v2Runtime";
import {
  PIT_RULES,
  SCENES,
  SUSPECT,
  VEHICLES,
  WEATHER,
  type CameraMode,
  type MissionConfig,
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
} from "@/lib/gameRules";
import { closestRoadSegment, roadTarget } from "@/lib/proceduralMap";
import { assessPitImpact } from "@/lib/pitSimulation";
import { coordinatePursuit, type PursuitAssignments } from "@/lib/pursuitCoordinator";
import { applyImpactDamage, vehicleCanContinue, vehicleDriveability } from "@/lib/vehicleDamage";
import type { MissionOutcome } from "@/types/game";
import type { PitAuthorization } from "@/types/game";

type BodyFrame = {
  yaw: number;
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
  velocityX: number;
  velocityZ: number;
  forwardSpeed: number;
  lateralSpeed: number;
};

export interface V2HudData {
  speed: number;
  distance: number;
  targetBearing: number;
  pit: number;
  suspectDriveability: number;
  playerDriveability: number;
  biome: MissionConfig["scene"];
  roadIndex: number;
  authorization: PitAuthorization;
  authorizationReason: string;
  assignments: PursuitAssignments;
}

interface FinishData {
  result: Exclude<V2Result, "playing" | "paused">;
  outcome: MissionOutcome;
}

interface SimulationProps {
  config: MissionConfig;
  cameraMode: CameraMode;
  runtime: MutableRefObject<V2Runtime>;
  keys: MutableRefObject<Set<string>>;
  onUpdate: (data: V2HudData) => void;
  onFinish: (data: FinishData) => void;
}

function desiredYawTo(fromX: number, fromZ: number, targetX: number, targetZ: number) {
  return Math.atan2(-(targetX - fromX), -(targetZ - fromZ));
}

function driveBodyToward(body: RapierRigidBody, targetX: number, targetZ: number, targetSpeed: number, dt: number, grip: number, frame: BodyFrame) {
  const position = body.translation();
  const desiredYaw = desiredYawTo(position.x, position.z, targetX, targetZ);
  const yawError = normalizeAngle(desiredYaw - frame.yaw);
  const angularTarget = THREE.MathUtils.clamp(yawError * 2.3, -.68, .68);
  const angular = body.angvel();
  body.setAngvel({ x: 0, y: THREE.MathUtils.lerp(angular.y, angularTarget, Math.min(1, dt * 3.2 * grip)), z: 0 }, true);
  const acceleration = THREE.MathUtils.clamp(targetSpeed - frame.forwardSpeed, -11, 5.8);
  const mass = body.mass();
  body.applyImpulse({ x: frame.forwardX * mass * acceleration * dt, y: 0, z: frame.forwardZ * mass * acceleration * dt }, true);
  const lateral = -frame.lateralSpeed * mass * Math.min(1, grip * 7 * dt);
  body.applyImpulse({ x: frame.rightX * lateral, y: 0, z: frame.rightZ * lateral }, true);
}

export function V2VehicleSimulation({ config, cameraMode, runtime, keys, onUpdate, onFinish }: SimulationProps) {
  const playerRef = useRef<RapierRigidBody>(null);
  const suspectRef = useRef<RapierRigidBody>(null);
  const support2Ref = useRef<RapierRigidBody>(null);
  const support3Ref = useRef<RapierRigidBody>(null);
  const lastUi = useRef(0);
  const temp = useMemo(() => ({
    quaternion: new THREE.Quaternion(),
    inverseQuaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    relative: new THREE.Vector3(),
    contact: new THREE.Vector3(),
    toward: new THREE.Vector3(),
    euler: new THREE.Euler(0, 0, 0, "YXZ"),
  }), []);

  const bodyFrame = useCallback((body: RapierRigidBody): BodyFrame => {
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

  const finish = (result: FinishData["result"], outcome: MissionOutcome) => {
    const state = runtime.current;
    if (state.result !== "playing") return;
    state.result = result;
    state.outcome = outcome;
    onFinish({ result, outcome });
  };

  const handleVehicleCollision = (event: CollisionEnterPayload) => {
    const player = playerRef.current;
    const suspect = suspectRef.current;
    if (!player || !suspect || event.other.rigidBody?.handle !== suspect.handle) return;
    const state = runtime.current;
    const playerPosition = player.translation();
    const suspectPosition = suspect.translation();
    const suspectRotation = suspect.rotation();
    const playerRotation = player.rotation();
    const playerVelocity = player.linvel();
    const suspectVelocity = suspect.linvel();
    temp.quaternion.set(suspectRotation.x, suspectRotation.y, suspectRotation.z, suspectRotation.w);
    temp.inverseQuaternion.copy(temp.quaternion).invert();
    temp.contact.set(playerPosition.x - suspectPosition.x, 0, playerPosition.z - suspectPosition.z).applyQuaternion(temp.inverseQuaternion);
    temp.toward.set(suspectPosition.x - playerPosition.x, 0, suspectPosition.z - playerPosition.z).normalize();
    temp.relative.set(playerVelocity.x - suspectVelocity.x, 0, playerVelocity.z - suspectVelocity.z);
    const closingSpeed = temp.relative.dot(temp.toward);
    temp.quaternion.set(playerRotation.x, playerRotation.y, playerRotation.z, playerRotation.w);
    const playerYaw = temp.euler.setFromQuaternion(temp.quaternion, "YXZ").y;
    temp.quaternion.set(suspectRotation.x, suspectRotation.y, suspectRotation.z, suspectRotation.w);
    const suspectYaw = temp.euler.setFromQuaternion(temp.quaternion, "YXZ").y;
    const contact = evaluatePitContact({
      localX: temp.contact.x,
      localZ: temp.contact.z,
      suspectHalfWidth: SUSPECT.width / 2,
      suspectHalfLength: SUSPECT.length / 2,
      closingSpeed,
      headingDelta: normalizeAngle(playerYaw - suspectYaw),
      cooldown: state.collisionCooldown,
      hasCandidate: state.pitCandidate !== null,
    });
    state.collisionCooldown = .5;
    const impact = Math.max(2, Math.abs(closingSpeed) * 1.7);
    state.suspectDamage = applyImpactDamage(state.suspectDamage, {
      impulse: impact,
      localX: temp.contact.x,
      localZ: temp.contact.z,
      halfWidth: SUSPECT.width / 2,
      halfLength: SUSPECT.length / 2,
    });
    state.playerDamage = applyImpactDamage(state.playerDamage, {
      impulse: impact * .72,
      localX: -temp.contact.x,
      localZ: -temp.contact.z,
      halfWidth: VEHICLES[config.vehicle].width / 2,
      halfLength: VEHICLES[config.vehicle].length / 2,
    });
    if (!contact.valid || contact.side === 0) {
      logRuntimeEvent(state, "一般碰撞：未形成有效 PIT 接觸");
      return;
    }
    state.attempts += 1;
    const assessment = assessPitImpact({
      localX: temp.contact.x,
      localZ: temp.contact.z,
      halfWidth: SUSPECT.width / 2,
      halfLength: SUSPECT.length / 2,
      relativeSpeed: closingSpeed,
      headingDelta: normalizeAngle(playerYaw - suspectYaw),
      effectiveMass: (player.mass() * suspect.mass()) / Math.max(.1, player.mass() + suspect.mass()),
      roadGrip: WEATHER[config.weather].grip,
      authorized: state.authorization === "authorized",
    });
    if (assessment.classification !== "effective") {
      state.unsafeContacts += 1;
      state.outcome = "unsafe-pit";
      logRuntimeEvent(state, assessment.reason + "：不列入有效 PIT");
      return;
    }
    const quality = assessment.quality;
    const suspectFrame = bodyFrame(suspect);
    state.pitCandidate = {
      startYaw: suspectFrame.yaw,
      startSpeed: Math.max(1, suspectFrame.forwardSpeed),
      expires: state.elapsed + PIT_RULES.evaluationWindow,
      side: contact.side,
      authorized: true,
      quality,
    };
    state.pit = 18;
    const torqueCompensation = THREE.MathUtils.clamp(assessment.yawTorque * .32, .35, 1.35);
    suspect.applyTorqueImpulse({ x: 0, y: contact.side * (torqueCompensation / WEATHER[config.weather].grip), z: 0 }, true);
    logRuntimeEvent(state, "PIT 接觸成立：正在評估旋轉與減速");
  };

  useBeforePhysicsStep((world) => {
    const player = playerRef.current;
    const suspect = suspectRef.current;
    const support2 = support2Ref.current;
    const support3 = support3Ref.current;
    const state = runtime.current;
    if (!player || !suspect || !support2 || !support3 || state.result !== "playing") return;
    const dt = world.timestep;
    state.elapsed += dt;
    state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
    const grip = WEATHER[config.weather].grip;
    const playerSpec = VEHICLES[config.vehicle];
    const playerFrame = bodyFrame(player);
    const throttle = keys.current.has("arrowup") || keys.current.has("w");
    const brake = keys.current.has("arrowdown") || keys.current.has("s");
    const steer = steeringInput(keys.current.has("arrowleft") || keys.current.has("a"), keys.current.has("arrowright") || keys.current.has("d"));
    const playerDriveability = vehicleDriveability(state.playerDamage);
    const playerMass = player.mass();
    if (throttle) {
      const force = playerSpec.acceleration * grip * (.42 + playerDriveability * .58);
      player.applyImpulse({ x: playerFrame.forwardX * playerMass * force * dt, y: 0, z: playerFrame.forwardZ * playerMass * force * dt }, true);
    }
    if (brake) {
      const braking = playerFrame.forwardSpeed > .8 ? -Math.min(playerFrame.forwardSpeed, 24 * grip * dt) : -7 * grip * dt;
      player.applyImpulse({ x: playerFrame.forwardX * playerMass * braking, y: 0, z: playerFrame.forwardZ * playerMass * braking }, true);
    }
    const lateralCorrection = -playerFrame.lateralSpeed * playerMass * Math.min(1, grip * 8 * dt * (.45 + state.playerDamage.alignment * .55));
    player.applyImpulse({ x: playerFrame.rightX * lateralCorrection, y: 0, z: playerFrame.rightZ * lateralCorrection }, true);
    player.applyImpulse({ x: -playerFrame.velocityX * playerMass * .12 * dt, y: 0, z: -playerFrame.velocityZ * playerMass * .12 * dt }, true);
    const speedFactor = THREE.MathUtils.clamp(Math.abs(playerFrame.forwardSpeed) / 13, .12, 1);
    const steeringHealth = state.playerDamage.steering * state.playerDamage.alignment;
    const desiredTurn = -steer * playerSpec.steering * grip * speedFactor * steeringHealth * (playerFrame.forwardSpeed >= 0 ? 1 : -1);
    const playerAngular = player.angvel();
    player.setAngvel({ x: 0, y: THREE.MathUtils.lerp(playerAngular.y, desiredTurn, Math.min(1, dt * 8)), z: 0 }, true);
    const velocityAfter = player.linvel();
    const playerLimit = playerSpec.maxSpeed * (.52 + state.playerDamage.engine * .48);
    const playerPlanarSpeed = Math.hypot(velocityAfter.x, velocityAfter.z);
    if (playerPlanarSpeed > playerLimit) {
      const scale = playerLimit / playerPlanarSpeed;
      player.setLinvel({ x: velocityAfter.x * scale, y: 0, z: velocityAfter.z * scale }, true);
    }

    const suspectPosition = suspect.translation();
    const suspectFrame = bodyFrame(suspect);
    state.suspectRoadIndex = closestRoadSegment(state.road, suspectPosition.x, suspectPosition.z, state.suspectRoadIndex);
    const segment = state.road.segments[state.suspectRoadIndex];
    const targetSegment = roadTarget(state.road, state.suspectRoadIndex, 2);
    const roadHalfWidth = segment.width / 2 - 1.25;
    const segmentRightX = Math.cos(segment.yaw);
    const segmentRightZ = -Math.sin(segment.yaw);
    const localRoadX = (suspectPosition.x - segment.x) * segmentRightX + (suspectPosition.z - segment.z) * segmentRightZ;
    const laneWave = Math.sin(state.elapsed * .38) * Math.min(2, roadHalfWidth * .34);
    const boundaryPressure = Math.abs(localRoadX) > roadHalfWidth * .72
      ? THREE.MathUtils.clamp(-localRoadX / roadHalfWidth, -1, 1) * Math.min(3.2, roadHalfWidth * .42)
      : 0;
    const laneTarget = THREE.MathUtils.clamp(laneWave + boundaryPressure, -roadHalfWidth * .7, roadHalfWidth * .7);
    const targetX = targetSegment.x + Math.cos(targetSegment.yaw) * laneTarget;
    const targetZ = targetSegment.z - Math.sin(targetSegment.yaw) * laneTarget;
    const desiredYaw = desiredYawTo(suspectPosition.x, suspectPosition.z, targetX, targetZ);
    const yawError = normalizeAngle(desiredYaw - suspectFrame.yaw);
    const planarSuspectSpeed = Math.hypot(suspectFrame.velocityX, suspectFrame.velocityZ);
    const boundaryRatio = Math.abs(localRoadX) / Math.max(.1, roadHalfWidth);
    const ai = state.suspectAi;
    const looksStuck = planarSuspectSpeed < SUSPECT_RECOVERY.stuckSpeed
      && (boundaryRatio >= .72 || Math.abs(yawError) >= Math.PI * 48 / 180 || suspectFrame.forwardSpeed < -.5);
    ai.stalledFor = !state.pitCandidate && looksStuck ? ai.stalledFor + dt : Math.max(0, ai.stalledFor - dt * 2);
    if (ai.mode === "driving" && !state.pitQualified && isSuspectRecoveryNeeded({
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
      logRuntimeEvent(state, "嫌犯受阻：AI 開始煞停、倒車與轉正");
    }
    if (ai.mode !== "driving" && !state.pitCandidate && !state.pitQualified) {
      ai.modeElapsed += dt;
      const nextMode = nextSuspectRecoveryMode(ai.mode, ai.modeElapsed, yawError, suspectFrame.forwardSpeed);
      if (nextMode !== ai.mode) {
        ai.mode = nextMode;
        ai.modeElapsed = 0;
        if (nextMode === "driving") ai.stalledFor = 0;
      }
    }
    const suspectDriveability = vehicleDriveability(state.suspectDamage);
    const suspectCanDrive = vehicleCanContinue(state.suspectDamage);
    const tireGrip = (state.suspectDamage.frontLeftGrip + state.suspectDamage.frontRightGrip + state.suspectDamage.rearLeftGrip + state.suspectDamage.rearRightGrip) / 4;
    const candidateControl = state.pitCandidate ? .18 : 1;
    const effectiveMode = state.pitCandidate || state.pitQualified ? "driving" : ai.mode;
    const steeringYaw = effectiveMode === "reversing" ? suspectReverseEscapeYaw(localRoadX) : desiredYaw;
    const steeringYawError = normalizeAngle(steeringYaw - suspectFrame.yaw);
    const turnLimit = effectiveMode === "reversing" ? .88 : effectiveMode === "realigning" ? .66 : .7;
    const targetAngular = THREE.MathUtils.clamp(steeringYawError * (effectiveMode === "reversing" ? 3.2 : 2.6), -turnLimit, turnLimit);
    const suspectAngular = suspect.angvel();
    const suspectSteering = state.suspectDamage.steering * state.suspectDamage.alignment;
    suspect.setAngvel({
      x: 0,
      y: THREE.MathUtils.lerp(suspectAngular.y, targetAngular * suspectSteering, Math.min(1, dt * 2.7 * grip * candidateControl)),
      z: 0,
    }, true);
    const distanceToPlayer = Math.hypot(suspectPosition.x - state.player.x, suspectPosition.z - state.player.z);
    const pursuitBoost = distanceToPlayer < 17 ? 3 : 0;
    const baseCruise = SCENES[segment.biome].aiSpeed * (.84 + grip * .16) + pursuitBoost;
    let suspectTargetSpeed = baseCruise * suspectForwardSpeedScale(yawError) * (.45 + suspectDriveability * .55);
    if (!suspectCanDrive || state.pitCandidate || (state.pitQualified && state.containmentElapsed < 3.2)) suspectTargetSpeed = 0;
    if (effectiveMode === "braking") suspectTargetSpeed = 0;
    if (effectiveMode === "reversing") suspectTargetSpeed = -6 * grip;
    if (effectiveMode === "realigning") suspectTargetSpeed = Math.abs(yawError) > Math.PI * 45 / 180 ? 0 : Math.min(8 * grip, suspectTargetSpeed);
    const suspectAcceleration = THREE.MathUtils.clamp(suspectTargetSpeed - suspectFrame.forwardSpeed, -10, effectiveMode === "reversing" ? 3.5 : 5.5);
    const suspectMass = suspect.mass();
    suspect.applyImpulse({
      x: suspectFrame.forwardX * suspectMass * suspectAcceleration * dt,
      y: 0,
      z: suspectFrame.forwardZ * suspectMass * suspectAcceleration * dt,
    }, true);
    const suspectLateral = -suspectFrame.lateralSpeed * suspectMass * Math.min(1, grip * tireGrip * 7 * dt * candidateControl);
    suspect.applyImpulse({ x: suspectFrame.rightX * suspectLateral, y: 0, z: suspectFrame.rightZ * suspectLateral }, true);

    if (state.pitCandidate) {
      const outcome = evaluatePitOutcome(
        state.pitCandidate.startYaw,
        suspectFrame.yaw,
        state.pitCandidate.startSpeed,
        Math.max(0, suspectFrame.forwardSpeed),
        suspectFrame.lateralSpeed,
      );
      state.pit = outcome.progress;
      if (outcome.success) {
        const candidate = state.pitCandidate;
        state.suspectDamage = applyImpactDamage(state.suspectDamage, {
          impulse: 14 + candidate.quality * 8,
          localX: candidate.side * SUSPECT.width * .48,
          localZ: SUSPECT.length * .38,
          halfWidth: SUSPECT.width / 2,
          halfLength: SUSPECT.length / 2,
        });
        state.pitCandidate = null;
        state.pitQualified = true;
        state.containmentElapsed = 0;
        state.successfulContacts += 1;
        state.outcome = vehicleCanContinue(state.suspectDamage) ? "stopped-mobile" : "disabled";
        logRuntimeEvent(state, vehicleCanContinue(state.suspectDamage) ? "有效 PIT：嫌犯車仍可行駛，後援開始包圍" : "有效 PIT：嫌犯車已失去行動能力");
      } else if (state.elapsed >= state.pitCandidate.expires) {
        state.pitCandidate = null;
        state.pit = 0;
        logRuntimeEvent(state, "PIT 未達旋轉／減速門檻，繼續追捕");
      }
    }
    if (state.pitQualified) state.containmentElapsed += dt;

    const suspectSlow = Math.abs(suspectFrame.forwardSpeed) < 4.2;
    const assignments = coordinatePursuit({
      command: state.command,
      pitQualified: state.pitQualified,
      suspectStopped: suspectSlow,
      suspectDriveable: suspectCanDrive,
      playerDriveability,
    });
    state.supports[0].role = assignments.unit2;
    state.supports[1].role = assignments.unit3;
    const playerPosition = player.translation();
    const frontX = suspectPosition.x + suspectFrame.forwardX * 6.2;
    const frontZ = suspectPosition.z + suspectFrame.forwardZ * 6.2;
    const rearX = suspectPosition.x - suspectFrame.forwardX * 5.4;
    const rearZ = suspectPosition.z - suspectFrame.forwardZ * 5.4;
    const support2Frame = bodyFrame(support2);
    const support3Frame = bodyFrame(support3);
    const containment = assignments.phase === "containment";
    const support2Target = containment
      ? { x: frontX + suspectFrame.rightX * 2.6, z: frontZ + suspectFrame.rightZ * 2.6, speed: suspectSlow ? 4 : baseCruise + 4 }
      : assignments.unit2 === "primary"
        ? { x: suspectPosition.x - suspectFrame.forwardX * 7, z: suspectPosition.z - suspectFrame.forwardZ * 7, speed: baseCruise + 2 }
      : { x: playerPosition.x + playerFrame.rightX * 2.5 - playerFrame.forwardX * 8, z: playerPosition.z + playerFrame.rightZ * 2.5 - playerFrame.forwardZ * 8, speed: Math.max(9, playerFrame.forwardSpeed + 2) };
    const support3Target = containment
      ? { x: rearX - suspectFrame.rightX * 1.1, z: rearZ - suspectFrame.rightZ * 1.1, speed: suspectSlow ? 3 : baseCruise + 2 }
      : { x: playerPosition.x - playerFrame.rightX * 2.2 - playerFrame.forwardX * 16, z: playerPosition.z - playerFrame.rightZ * 2.2 - playerFrame.forwardZ * 16, speed: Math.max(8, playerFrame.forwardSpeed + 1) };
    driveBodyToward(support2, support2Target.x, support2Target.z, support2Target.speed, dt, grip, support2Frame);
    driveBodyToward(support3, support3Target.x, support3Target.z, support3Target.speed, dt, grip, support3Frame);

    const support2Position = support2.translation();
    const support3Position = support3.translation();
    const frontDistance = Math.hypot(support2Position.x - frontX, support2Position.z - frontZ);
    const rearDistance = Math.hypot(support3Position.x - rearX, support3Position.z - rearZ);
    if (state.pitQualified && !suspectCanDrive && suspectSlow && state.containmentElapsed > 1.2) {
      finish("success", "disabled");
      return;
    }
    if (state.pitQualified && suspectSlow && frontDistance < 7.5 && rearDistance < 7.5 && state.containmentElapsed > 1.4) {
      finish("success", "contained");
      return;
    }
    if (state.pitQualified && suspectCanDrive && state.containmentElapsed > 8 && Math.abs(suspectFrame.forwardSpeed) > 8 && Math.min(frontDistance, rearDistance) > 9) {
      state.pitQualified = false;
      state.pit = 0;
      state.outcome = "escaped-containment";
      state.authorization = "unknown";
      state.authorizationReason = "嫌犯重新逃逸，需重新評估 PIT 條件";
      state.command = null;
      logRuntimeEvent(state, "包圍失敗：嫌犯仍可駕駛並再次逃逸");
    }

    const finalPlayerFrame = bodyFrame(player);
    const finalSuspectFrame = bodyFrame(suspect);
    const finalSupport2Frame = bodyFrame(support2);
    const finalSupport3Frame = bodyFrame(support3);
    state.playerRoadIndex = closestRoadSegment(state.road, playerPosition.x, playerPosition.z, state.playerRoadIndex);
    state.player = { x: playerPosition.x, z: playerPosition.z, yaw: finalPlayerFrame.yaw, speed: finalPlayerFrame.forwardSpeed, lateralSpeed: finalPlayerFrame.lateralSpeed };
    state.suspect = { x: suspectPosition.x, z: suspectPosition.z, yaw: finalSuspectFrame.yaw, speed: finalSuspectFrame.forwardSpeed, lateralSpeed: finalSuspectFrame.lateralSpeed };
    state.supports[0] = { ...state.supports[0], x: support2Position.x, z: support2Position.z, yaw: finalSupport2Frame.yaw, speed: finalSupport2Frame.forwardSpeed, lateralSpeed: finalSupport2Frame.lateralSpeed };
    state.supports[1] = { ...state.supports[1], x: support3Position.x, z: support3Position.z, yaw: finalSupport3Frame.yaw, speed: finalSupport3Frame.forwardSpeed, lateralSpeed: finalSupport3Frame.lateralSpeed };

    if (state.elapsed >= 90) {
      finish("failed", "failed");
      return;
    }
    lastUi.current += dt;
    if (lastUi.current >= .1) {
      lastUi.current = 0;
      onUpdate({
        speed: Math.max(0, finalPlayerFrame.forwardSpeed),
        distance: Math.hypot(suspectPosition.x - playerPosition.x, suspectPosition.z - playerPosition.z),
        targetBearing: Math.atan2(
          (suspectPosition.x - playerPosition.x) * finalPlayerFrame.rightX + (suspectPosition.z - playerPosition.z) * finalPlayerFrame.rightZ,
          (suspectPosition.x - playerPosition.x) * finalPlayerFrame.forwardX + (suspectPosition.z - playerPosition.z) * finalPlayerFrame.forwardZ,
        ),
        pit: state.pit,
        suspectDriveability: vehicleDriveability(state.suspectDamage),
        playerDriveability,
        biome: state.road.segments[state.playerRoadIndex].biome,
        roadIndex: state.playerRoadIndex,
        authorization: state.authorization,
        authorizationReason: state.authorizationReason,
        assignments,
      });
    }
  });

  const playerSpec = VEHICLES[config.vehicle];
  return <>
    <RigidBody
      ref={playerRef}
      name="police-primary"
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
      <VehicleModel police model={config.vehicle} unit="01" hideExterior={cameraMode === "driver"} />
    </RigidBody>
    <RigidBody
      ref={suspectRef}
      name="suspect"
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
      <VehicleModel />
    </RigidBody>
    <RigidBody
      ref={support2Ref}
      name="police-support-2"
      colliders={false}
      position={[-2.1, .02, 18]}
      enabledTranslations={[true, false, true]}
      enabledRotations={[false, true, false]}
      linearDamping={.09}
      angularDamping={1.5}
      ccd
      canSleep={false}
    >
      <CuboidCollider args={[VEHICLES.patrol.width / 2, .48, VEHICLES.patrol.length / 2]} mass={VEHICLES.patrol.mass} friction={.67 * WEATHER[config.weather].grip} restitution={.06} />
      <VehicleModel police model="patrol" unit="02" />
    </RigidBody>
    <RigidBody
      ref={support3Ref}
      name="police-support-3"
      colliders={false}
      position={[2.1, .02, 29]}
      enabledTranslations={[true, false, true]}
      enabledRotations={[false, true, false]}
      linearDamping={.1}
      angularDamping={1.6}
      ccd
      canSleep={false}
    >
      <CuboidCollider args={[VEHICLES.suv.width / 2, .5, VEHICLES.suv.length / 2]} mass={VEHICLES.suv.mass} friction={.69 * WEATHER[config.weather].grip} restitution={.05} />
      <VehicleModel police model="suv" unit="03" />
    </RigidBody>
  </>;
}
