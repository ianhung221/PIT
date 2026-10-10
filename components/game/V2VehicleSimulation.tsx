"use client";
/* eslint-disable react-hooks/immutability -- Rapier state is intentionally updated inside the fixed physics loop. */

import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useAfterPhysicsStep,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { VehicleModel } from "@/components/game/VehicleModel";
import type { V2Runtime, V2Result } from "@/components/game/v2Runtime";
import { logRuntimeEvent, updateRadioFeedback, refreshPitAuthorization } from "@/components/game/v2Runtime";
import {
  SCENES,
  SUSPECT,
  VEHICLES,
  WEATHER,
  vehicleColliderStrips,
  type CameraMode,
  type MissionConfig,
} from "@/lib/gameConfig";
import {
  isSuspectRecoveryNeeded,
  nextSuspectRecoveryMode,
  normalizeAngle,
  SUSPECT_RECOVERY,
  steeringInput,
  suspectForwardSpeedScale,
  suspectReverseEscapeYaw,
} from "@/lib/gameRules";
import { closestRoadSegment, roadTarget } from "@/lib/proceduralMap";
import { classifyPhysicalContact, localPoint, physicalPitOutcome, pitMissionResolution, V2_PIT, type ContactFeedback } from "@/lib/pitContact";
import { suspectRoadCruise } from "@/lib/pitPolicy";
import { coordinatePursuit, tacticalFeedback, COMMAND_LABELS, RADIO_PHASE_LABELS, type PursuitAssignments } from "@/lib/pursuitCoordinator";
import { stepSupportAI, supportSlot } from "@/lib/supportUnitAI";
import { driveSupport } from "@/lib/supportDriving";
import { stepBlockade, blockadeControl, blockadeFeedback, missBlockade, containmentPose } from "@/lib/supportContainment";
import { applyImpactDamage, vehicleCanContinue, vehicleDriveability } from "@/lib/vehicleDamage";
import type { MissionOutcome, RadioFeedback, RadioCommand } from "@/types/game";
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
  radioFeedback: RadioFeedback | null;
  tacticalCommand: RadioCommand | null;
  contactFeedback: ContactFeedback | null;
  authorizationExpires: number;
  missionStage: MissionOutcome;
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

export function V2VehicleSimulation({ config, cameraMode, runtime, keys, onUpdate, onFinish }: SimulationProps) {
  const playerRef = useRef<RapierRigidBody>(null);
  const suspectRef = useRef<RapierRigidBody>(null);
  const support2Ref = useRef<RapierRigidBody>(null);
  const support3Ref = useRef<RapierRigidBody>(null);
  const lastUi = useRef(0);
  const preImpact = useRef<{player: BodyFrame; suspect: BodyFrame} | null>(null);
  const activeContacts = useRef(new Set<string>());
  const temp = useMemo(() => ({
    quaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
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

  const handleVehicleCollision = (event: Pick<CollisionEnterPayload, "manifold"> & {other: {rigidBody: {handle: number}}}) => {
    const player = playerRef.current;
    const suspect = suspectRef.current;
    if (!player || !suspect || event.other.rigidBody?.handle !== suspect.handle) return;
    const state = runtime.current;
    if (state.result !== "playing" || state.collisionCooldown > 0 || state.pitCandidate) return;
    const manifold = event.manifold;
    if (!manifold.numSolverContacts()) {
      state.contactFeedback = { classification: "scrape", message: "一般碰撞：接觸資料不足，不列入 PIT", at: state.elapsed };
      return;
    }
    // Solver contacts are world-space points; flipped does not affect them.
    // Average the actual face instead of selecting a favourable rear-most point.
    let x = 0, z = 0;
    for (let i = 0; i < manifold.numSolverContacts(); i++) {
      const point = manifold.solverContactPoint(i); x += point.x; z += point.z;
    }
    x /= manifold.numSolverContacts(); z /= manifold.numSolverContacts();
    const playerPosition = player.translation();
    const suspectPosition = suspect.translation();
    const playerFrame = bodyFrame(player), suspectFrame = bodyFrame(suspect);
    const previous = preImpact.current ?? { player: playerFrame, suspect: suspectFrame };
    const local = localPoint({x:suspectPosition.x,z:suspectPosition.z,yaw:suspectFrame.yaw}, {x,z});
    const playerLocal = localPoint({x:playerPosition.x,z:playerPosition.z,yaw:playerFrame.yaw}, {x,z});
    const normal = manifold.normal();
    const sign = normal.x * (suspectPosition.x - playerPosition.x) + normal.z * (suspectPosition.z - playerPosition.z) >= 0 ? 1 : -1;
    const nx = normal.x * sign, nz = normal.z * sign;
    const dx = previous.player.velocityX - previous.suspect.velocityX;
    const dz = previous.player.velocityZ - previous.suspect.velocityZ;
    const closingSpeed = Math.hypot(dx, dz), normalSpeed = Math.max(0, dx * nx + dz * nz);
    refreshPitAuthorization(state, config, { ...state.suspect, speed: previous.suspect.forwardSpeed, lateralSpeed: previous.suspect.lateralSpeed }, true);
    const assessment = classifyPhysicalContact({ localX:local.x, localZ:local.z, playerLocalX:playerLocal.x, playerLocalZ:playerLocal.z,
      normalSide:nx * suspectFrame.rightX + nz * suspectFrame.rightZ, closingSpeed, normalSpeed,
      headingDelta:normalizeAngle(previous.player.yaw - previous.suspect.yaw), halfWidth:SUSPECT.width/2, halfLength:SUSPECT.length/2,
      playerHalfLength:VEHICLES[config.vehicle].length/2,
      authorized:state.authorization === "authorized" && state.authorizationExpires >= state.elapsed });
    state.collisionCooldown = .5;
    const impact = Math.max(2, normalSpeed * 2);
    state.suspectDamage = applyImpactDamage(state.suspectDamage, {
      impulse: impact,
      localX: local.x,
      localZ: local.z,
      halfWidth: SUSPECT.width / 2,
      halfLength: SUSPECT.length / 2,
    });
    state.playerDamage = applyImpactDamage(state.playerDamage, {
      impulse: impact * .72,
      localX: playerLocal.x,
      localZ: playerLocal.z,
      halfWidth: VEHICLES[config.vehicle].width / 2,
      halfLength: VEHICLES[config.vehicle].length / 2,
    });
    state.contactFeedback = { classification: assessment.classification, message: assessment.reason, at: state.elapsed };
    logRuntimeEvent(state, assessment.reason);
    if (assessment.classification === "scrape") return;
    state.attempts += 1;
    if (assessment.classification !== "effective") {
      state.unsafeContacts += 1;
      state.outcome = "unsafe-pit";
      return;
    }
    state.pitCandidate = {
      startYaw: previous.suspect.yaw,
      startSpeed: Math.hypot(previous.suspect.velocityX, previous.suspect.velocityZ),
      expires: state.elapsed + V2_PIT.window,
      side: local.x > 0 ? 1 : -1,
      authorized: true,
      quality: Math.min(1, normalSpeed / 5),
      contactTime: 1 / 60,
    };
    state.pit = 18;
    logRuntimeEvent(state, "PIT 接觸成立：正在評估旋轉與減速");
  };

  // Frame-batched collision events may report a later contact after several
  // substeps. Sample each fixed step with its matching pre-impact velocity.
  useAfterPhysicsStep(world => {
    const player = playerRef.current, suspect = suspectRef.current;
    if (!player || !suspect || runtime.current.result !== "playing") return;
    const touching = new Set<string>();
    for (let i = 0; i < player.numColliders(); i++) for (let j = 0; j < suspect.numColliders(); j++) {
      const key = `${i}:${j}`;
      world.contactPair(player.collider(i), suspect.collider(j), manifold => {
        if (!manifold.numSolverContacts()) return;
        touching.add(key);
        if (!activeContacts.current.has(key)) handleVehicleCollision({manifold, other:{rigidBody:{handle:suspect.handle}}});
      });
    }
    activeContacts.current = touching;
  });

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
    preImpact.current = { player: playerFrame, suspect: bodyFrame(suspect) };
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
    refreshPitAuthorization(state, config, { ...state.suspect, speed:suspectFrame.forwardSpeed, lateralSpeed:suspectFrame.lateralSpeed });
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
    if (ai.mode === "driving" && !(state.pitQualified && state.containmentElapsed < 3.2) && isSuspectRecoveryNeeded({
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
    if (ai.mode !== "driving" && !state.pitCandidate && !(state.pitQualified && state.containmentElapsed < 3.2)) {
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
    const effectiveMode = state.pitCandidate || (state.pitQualified && state.containmentElapsed < 3.2) ? "driving" : ai.mode;
    const steeringYaw = effectiveMode === "reversing" ? suspectReverseEscapeYaw(localRoadX) : desiredYaw;
    const steeringYawError = normalizeAngle(steeringYaw - suspectFrame.yaw);
    const turnLimit = effectiveMode === "reversing" ? .88 : effectiveMode === "realigning" ? .66 : .7;
    const targetAngular = THREE.MathUtils.clamp(steeringYawError * (effectiveMode === "reversing" ? 3.2 : 2.6), -turnLimit, turnLimit);
    const suspectAngular = suspect.angvel();
    const suspectSteering = state.suspectDamage.steering * state.suspectDamage.alignment;
    // Do not overwrite the collision-generated yaw rate during evaluation.
    // Road-following angular velocity is a controller, not tyre physics.
    if (!state.pitCandidate) suspect.setAngvel({
      x: 0,
      y: THREE.MathUtils.lerp(suspectAngular.y, targetAngular * suspectSteering, Math.min(1, dt * 2.7 * grip * candidateControl)),
      z: 0,
    }, true);
    const distanceToPlayer = Math.hypot(suspectPosition.x - state.player.x, suspectPosition.z - state.player.z);
    const pursuitBoost = distanceToPlayer < 17 ? 3 : 0;
    const baseCruise = suspectRoadCruise(segment, roadTarget(state.road, state.suspectRoadIndex, 1), grip, pursuitBoost);
    let suspectTargetSpeed = baseCruise * suspectForwardSpeedScale(yawError) * (.45 + suspectDriveability * .55);
    if (!suspectCanDrive || (state.pitQualified && state.containmentElapsed < 3.2)) suspectTargetSpeed = 0;
    if (effectiveMode === "braking") suspectTargetSpeed = 0;
    if (effectiveMode === "reversing") suspectTargetSpeed = -6 * grip;
    if (effectiveMode === "realigning") suspectTargetSpeed = Math.abs(yawError) > Math.PI * 45 / 180 ? 0 : Math.min(8 * grip, suspectTargetSpeed);
    // During impact evaluation the driver coasts; no forced brake or bonus spin.
    const suspectAcceleration = state.pitCandidate ? 0 : THREE.MathUtils.clamp(suspectTargetSpeed - suspectFrame.forwardSpeed, -10, effectiveMode === "reversing" ? 3.5 : 5.5);
    const suspectMass = suspect.mass();
    suspect.applyImpulse({
      x: suspectFrame.forwardX * suspectMass * suspectAcceleration * dt,
      y: 0,
      z: suspectFrame.forwardZ * suspectMass * suspectAcceleration * dt,
    }, true);
    const suspectLateral = -suspectFrame.lateralSpeed * suspectMass * Math.min(1, grip * tireGrip * 7 * dt * candidateControl);
    suspect.applyImpulse({ x: suspectFrame.rightX * suspectLateral, y: 0, z: suspectFrame.rightZ * suspectLateral }, true);

    if (state.pitCandidate) {
      let touching = false;
      for (let i = 0; i < player.numColliders(); i++) for (let j = 0; j < suspect.numColliders(); j++) {
        world.contactPair(player.collider(i), suspect.collider(j), m => { if (m.numSolverContacts() > 0) touching = true; });
      }
      if (touching) state.pitCandidate.contactTime += dt;
      const outcome = physicalPitOutcome(
        state.pitCandidate.startYaw,
        suspectFrame.yaw,
        state.pitCandidate.startSpeed,
        planarSuspectSpeed,
        suspectFrame.lateralSpeed,
        state.pitCandidate.contactTime,
      );
      state.pit = outcome.progress;
      if (outcome.success) {
        state.pitCandidate = null;
        state.pitQualified = true;
        state.containmentElapsed = 0;
        state.heldFor = 0;
        state.successfulContacts += 1;
        state.outcome = vehicleCanContinue(state.suspectDamage) ? "stopped-mobile" : "disabled";
        state.contactFeedback = { classification: "effective", message: "有效 PIT：失控已確認，尚待控制嫌犯", at:state.elapsed };
        logRuntimeEvent(state, vehicleCanContinue(state.suspectDamage) ? "有效 PIT：嫌犯車仍可行駛，後援開始包圍" : "有效 PIT：嫌犯車已失去行動能力");
      } else if (state.elapsed >= state.pitCandidate.expires) {
        state.pitCandidate = null;
        state.pit = 0;
        state.contactFeedback = { classification:"scrape", message:"接觸未造成足夠失控，繼續追逐", at:state.elapsed };
        logRuntimeEvent(state, "PIT 未達旋轉／減速門檻，繼續追捕");
      }
    }
    if (state.pitQualified) state.containmentElapsed += dt;

    const suspectSlow = planarSuspectSpeed < 4.2;
    const playerPosition = player.translation();
    const currentPlayer = { ...state.player, x: playerPosition.x, z: playerPosition.z, yaw: playerFrame.yaw, speed: playerFrame.forwardSpeed, lateralSpeed: playerFrame.lateralSpeed };
    const currentSuspect = { ...state.suspect, x: suspectPosition.x, z: suspectPosition.z, yaw: suspectFrame.yaw, speed: suspectFrame.forwardSpeed, lateralSpeed: suspectFrame.lateralSpeed };
    const automaticBlockade = !state.tacticalCommand && state.pitQualified;
    const activeBlockade = state.tacticalCommand === "block-front" || automaticBlockade;
    if (activeBlockade) {
      stepBlockade(state.blockade, { road: state.road, index: state.suspectRoadIndex, suspect: currentSuspect, supports: state.supports, player: currentPlayer, dt });
    }
    const assignments = coordinatePursuit({
      command: automaticBlockade ? "block-front" : state.tacticalCommand,
      pitQualified: state.pitQualified,
      suspectStopped: state.tacticalCommand === "block-front" ? Math.hypot(suspectFrame.forwardSpeed, suspectFrame.lateralSpeed) < 4.2 : suspectSlow,
      suspectDriveable: suspectCanDrive,
      playerDriveability,
      blockadePhase: state.blockade.phase,
    });
    state.supports[0].role = assignments.unit2;
    state.supports[1].role = assignments.unit3;
    state.playerRoadIndex = closestRoadSegment(state.road, playerPosition.x, playerPosition.z, state.playerRoadIndex);
    [support2, support3].forEach((body, unit) => {
      const frame = bodyFrame(body), position = body.translation();
      const index = closestRoadSegment(state.road, position.x, position.z, state.supportRoadIndices[unit]);
      const car = { x: position.x, z: position.z, yaw: frame.yaw, speed: frame.forwardSpeed, lateralSpeed: frame.lateralSpeed };
      const slot = supportSlot({ road: state.road, player: currentPlayer, suspect: currentSuspect, playerIndex: state.playerRoadIndex, suspectIndex: state.suspectRoadIndex, unit, role: unit === 0 ? assignments.unit2 : assignments.unit3, command: automaticBlockade ? "block-front" : state.tacticalCommand });
      const neighbors = [currentPlayer, currentSuspect, state.supports[1 - unit]];
      const maneuver = activeBlockade && state.supportAi[unit].mode === "driving"
        ? blockadeControl(state.blockade, unit as 0 | 1, car, currentSuspect, neighbors, state.road, dt, grip) : null;
      const control = maneuver ?? stepSupportAI(state.supportAi[unit], { car, road: state.road, index, slot, dt, grip, maxSpeed: unit === 0 ? VEHICLES.patrol.maxSpeed : VEHICLES.suv.maxSpeed, neighbors });
      if (maneuver) { state.supportAi[unit].lastX = car.x; state.supportAi[unit].lastZ = car.z; state.supportAi[unit].stalledFor = 0; }
      driveSupport(body, control.yawError, control.speed, unit === 0 ? VEHICLES.patrol.maxSpeed : VEHICLES.suv.maxSpeed, dt, grip, frame);
      state.supportArrivedFor[unit] = control.arrived ? state.supportArrivedFor[unit] + dt : 0;
      if (control.modeChanged) logRuntimeEvent(state, `0${unit + 2} 後援：${{ driving: "已脫困，重新加入追逐", braking: "受阻煞停", reversing: "倒車離障", realigning: "轉回道路" }[state.supportAi[unit].mode]}`);
    });
    if (state.tacticalCommand && state.tacticalCommand !== "terminate" && state.elapsed - state.commandAt > .7 && !(state.radioFeedback?.command === "request-pit" && state.elapsed - state.radioFeedback.at < 3)) {
      const command = state.tacticalCommand;
      const arrived = state.supportArrivedFor[0] > .6 && (command === "prepare-pit" || command === "block-front" ? state.supportArrivedFor[1] > .6 : true);
      const feedback = command === "block-front" ? blockadeFeedback(state.blockade) : tacticalFeedback(command, Math.hypot(suspectFrame.forwardSpeed, suspectFrame.lateralSpeed) < 4.2, arrived, state.supportAi.some(ai => ai.mode !== "driving"));
      updateRadioFeedback(state, { command, phase: feedback.phase, message: `${COMMAND_LABELS[command]}・${RADIO_PHASE_LABELS[feedback.phase]}：${feedback.message}` });
    }

    const support2Position = support2.translation();
    const support3Position = support3.translation();
    const currentSupport = (body: RapierRigidBody) => {
      const p = body.translation(), f = bodyFrame(body);
      return {x:p.x,z:p.z,yaw:f.yaw,speed:f.forwardSpeed,lateralSpeed:f.lateralSpeed};
    };
    const frontDistance = Math.hypot(support2Position.x - suspectPosition.x, support2Position.z - suspectPosition.z);
    const rearDistance = Math.hypot(support3Position.x - suspectPosition.x, support3Position.z - suspectPosition.z);
    const roadYaw = state.blockade.anchor?.yaw ?? segment.yaw;
    const held = containmentPose(0, currentSupport(support2), currentSuspect, roadYaw) && containmentPose(1, currentSupport(support3), currentSuspect, roadYaw);
    state.heldFor = state.pitQualified && held ? state.heldFor + dt : 0;
    const resolution = pitMissionResolution(state.pitQualified, suspectCanDrive, planarSuspectSpeed, state.containmentElapsed, state.heldFor);
    if (resolution) {
      logRuntimeEvent(state, resolution === "contained" ? "包圍確認：前後單位穩定守位" : "失能確認：合格 PIT 後嫌犯無法繼續駕駛");
      finish("success", resolution);
      return;
    }
    if (state.pitQualified && suspectCanDrive && state.containmentElapsed > 8 && Math.abs(suspectFrame.forwardSpeed) > 8 && Math.min(frontDistance, rearDistance) > 9) {
      state.pitQualified = false;
      state.pit = 0;
      state.heldFor = 0;
      state.outcome = "escaped-containment";
      refreshPitAuthorization(state, config, currentSuspect, true);
      if (state.tacticalCommand === "block-front") {
        missBlockade(state.blockade, "嫌犯重新逃逸");
      } else {
        state.command = null;
        state.tacticalCommand = null;
        state.radioFeedback = null;
      }
      logRuntimeEvent(state, "包圍失敗：嫌犯仍可駕駛並再次逃逸");
    }

    const finalPlayerFrame = bodyFrame(player);
    const finalSuspectFrame = bodyFrame(suspect);
    const finalSupport2Frame = bodyFrame(support2);
    const finalSupport3Frame = bodyFrame(support3);
    state.playerRoadIndex = closestRoadSegment(state.road, playerPosition.x, playerPosition.z, state.playerRoadIndex);
    state.supportRoadIndices[0] = closestRoadSegment(state.road, support2Position.x, support2Position.z, state.supportRoadIndices[0]);
    state.supportRoadIndices[1] = closestRoadSegment(state.road, support3Position.x, support3Position.z, state.supportRoadIndices[1]);
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
        radioFeedback: state.radioFeedback,
        tacticalCommand: state.tacticalCommand,
        contactFeedback: state.contactFeedback,
        authorizationExpires: state.authorizationExpires,
        missionStage: state.outcome,
      });
    }
  });

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
    >
      {vehicleColliderStrips(config.vehicle).map((s,i) => <CuboidCollider key={i} args={[s.halfWidth, .48, s.halfLength]} position={[0,0,s.z]} mass={s.mass} friction={.68 * WEATHER[config.weather].grip} restitution={.08} contactSkin={.005} />)}
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
      {vehicleColliderStrips("suspect").map((s,i) => <CuboidCollider key={i} args={[s.halfWidth,.48,s.halfLength]} position={[0,0,s.z]} mass={s.mass} friction={.66 * WEATHER[config.weather].grip} restitution={.08} contactSkin={.005} />)}
      <VehicleModel />
    </RigidBody>
    <RigidBody
      ref={support2Ref}
      name="police-support-2"
      colliders={false}
      position={[-2.1, .02, 18]}
      linearVelocity={[0, 0, -8]}
      enabledTranslations={[true, false, true]}
      enabledRotations={[false, true, false]}
      linearDamping={.09}
      angularDamping={1.5}
      ccd
      canSleep={false}
    >
      {vehicleColliderStrips("patrol").map((s,i) => <CuboidCollider key={i} args={[s.halfWidth,.48,s.halfLength]} position={[0,0,s.z]} mass={s.mass} friction={.67 * WEATHER[config.weather].grip} restitution={.06} />)}
      <VehicleModel police model="patrol" unit="02" />
    </RigidBody>
    <RigidBody
      ref={support3Ref}
      name="police-support-3"
      colliders={false}
      position={[2.1, .02, 29]}
      linearVelocity={[0, 0, -8]}
      enabledTranslations={[true, false, true]}
      enabledRotations={[false, true, false]}
      linearDamping={.1}
      angularDamping={1.6}
      ccd
      canSleep={false}
    >
      {vehicleColliderStrips("suv").map((s,i) => <CuboidCollider key={i} args={[s.halfWidth,.5,s.halfLength]} position={[0,0,s.z]} mass={s.mass} friction={.69 * WEATHER[config.weather].grip} restitution={.05} />)}
      <VehicleModel police model="suv" unit="03" />
    </RigidBody>
  </>;
}
