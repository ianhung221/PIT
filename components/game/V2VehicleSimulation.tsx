"use client";
/* eslint-disable react-hooks/immutability -- Rapier state is intentionally updated inside the fixed physics loop. */

import {
  useBeforePhysicsStep,
  useAfterPhysicsStep,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { VehicleModel } from "@/components/game/VehicleModel";
import { VehiclePhysicsBody } from './VehiclePhysicsBody';
import { getVehiclePhysics,physicsSnapshot,physicsSnapshotFromFrame,sampleVehiclePhysics } from '@/lib/vehiclePhysics';
import { readVehicleFrame,vehicleSnapshot,type VehicleFrame } from '@/lib/vehiclePose';
import { driveVehicleTarget } from '@/lib/vehicleDriver';
import { resetPlayerDriving, cancelCruise, type PlayerDriving } from "@/lib/playerDriving";
import { applyPlayerForces } from "@/lib/playerVehicleForces";
import { applyPitTargetControl } from '@/lib/pitTargetControl';
import { observeDiagnostic, closeContactDiagnostic, outcomeSample, updateDiagnostic } from "@/lib/pitDiagnostics";
import { observeContactEpisode, finishContactEpisode } from '@/lib/pitContactEpisode';
import { physicalContactSample } from '@/lib/physicalContactSample';
import type { V2Runtime, V2Result } from "@/components/game/v2Runtime";
import { logRuntimeEvent, updateRadioFeedback, refreshPitAuthorization } from "@/components/game/v2Runtime";
import {
  SCENES,
  SUSPECT,
  VEHICLES,
  WEATHER,
  type CameraMode,
  type MissionConfig,
} from "@/lib/gameConfig";
import {
  isSuspectRecoveryNeeded,
  nextSuspectRecoveryMode,
  normalizeAngle,
  SUSPECT_RECOVERY,
  suspectForwardSpeedScale,
  suspectReverseEscapeYaw,
} from "@/lib/gameRules";
import { closestRoadSegment, roadTarget } from "@/lib/proceduralMap";
import { physicalPitOutcome, pitMissionResolution, V2_PIT, type ContactFeedback } from "@/lib/pitContact";
import { suspectRoadCruise } from "@/lib/pitPolicy";
import { stepSuspectDecision } from "@/lib/suspectDriving";
import { coordinatePursuit, tacticalFeedback, COMMAND_LABELS, RADIO_PHASE_LABELS, type PursuitAssignments } from "@/lib/pursuitCoordinator";
import { stepSupportAI, supportSlot } from "@/lib/supportUnitAI";
import { driveSupport } from "@/lib/supportDriving";
import { stepBlockade, blockadeControl, blockadeFeedback, missBlockade } from "@/lib/supportContainment";
import { roadSections } from "@/lib/roadGeometry";
import { assessVehicleControl, advanceControlTimers, controlRoadGeometry, CONTROL, type ControlAssessment } from "@/lib/vehicleControlAssessment";
import { applyImpactDamage, vehicleCanContinue, vehicleDriveability } from "@/lib/vehicleDamage";
import type { MissionOutcome, RadioFeedback, RadioCommand } from "@/types/game";
import type { PitAuthorization } from "@/types/game";

type BodyFrame=VehicleFrame;
function bodySnapshot(body:RapierRigidBody){
  const core=getVehiclePhysics(body);return core?physicsSnapshot(core):vehicleSnapshot(body);
}

export interface V2HudData {
  driving: PlayerDriving;
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
  control: ControlAssessment;
  heldFor: number;
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
  const controlGeometryRef = useRef<ReturnType<typeof controlRoadGeometry> | null>(null);
  const playerRef = useRef<RapierRigidBody>(null);
  const suspectRef = useRef<RapierRigidBody>(null);
  const support2Ref = useRef<RapierRigidBody>(null);
  const support3Ref = useRef<RapierRigidBody>(null);
  const lastUi = useRef(0);
  const preImpact = useRef<{player: BodyFrame; suspect: BodyFrame} | null>(null);
  const bodyFrame=(body:RapierRigidBody)=>readVehicleFrame(body,getVehiclePhysics(body)?.lastYaw??0);

  const finish = (result: FinishData["result"], outcome: MissionOutcome) => {
    const state = runtime.current;
    if (state.result !== "playing") return;
    state.result = result;
    resetPlayerDriving(state.driving, "任務結束");
    keys.current.clear();
    state.outcome = outcome;
    onFinish({ result, outcome });
  };

  // Fixed-step pair sampling shares the same segment semantics with practice.
  useAfterPhysicsStep(world => {
    const player=playerRef.current,suspect=suspectRef.current,state=runtime.current;
    if(!player||!suspect||state.result!=="playing")return;
    const pf=bodyFrame(player),sf=bodyFrame(suspect),pre=preImpact.current??{player:pf,suspect:sf};
    for(const body of [player,suspect,support2Ref.current,support3Ref.current]) {
      if(!body)continue;
      const core=getVehiclePhysics(body);if(!core)continue;
      const wasDisabled=core.disabled;
      sampleVehiclePhysics(core,world.timestep,body===player?pf:body===suspect?sf:undefined);
      if(wasDisabled!==core.disabled) {
        const label=body===player?'01 自車':body===suspect?'嫌犯車':body===support2Ref.current?'02 後援':'03 後援';
        logRuntimeEvent(state,`${label}：${core.disabled?'穩定翻覆，動力不可用':'已恢復輪胎支撐，可重新駕駛'}`);
      }
    }
    let solidContact=false;
    for(let i=0;i<player.numColliders();i++)world.contactPairsWith(player.collider(i),other=>{
      world.contactPair(player.collider(i),other,m=>{if(m.numSolverContacts())solidContact=true;});
    });
    state.driving.touching=solidContact;
    if(solidContact)cancelCruise(state.driving,"碰撞／接觸障礙");
    const contact=physicalContactSample(world,player,suspect,pf,sf,pre,config.vehicle,false);
    if(contact) {
      refreshPitAuthorization(state,config,{...state.suspect,speed:pre.suspect.forwardSpeed,lateralSpeed:pre.suspect.lateralSpeed},true);
      contact.authorized=state.authorization==="authorized"&&state.authorizationExpires>=state.elapsed;
    }
    const previousEpisode=state.contactEpisodes.current;
    const decision=observeContactEpisode(state.contactEpisodes,contact,state.elapsed,!!state.pitCandidate);
    if(previousEpisode!==state.contactEpisodes.current)closeContactDiagnostic(state.diagnostics,previousEpisode,state.elapsed);
    const episode=state.contactEpisodes.current;
    if(!contact||!episode)return;
    if(decision.started||episode.diagnosticId)observeDiagnostic(state.diagnostics,contact,episode,state.elapsed,decision.changed);
    if(decision.damage) {
      const impact=Math.max(2,contact.normalSpeed*2);
      state.suspectDamage=applyImpactDamage(state.suspectDamage,{impulse:impact,localX:contact.localX,localZ:contact.localZ,halfWidth:SUSPECT.width/2,halfLength:SUSPECT.length/2});
      state.playerDamage=applyImpactDamage(state.playerDamage,{impulse:impact*.72,localX:contact.playerLocalX,localZ:contact.playerLocalZ,halfWidth:VEHICLES[config.vehicle].width/2,halfLength:VEHICLES[config.vehicle].length/2});
    }
    if(decision.changed) {
      const message=episode.status==='expired'?'接觸觀察期限已到，未形成合適接觸':decision.assessment!.reason;
      state.contactFeedback={classification:episode.classification,message,at:state.elapsed};
      logRuntimeEvent(state,message);
    }
    if(decision.countAttempt)state.attempts++;
    if(decision.unsafe) {
      state.unsafeContacts++;state.outcome="unsafe-pit";state.pitCandidate=null;state.pit=0;
      return;
    }
    if(decision.promoted) {
      state.pitCandidate={startYaw:pre.suspect.yaw,startSpeed:Math.hypot(pre.suspect.velocityX,pre.suspect.velocityZ),
        expires:state.elapsed+V2_PIT.window,side:contact.localX>0?1:-1,authorized:true,
        quality:Math.min(1,contact.normalSpeed/5),contactTime:world.timestep};
      state.pit=18;
      logRuntimeEvent(state,"PIT 接觸成立：正在評估旋轉與減速");
    }
  });

  useBeforePhysicsStep((world) => {
    const player = playerRef.current;
    const suspect = suspectRef.current;
    const support2 = support2Ref.current;
    const support3 = support3Ref.current;
    const state = runtime.current;
    if (!player || !suspect || !support2 || !support3 || state.result !== "playing") return;
    // Observe the previous solved physics step, before controllers write their
    // desired velocities. A blocked steering command is not actual rotation.
    const measuredFrames=[player,suspect,support2,support3].map(bodyFrame);
    const measuredCars = [player, suspect, support2, support3].map((body,i) => {
      const core=getVehiclePhysics(body);
      const snapshot=core?physicsSnapshotFromFrame(core,measuredFrames[i]):bodySnapshot(body);
      return {...snapshot,angularSpeed:snapshot.pose?.angularSpeed??0};
    });
    const dt = world.timestep;
    state.elapsed += dt;
    state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
    const grip = WEATHER[config.weather].grip;
    const playerFrame = measuredFrames[0];
    preImpact.current = { player: playerFrame, suspect: measuredFrames[1] };
    const playerDriveability = vehicleDriveability(state.playerDamage);
    applyPlayerForces(player,playerFrame,state.driving,state.playerDamage,keys.current,config.vehicle,grip,dt,playerFrame);

    const suspectPosition = suspect.translation();
    const suspectFrame = preImpact.current.suspect;
    state.suspectRoadIndex = closestRoadSegment(state.road, suspectPosition.x, suspectPosition.z, state.suspectRoadIndex);
    const segment = state.road.segments[state.suspectRoadIndex];
    refreshPitAuthorization(state, config, { ...state.suspect, speed:suspectFrame.forwardSpeed, lateralSpeed:suspectFrame.lateralSpeed });
    const targetSegment = roadTarget(state.road, state.suspectRoadIndex, 2);
    const roadHalfWidth = segment.width / 2 - 1.25;
    const segmentRightX = Math.cos(segment.yaw);
    const segmentRightZ = -Math.sin(segment.yaw);
    const localRoadX = (suspectPosition.x - segment.x) * segmentRightX + (suspectPosition.z - segment.z) * segmentRightZ;
    const distanceToPlayer = Math.hypot(suspectPosition.x - playerFrame.x, suspectPosition.z - playerFrame.z);
    const decision = !state.pitCandidate && !(state.pitQualified && state.containmentElapsed < 3.2) && !getVehiclePhysics(suspect)?.disabled && state.suspectAi.mode === 'driving'
      ? stepSuspectDecision(state.decision,config.difficulty ?? 'normal',dt,distanceToPlayer,localRoadX,roadHalfWidth,(playerFrame.x-suspectPosition.x)*segmentRightX+(playerFrame.z-suspectPosition.z)*segmentRightZ)
      : state.decision;
    const laneWave = decision.offset;
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
    const suspectCanDrive = vehicleCanContinue(state.suspectDamage)&&!getVehiclePhysics(suspect)?.disabled;
    const effectiveMode = state.pitCandidate || (state.pitQualified && state.containmentElapsed < 3.2) ? "driving" : ai.mode;
    const steeringYaw = effectiveMode === "reversing" ? suspectReverseEscapeYaw(localRoadX) : desiredYaw;
    const steeringYawError = normalizeAngle(steeringYaw - suspectFrame.yaw);
    const pursuitBoost = distanceToPlayer < 17 ? 3 : 0;
    const baseCruise = suspectRoadCruise(segment, roadTarget(state.road, state.suspectRoadIndex, 1), grip, pursuitBoost);
    let suspectTargetSpeed = baseCruise * suspectForwardSpeedScale(yawError) * (.45 + suspectDriveability * .55) * decision.speedScale;
    if (!suspectCanDrive || (state.pitQualified && state.containmentElapsed < 3.2)) suspectTargetSpeed = 0;
    if (effectiveMode === "braking") suspectTargetSpeed = 0;
    if (effectiveMode === "reversing") suspectTargetSpeed = -6 * grip;
    // Tyres need motion to turn; recovery uses a slow manoeuvre instead of a stationary yaw motor.
    if (effectiveMode === "realigning" && suspectCanDrive) suspectTargetSpeed = Math.min(3 * grip, Math.max(1.5 * grip, suspectTargetSpeed));
    const targetCore=getVehiclePhysics(suspect);
    if(targetCore){
      if(state.pitCandidate)applyPitTargetControl(suspect,suspectFrame,state.suspectDamage,grip,dt);
      else driveVehicleTarget(targetCore,{speed:suspectTargetSpeed,yawError:steeringYawError},grip,state.suspectDamage,dt,suspectFrame);
    }

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
        suspectFrame.headingValid,
      );
      state.pit = outcome.progress;
      updateDiagnostic(state.diagnostics, outcomeSample(state.pitCandidate.startYaw, suspectFrame.yaw,
        state.pitCandidate.startSpeed, planarSuspectSpeed, suspectFrame.lateralSpeed,
        state.pitCandidate.contactTime, state.pitCandidate.expires-state.elapsed,suspectFrame.headingValid), state.elapsed, !suspectFrame.headingValid||state.elapsed>=state.pitCandidate.expires);
      if (outcome.success) {
        finishContactEpisode(state.contactEpisodes);
        state.pitCandidate = null;
        state.pitQualified = true;
        state.containmentElapsed = 0;
        state.heldFor = 0;
        state.successfulContacts += 1;
        state.outcome = suspectCanDrive ? "stopped-mobile" : "disabled";
        state.contactFeedback = { classification: "effective", message: "有效 PIT：失控已確認，尚待控制嫌犯", at:state.elapsed };
        logRuntimeEvent(state, suspectCanDrive ? "有效 PIT：嫌犯車仍可行駛，後援開始包圍" : "有效 PIT：嫌犯車已失去行動能力");
      } else if (!suspectFrame.headingValid || state.elapsed >= state.pitCandidate.expires) {
        finishContactEpisode(state.contactEpisodes);
        state.pitCandidate = null;
        state.pit = 0;
        const reason=suspectFrame.headingValid?'PIT 未達旋轉／減速門檻，繼續追捕':'車身翻滾：無法可靠量測水平旋轉，本次 PIT 評估結束';
        state.contactFeedback = { classification:"scrape", message:reason, at:state.elapsed };
        logRuntimeEvent(state, reason);
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
      unit2Available:!getVehiclePhysics(support2)?.disabled,
      unit3Available:!getVehiclePhysics(support3)?.disabled,
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
      const frame = measuredFrames[unit+2], position = body.translation();
      if(getVehiclePhysics(body)?.disabled){
        driveSupport(body,0,0,unit===0?VEHICLES.patrol.maxSpeed:VEHICLES.suv.maxSpeed,dt,grip,frame);
        state.supportArrivedFor[unit]=0;return;
      }
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
      const unavailable=[support2,support3].some(body=>getVehiclePhysics(body)?.disabled);
      const feedback = unavailable?{phase:'unable' as const,message:'後援有單位穩定翻覆，無法完成目前協同指令'}:command === "block-front" ? blockadeFeedback(state.blockade) : tacticalFeedback(command, Math.hypot(suspectFrame.forwardSpeed, suspectFrame.lateralSpeed) < 4.2, arrived, state.supportAi.some(ai => ai.mode !== "driving"));
      updateRadioFeedback(state, { command, phase: feedback.phase, message: `${COMMAND_LABELS[command]}・${RADIO_PHASE_LABELS[feedback.phase]}：${feedback.message}` });
    }

    const support2Position = support2.translation();
    const support3Position = support3.translation();
    const frontDistance = Math.hypot(support2Position.x - suspectPosition.x, support2Position.z - suspectPosition.z);
    const rearDistance = Math.hypot(support3Position.x - suspectPosition.x, support3Position.z - suspectPosition.z);
    const searchDue = state.elapsed - state.controlCheckedAt >= CONTROL.interval;
    const controlGeometry = controlGeometryRef.current ??= controlRoadGeometry(roadSections(state.road));
    const control = assessVehicleControl(
      { ...measuredCars[1], model: "suspect" },
      [
        { ...measuredCars[0], model: config.vehicle },
        { ...measuredCars[2], model: "patrol" },
        { ...measuredCars[3], model: "suv" },
      ],
      controlGeometry.slice(Math.max(0, state.suspectRoadIndex - 1), state.suspectRoadIndex + 2),
      searchDue ? CONTROL.maxNodes : 0,
    );
    // Cached escape text is display-only. The closure certificate and timers are
    // recomputed every physics step, never carried over from a stale search.
    if (searchDue || control.status !== "uncertain" || state.control.status !== "open") state.control = control;
    if (searchDue) state.controlCheckedAt = state.elapsed;
    Object.assign(state, advanceControlTimers(state, control, suspectCanDrive, planarSuspectSpeed, dt));
    const resolution = pitMissionResolution(suspectCanDrive, planarSuspectSpeed, state.disabledFor, state.heldFor);
    if (resolution) {
      logRuntimeEvent(state, resolution === "contained" ? "攔停確認：實體出口封閉並穩定維持；不限定玩家或後援位置" : "失能確認：嫌犯無法繼續駕駛且已穩定停下");
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
    state.playerRoadIndex = closestRoadSegment(state.road, playerPosition.x, playerPosition.z, state.playerRoadIndex);
    state.supportRoadIndices[0] = closestRoadSegment(state.road, support2Position.x, support2Position.z, state.supportRoadIndices[0]);
    state.supportRoadIndices[1] = closestRoadSegment(state.road, support3Position.x, support3Position.z, state.supportRoadIndices[1]);
    state.player = bodySnapshot(player);
    state.suspect = bodySnapshot(suspect);
    state.supports[0] = {...state.supports[0],...bodySnapshot(support2)};
    state.supports[1] = {...state.supports[1],...bodySnapshot(support3)};

    if (state.elapsed >= 90) {
      finish("failed", "failed");
      return;
    }
    lastUi.current += dt;
    if (lastUi.current >= .1) {
      lastUi.current = 0;
      onUpdate({
        driving: {...state.driving, commands:[]},
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
        control: state.control,
        heldFor: state.heldFor,
      });
    }
  });

  return <>
    <VehiclePhysicsBody bodyRef={playerRef} kind={config.vehicle} name="police-primary" z={8}>
      <VehicleModel police model={config.vehicle} unit="01" hideExterior={cameraMode === "driver"} />
    </VehiclePhysicsBody>
    <VehiclePhysicsBody bodyRef={suspectRef} kind="suspect" name="suspect" x={.8} z={-24} velocity={[0,0,-SCENES[config.scene].aiSpeed*.72]}>
      <VehicleModel />
    </VehiclePhysicsBody>
    <VehiclePhysicsBody bodyRef={support2Ref} kind="patrol" name="police-support-2" x={-2.1} z={18} velocity={[0,0,-8]}>
      <VehicleModel police model="patrol" unit="02" />
    </VehiclePhysicsBody>
    <VehiclePhysicsBody bodyRef={support3Ref} kind="suv" name="police-support-3" x={2.1} z={29} velocity={[0,0,-8]}>
      <VehicleModel police model="suv" unit="03" />
    </VehiclePhysicsBody>
  </>;
}
