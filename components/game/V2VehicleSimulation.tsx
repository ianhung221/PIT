"use client";
/* eslint-disable react-hooks/immutability -- Rapier state is intentionally updated inside the fixed physics loop. */

import {
  useBeforePhysicsStep,
  useAfterPhysicsStep,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useRef, useState, type MutableRefObject } from "react";
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
import { stepBlockade, blockadeControl, blockadeFeedback, missBlockade,makeBlockade,waitForBlockadeRetry } from "@/lib/supportContainment";
import { roadSections } from "@/lib/roadGeometry";
import { assessVehicleControl, advanceControlTimers, controlRoadGeometry, isDisabledVehicleSettled, CONTROL, type ControlAssessment } from "@/lib/vehicleControlAssessment";
import { vehicleCanContinue, vehicleCanPerformDriving, vehicleDriveability, vehicleFaultSummary } from "@/lib/vehicleDamage";
import { sampleCollisionDamage } from "@/lib/vehicleCollisionDamage";
import type { MissionOutcome, RadioFeedback, RadioCommand } from "@/types/game";
import type { PitAuthorization } from "@/types/game";
import {escapeRoute,chaseRoute} from '@/lib/networkPursuit';
import {locateRoad,locationSegment} from '@/lib/roadLocation';
import {networkControlGeometry} from '@/lib/networkGeometry';
import {stepNetworkSupport} from '@/lib/networkSupport';
import {stepPursuitEvents} from '@/lib/pursuitEvents';
import {stepSuspectRecovery} from '@/lib/suspectRecovery';

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
  suspectStatus:string;
  supportStatus:[string,string];
  disabledFor:number;
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
  const [spawn]=useState(()=>({player:runtime.current.player,suspect:runtime.current.suspect,supports:runtime.current.supports.map(c=>({...c}))}));
  const controlGeometryRef = useRef<ReturnType<typeof controlRoadGeometry> | null>(null);
  const playerRef = useRef<RapierRigidBody>(null);
  const suspectRef = useRef<RapierRigidBody>(null);
  const support2Ref = useRef<RapierRigidBody>(null);
  const support3Ref = useRef<RapierRigidBody>(null);
  const lastUi = useRef(0);
  const preImpact = useRef<{player: BodyFrame; suspect: BodyFrame} | null>(null);
  const previousFrames=useRef<BodyFrame[]>([]);
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
    const bodiesAfter=[player,suspect,support2Ref.current,support3Ref.current];
    const framesAfter=bodiesAfter.map((body,i)=>!body?null:i===0?pf:i===1?sf:bodyFrame(body));
    for(let i=0;i<bodiesAfter.length;i++) {
      const body=bodiesAfter[i];
      if(!body)continue;
      const core=getVehiclePhysics(body);if(!core)continue;
      const wasDisabled=core.disabled;
      sampleVehiclePhysics(core,world.timestep,framesAfter[i]??undefined);
      if(wasDisabled!==core.disabled) {
        const label=body===player?'01 自車':body===suspect?'嫌犯車':body===support2Ref.current?'02 後援':'03 後援';
        logRuntimeEvent(state,`${label}：${core.disabled?'穩定翻覆，動力不可用':'已恢復輪胎支撐，可重新駕駛'}`);
      }
    }
    const supports=[support2Ref.current,support3Ref.current];
    if(supports[0]&&supports[1]){
      const bodies=[player,suspect,supports[0],supports[1]];
      const kinds=[config.vehicle,'suspect','patrol','suv'] as const;
      const damages=[state.playerDamage,state.suspectDamage,...state.supportDamage];
      const resultDamage=sampleCollisionDamage(world,bodies.map((body,i)=>({body,kind:kinds[i],damage:damages[i],before:previousFrames.current[i]??bodyFrame(body)})),state.damageEpisodes,state.elapsed);
      state.playerDamage=resultDamage[0];state.suspectDamage=resultDamage[1];state.supportDamage=[resultDamage[2],resultDamage[3]];
      const cars=bodies.map((body,i)=>{
        const f=framesAfter[i]!,core=getVehiclePhysics(body);
        const snap=core?physicsSnapshotFromFrame(core,f):bodySnapshot(body);
        return {...snap,angularSpeed:f.angularSpeed};
      });
      // Moving cars return before enclosure geometry is consulted. Keep the same
      // assessment/timer path while avoiding a world-object scan every moving step.
      const moving=Math.hypot(cars[1].speed,cars[1].lateralSpeed)>=CONTROL.speed||Math.abs(cars[1].angularSpeed)>=CONTROL.angularSpeed;
      const geometry=moving?[]:state.road.network?networkControlGeometry(state.road.network,cars[1]):(controlGeometryRef.current ??=controlRoadGeometry(roadSections(state.road))).slice(Math.max(0,state.suspectRoadIndex-1),state.suspectRoadIndex+2);
      const due=state.elapsed-state.controlCheckedAt>=CONTROL.interval;
      const control=assessVehicleControl({...cars[1],model:'suspect'},[
        {...cars[0],model:config.vehicle},{...cars[2],model:'patrol'},{...cars[3],model:'suv'},
      ],geometry,due?CONTROL.maxNodes:0);
      if(due||control.status!=='uncertain'||state.control.status!=='open')state.control=control;
      if(due)state.controlCheckedAt=state.elapsed;
      const core=getVehiclePhysics(suspect),driveable=vehicleCanContinue(state.suspectDamage)&&!core?.disabled;
      const speed=Math.hypot(sf.velocityX,sf.velocityZ);
      const rotation=suspect.rotation();
      const validPose=[rotation.x,rotation.y,rotation.z,rotation.w].every(Number.isFinite)&&Math.hypot(rotation.x,rotation.y,rotation.z,rotation.w)>1e-9;
      const settled=isDisabledVehicleSettled({...sf,validPose,groundedWheels:core?.groundedWheels??0,rolloverDisabled:core?.disabled??false,groundContact:core?.groundContact??false});
      Object.assign(state,advanceControlTimers(state,control,driveable,speed,world.timestep,false,settled));
      const resolution=pitMissionResolution(driveable,speed,state.disabledFor,state.heldFor);
      if(resolution){logRuntimeEvent(state,resolution==='contained'?'攔停確認：實體出口封閉並穩定維持；不限定玩家或後援位置':'失能確認：嫌犯動力不可用且已穩定停下');finish('success',resolution);return;}
    }
    if(!state.road.network&&state.elapsed>=90){finish('failed','failed');return;}
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
    previousFrames.current=measuredFrames;
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
    const suspectSnapshot=bodySnapshot(suspect);
    // Both support bodies are unchanged until their own controllers run below.
    // Reuse these observations for suspect awareness and formation planning.
    const supportSnapshots=[bodySnapshot(support2),bodySnapshot(support3)] as const;
    const recoveringFromPit=stepSuspectRecovery(state.suspectRecovery,state.successfulContacts,suspectSnapshot,config.difficulty??'normal',dt);
    state.suspectRoadIndex = closestRoadSegment(state.road, suspectPosition.x, suspectPosition.z, state.suspectRoadIndex);
    const network=state.road.network;
    const networkControl=network?escapeRoute(network,state.networkDrivers[0],suspectSnapshot,state.elapsed,grip,0,
      state.pitCandidate||recoveringFromPit?undefined:[{...bodySnapshot(player),model:config.vehicle},{...supportSnapshots[0],model:'patrol'},{...supportSnapshots[1],model:'suv'}],config.difficulty??'normal',state.decision.duration>0?state.decision.offset:undefined):null;
    const segment = network?locationSegment(network,state.networkDrivers[0].location!):state.road.segments[state.suspectRoadIndex];
    refreshPitAuthorization(state, config, { ...state.suspect, speed:suspectFrame.forwardSpeed, lateralSpeed:suspectFrame.lateralSpeed });
    const targetSegment = network?segment:roadTarget(state.road, state.suspectRoadIndex, 2);
    const roadHalfWidth = segment.width / 2 - 1.25;
    const segmentRightX = Math.cos(segment.yaw);
    const segmentRightZ = -Math.sin(segment.yaw);
    const localRoadX = (suspectPosition.x - segment.x) * segmentRightX + (suspectPosition.z - segment.z) * segmentRightZ;
    const distanceToPlayer = Math.hypot(suspectPosition.x - playerFrame.x, suspectPosition.z - playerFrame.z);
    const observedThreat=network?state.networkDrivers[0].observation?.cars.reduce<(typeof playerFrame)|{x:number;z:number}|undefined>((nearest,car)=>!nearest||Math.hypot(car.x-suspectPosition.x,car.z-suspectPosition.z)<Math.hypot(nearest.x-suspectPosition.x,nearest.z-suspectPosition.z)?car:nearest,undefined):playerFrame;
    const observedDistance=observedThreat?Math.hypot(observedThreat.x-suspectPosition.x,observedThreat.z-suspectPosition.z):Infinity;
    const decision = !state.pitCandidate && !recoveringFromPit && !getVehiclePhysics(suspect)?.disabled && state.suspectAi.mode === 'driving'
      ? stepSuspectDecision(state.decision,config.difficulty ?? 'normal',dt,observedDistance,localRoadX,roadHalfWidth,observedThreat?(observedThreat.x-suspectPosition.x)*segmentRightX+(observedThreat.z-suspectPosition.z)*segmentRightZ:0)
      : state.decision;
    const laneWave = decision.offset;
    const boundaryPressure = Math.abs(localRoadX) > roadHalfWidth * .72
      ? THREE.MathUtils.clamp(-localRoadX / roadHalfWidth, -1, 1) * Math.min(3.2, roadHalfWidth * .42)
      : 0;
    const laneTarget = THREE.MathUtils.clamp(laneWave + boundaryPressure, -roadHalfWidth * .7, roadHalfWidth * .7);
    const targetX = targetSegment.x + Math.cos(targetSegment.yaw) * laneTarget;
    const targetZ = targetSegment.z - Math.sin(targetSegment.yaw) * laneTarget;
    const desiredYaw = networkControl?suspectFrame.yaw+networkControl.yawError:desiredYawTo(suspectPosition.x, suspectPosition.z, targetX, targetZ);
    const yawError = normalizeAngle(desiredYaw - suspectFrame.yaw);
    const planarSuspectSpeed = Math.hypot(suspectFrame.velocityX, suspectFrame.velocityZ);
    const boundaryRatio = Math.abs(localRoadX) / Math.max(.1, roadHalfWidth);
    const ai = state.suspectAi;
    const looksStuck = planarSuspectSpeed < SUSPECT_RECOVERY.stuckSpeed
      && (boundaryRatio >= .72 || Math.abs(yawError) >= Math.PI * 48 / 180 || suspectFrame.forwardSpeed < -.5);
    ai.stalledFor = !state.pitCandidate && looksStuck ? ai.stalledFor + dt : Math.max(0, ai.stalledFor - dt * 2);
    if (!network && ai.mode === "driving" && !recoveringFromPit && isSuspectRecoveryNeeded({
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
    if (ai.mode !== "driving" && !state.pitCandidate && !recoveringFromPit) {
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
    const effectiveMode = state.pitCandidate || recoveringFromPit ? "driving" : ai.mode;
    const steeringYaw = effectiveMode === "reversing" ? suspectReverseEscapeYaw(localRoadX) : desiredYaw;
    const steeringYawError = normalizeAngle(steeringYaw - suspectFrame.yaw);
    const pursuitBoost = distanceToPlayer < 17 ? 3 : 0;
    const alongSegment=(suspectFrame.x-segment.x)*-Math.sin(segment.yaw)+(suspectFrame.z-segment.z)*-Math.cos(segment.yaw);
    const distanceToAhead=Math.max(0,segment.length/2-alongSegment);
    const baseCruise = suspectRoadCruise(segment, roadTarget(state.road, state.suspectRoadIndex, 1), grip, pursuitBoost, distanceToAhead);
    let suspectTargetSpeed = (networkControl?networkControl.speed:baseCruise * suspectForwardSpeedScale(yawError)) * (.45 + suspectDriveability * .55) * decision.speedScale;
    if (!suspectCanDrive) suspectTargetSpeed = 0;
    if (effectiveMode === "braking") suspectTargetSpeed = 0;
    if (effectiveMode === "reversing") suspectTargetSpeed = -6 * grip;
    // Tyres need motion to turn; recovery uses a slow manoeuvre instead of a stationary yaw motor.
    if (effectiveMode === "realigning" && suspectCanDrive) suspectTargetSpeed = Math.min(3 * grip, Math.max(1.5 * grip, suspectTargetSpeed));
    const targetCore=getVehiclePhysics(suspect);
    if(targetCore){
      if(state.pitCandidate||recoveringFromPit)applyPitTargetControl(suspect,suspectFrame,state.suspectDamage,grip,dt);
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
    const currentPlayer = { ...state.player, model:config.vehicle,x: playerPosition.x, z: playerPosition.z, yaw: playerFrame.yaw, speed: playerFrame.forwardSpeed, lateralSpeed: playerFrame.lateralSpeed };
    const currentSuspect = { ...state.suspect, x: suspectPosition.x, z: suspectPosition.z, yaw: suspectFrame.yaw, speed: suspectFrame.forwardSpeed, lateralSpeed: suspectFrame.lateralSpeed };
    const pursuitEvent=stepPursuitEvents(state.pursuitEvents,{pitCount:state.successfulContacts,pitQualified:state.pitQualified,command:state.tacticalCommand,commandAt:state.commandAt,running:state.result==='playing'});
    const automaticBlockade = pursuitEvent.automatic;
    const activeBlockade = pursuitEvent.active;
    if(pursuitEvent.started){state.blockade=makeBlockade();logRuntimeEvent(state,'新有效 PIT：後援等待車速與通道允許後協助封鎖');}
    const supportAvailable:[boolean,boolean]=[support2,support3].map((body,i)=>!getVehiclePhysics(body)?.disabled&&vehicleCanPerformDriving(state.supportDamage[i])) as [boolean,boolean];
    const playerAvailable=!getVehiclePhysics(player)?.disabled&&vehicleCanPerformDriving(state.playerDamage);
    const currentSupports:[typeof state.supports[0],typeof state.supports[1]]=[{...state.supports[0],...supportSnapshots[0]},{...state.supports[1],...supportSnapshots[1]}];
    const previousLeader=state.networkSupport.leader;
    const formation=network?stepNetworkSupport(state.networkSupport,{network,player:currentPlayer,suspect:currentSuspect,supports:currentSupports,available:supportAvailable,playerAvailable,command:state.tacticalCommand,commandAt:state.commandAt,grip,dt,pitPreparing:!!state.pitCandidate}):null;
    if(formation&&formation.leader!==null&&formation.leader!==previousLeader){
      const message=`0${formation.leader+2} 已沿路接替主追；PIT 仍由玩家執行`;
      logRuntimeEvent(state,message);
      if(!state.tacticalCommand)updateRadioFeedback(state,{command:'take-primary',phase:'completed',message});
    }
    if (activeBlockade) {
      stepBlockade(state.blockade, { road: state.road, index: state.suspectRoadIndex, suspect: {...currentSuspect,pose:bodySnapshot(suspect).pose}, supports: currentSupports, player: currentPlayer, dt,available:supportAvailable });
    }
    const assignments = coordinatePursuit({
      command: automaticBlockade ? "block-front" : state.tacticalCommand,
      unit2Available:supportAvailable[0],
      unit3Available:supportAvailable[1],
      pitQualified: state.pitQualified,
      suspectStopped: state.tacticalCommand === "block-front" ? Math.hypot(suspectFrame.forwardSpeed, suspectFrame.lateralSpeed) < 4.2 : suspectSlow,
      suspectDriveable: suspectCanDrive,
      playerDriveability,
      blockadePhase: state.blockade.phase,
    });
    if(formation&&assignments.phase!=='containment'){
      assignments.player=formation.playerRole;assignments.unit2=formation.slots[0].role;assignments.unit3=formation.slots[1].role;
    }
    if(activeBlockade&&assignments.phase==='containment'){
      assignments.unit2=supportAvailable[0]?(state.blockade.frontUnit===0?'containment-front':'containment-rear'):'unavailable';
      assignments.unit3=supportAvailable[1]?(state.blockade.frontUnit===1?'containment-front':'containment-rear'):'unavailable';
    }
    state.supports[0].role = assignments.unit2;
    state.supports[1].role = assignments.unit3;
    state.playerRoadIndex = closestRoadSegment(state.road, playerPosition.x, playerPosition.z, state.playerRoadIndex);
    // A formation can assign both units the very same snapshot. Locate that
    // immutable target once per step; never carry a position into another step.
    const targetLocations=new Map<object,ReturnType<typeof locateRoad>>();
    [support2, support3].forEach((body, unit) => {
      const frame = measuredFrames[unit+2], position = body.translation();
      if(getVehiclePhysics(body)?.disabled||!vehicleCanPerformDriving(state.supportDamage[unit])){
        driveSupport(body,0,0,unit===0?VEHICLES.patrol.maxSpeed:VEHICLES.suv.maxSpeed,dt,grip,frame,state.supportDamage[unit]);
        state.supportArrivedFor[unit]=0;return;
      }
      const car = { x: position.x, z: position.z, yaw: frame.yaw, speed: frame.forwardSpeed, lateralSpeed: frame.lateralSpeed };
      if(network&&formation){
        const slot=formation.slots[unit],driver=state.networkDrivers[unit+1],previousMode=driver.local.mode,previousTurnNotice=driver.turnaroundReason;
        const neighbors=[{...currentPlayer,model:config.vehicle,id:'player'},{...currentSuspect,model:'suspect' as const,id:'suspect'},{...currentSupports[1-unit],id:`support-${1-unit}`}];
        const target=activeBlockade?currentSuspect:slot.target;
        let targetLocation=targetLocations.get(target);
        if(!targetLocation){targetLocation=locateRoad(network,target);targetLocations.set(target,targetLocation);}
        const routeControl=chaseRoute(network,driver,{...car,model:unit===0?'patrol':'suv'},target,state.elapsed,grip,activeBlockade?16+unit*14:slot.gap,neighbors,slot.allowOvertake,!activeBlockade&&slot.target===currentSuspect,targetLocation);
        if(driver.turnaroundReason&&driver.turnaroundReason!==previousTurnNotice)logRuntimeEvent(state,`0${unit+2} 後援：${driver.turnaroundReason}`);
        const maneuver=activeBlockade&&Math.hypot(car.x-currentSuspect.x,car.z-currentSuspect.z)<55?blockadeControl(state.blockade,unit as 0|1,car,currentSuspect,neighbors,state.road,dt,grip):null;
        const control=driver.turnaroundStopping?routeControl:maneuver??(activeBlockade&&waitForBlockadeRetry(state.blockade,car,currentSuspect)
          ?{...routeControl,speed:0,arrived:false}:routeControl);
        driveSupport(body,control.yawError,control.speed,unit===0?VEHICLES.patrol.maxSpeed:VEHICLES.suv.maxSpeed,dt,grip,frame,state.supportDamage[unit]);
        state.supportArrivedFor[unit]=control.arrived?state.supportArrivedFor[unit]+dt:0;
        if(previousMode!==driver.local.mode&&['blocked','reversing','following'].includes(driver.local.mode))logRuntimeEvent(state,`0${unit+2} 後援：${driver.local.reason}`);
        return;
      }
      const index = closestRoadSegment(state.road, position.x, position.z, state.supportRoadIndices[unit]);
      const slot = supportSlot({ road: state.road, player: currentPlayer, suspect: currentSuspect, playerIndex: state.playerRoadIndex, suspectIndex: state.suspectRoadIndex, unit, role: unit === 0 ? assignments.unit2 : assignments.unit3, command: automaticBlockade ? "block-front" : state.tacticalCommand });
      const neighbors = [currentPlayer, currentSuspect, state.supports[1 - unit]];
      const maneuver = activeBlockade && state.supportAi[unit].mode === "driving"
        ? blockadeControl(state.blockade, unit as 0 | 1, car, currentSuspect, neighbors, state.road, dt, grip) : null;
      const control = maneuver ?? stepSupportAI(state.supportAi[unit], { car, road: state.road, index, slot, dt, grip, maxSpeed: unit === 0 ? VEHICLES.patrol.maxSpeed : VEHICLES.suv.maxSpeed, neighbors });
      if (maneuver) { state.supportAi[unit].lastX = car.x; state.supportAi[unit].lastZ = car.z; state.supportAi[unit].stalledFor = 0; }
      driveSupport(body, control.yawError, control.speed, unit === 0 ? VEHICLES.patrol.maxSpeed : VEHICLES.suv.maxSpeed, dt, grip, frame,state.supportDamage[unit]);
      state.supportArrivedFor[unit] = control.arrived ? state.supportArrivedFor[unit] + dt : 0;
      if (control.modeChanged) logRuntimeEvent(state, `0${unit + 2} 後援：${{ driving: "已脫困，重新加入追逐", braking: "受阻煞停", reversing: "倒車離障", realigning: "轉回道路" }[state.supportAi[unit].mode]}`);
    });
    const feedbackCommand=activeBlockade?'block-front':state.tacticalCommand;
    if (feedbackCommand && feedbackCommand !== "terminate" && state.elapsed - state.commandAt > .7 && !(state.radioFeedback?.command === "request-pit" && state.elapsed - state.radioFeedback.at < 3)) {
      const command = feedbackCommand;
      const selected=formation?.leader??formation?.candidate??formation?.preferred??0;
      const required=formation?(command==='move-up'||command==='take-primary'?[selected]:[0,1].filter(i=>supportAvailable[i])):[0,1];
      const arrived = formation?required.length>0&&required.every(i=>state.supportArrivedFor[i]>.6)&&(command!=='take-primary'||formation.leader!==null):state.supportArrivedFor[0] > .6 && (command === "prepare-pit" || command === "block-front" ? state.supportArrivedFor[1] > .6 : true);
      const reasons=[support2,support3].map((body,i)=>getVehiclePhysics(body)?.disabled?`0${i+2} 穩定翻覆`:!vehicleCanContinue(state.supportDamage[i])?`0${i+2} 動力失能`:!vehicleCanPerformDriving(state.supportDamage[i])?`0${i+2} 轉向受損`:network&&state.networkDrivers[i+1].blocked?`0${i+2} 路線受阻`:null).filter(Boolean);
      let feedback = reasons.length?{phase:'unable' as const,message:`${reasons.join('、')}，無法完成目前協同指令`}:command === "block-front" ? blockadeFeedback(state.blockade) : tacticalFeedback(command, Math.hypot(suspectFrame.forwardSpeed, suspectFrame.lateralSpeed) < 4.2, arrived, state.supportAi.some(ai => ai.mode !== "driving"));
      if(formation&&command!=='block-front'){
        const unavailable=required.length===0||required.some(i=>!supportAvailable[i]);
        const blocked=required.some(i=>state.networkDrivers[i+1].blocked);
        const recovering=required.some(i=>['braking','reversing','recovering'].includes(state.networkDrivers[i+1].local.mode));
        feedback=unavailable?{phase:'unable',message:'沒有可用後援能執行此指令'}:command==='prepare-pit'&&!playerAvailable?{phase:'unable',message:'玩家車輛目前無法安全領追，後援維持追蹤'}:blocked?{phase:'unable',message:'通道受阻，等待空間後繼續執行'}:tacticalFeedback(command,suspectSlow,arrived,recovering);
        if(command==='take-primary'&&!unavailable)feedback.message=arrived?`0${selected+2} 已實際接替領追，PIT 仍由玩家執行；Q2 交回主追`:`0${selected+2} ${blocked?'通道受阻，等待安全通路':'正在沿路會合／超前，尚未完成接替'}`;
        if(!supportAvailable[0]&&supportAvailable[1])feedback.message=`02 無法機動，由 03 支援；${feedback.message}`;
      }
      if(formation&&command==='block-front'){
        feedback=supportAvailable.some(Boolean)?blockadeFeedback(state.blockade):{phase:'unable',message:'沒有可用後援；仍可由玩家依實際空間控制嫌犯'};
        if(supportAvailable.filter(Boolean).length===1)feedback.message=`僅 0${supportAvailable[0]?2:3} 可機動；${feedback.message}`;
      }
      updateRadioFeedback(state, { command, phase: feedback.phase, message: `${COMMAND_LABELS[command]}・${RADIO_PHASE_LABELS[feedback.phase]}：${feedback.message}` });
    }

    const support2Position = support2.translation();
    const support3Position = support3.translation();
    const frontDistance = Math.hypot(support2Position.x - suspectPosition.x, support2Position.z - suspectPosition.z);
    const rearDistance = Math.hypot(support3Position.x - suspectPosition.x, support3Position.z - suspectPosition.z);
    if (state.pitQualified && suspectCanDrive && state.containmentElapsed > 8 && Math.abs(suspectFrame.forwardSpeed) > 8 && Math.min(frontDistance, rearDistance) > 9) {
      state.pitQualified = false;
      state.pit = 0;
      state.heldFor = 0;
      state.outcome = "escaped-containment";
      refreshPitAuthorization(state, config, currentSuspect, true);
      missBlockade(state.blockade, "嫌犯重新逃逸");
      logRuntimeEvent(state, "包圍失敗：嫌犯仍可駕駛並再次逃逸");
    }

    const finalPlayerFrame = bodyFrame(player);
    // Network lookup above already used this exact position; repeating it in the
    // same fixed step cannot improve its nearest-edge result.
    if(!network)state.playerRoadIndex = closestRoadSegment(state.road, playerPosition.x, playerPosition.z, state.playerRoadIndex);
    state.supportRoadIndices[0] = closestRoadSegment(state.road, support2Position.x, support2Position.z, state.supportRoadIndices[0]);
    state.supportRoadIndices[1] = closestRoadSegment(state.road, support3Position.x, support3Position.z, state.supportRoadIndices[1]);
    state.player = bodySnapshot(player);
    state.suspect = bodySnapshot(suspect);
    state.supports[0] = {...state.supports[0],...bodySnapshot(support2)};
    state.supports[1] = {...state.supports[1],...bodySnapshot(support3)};

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
        suspectStatus:vehicleFaultSummary(state.suspectDamage,!!getVehiclePhysics(suspect)?.disabled),
        supportStatus:[vehicleFaultSummary(state.supportDamage[0],!!getVehiclePhysics(support2)?.disabled),vehicleFaultSummary(state.supportDamage[1],!!getVehiclePhysics(support3)?.disabled)],
        disabledFor:state.disabledFor,
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
    <VehiclePhysicsBody bodyRef={playerRef} kind={config.vehicle} name="police-primary" x={spawn.player.x} z={spawn.player.z} yaw={spawn.player.yaw}>
      <VehicleModel police model={config.vehicle} unit="01" hideExterior={cameraMode === "driver"} />
    </VehiclePhysicsBody>
    <VehiclePhysicsBody bodyRef={suspectRef} kind="suspect" name="suspect" x={spawn.suspect.x} z={spawn.suspect.z} yaw={spawn.suspect.yaw} velocity={[-Math.sin(spawn.suspect.yaw)*spawn.suspect.speed,0,-Math.cos(spawn.suspect.yaw)*spawn.suspect.speed]}>
      <VehicleModel />
    </VehiclePhysicsBody>
    <VehiclePhysicsBody bodyRef={support2Ref} kind="patrol" name="police-support-2" x={spawn.supports[0].x} z={spawn.supports[0].z} yaw={spawn.supports[0].yaw} velocity={[-Math.sin(spawn.supports[0].yaw)*spawn.supports[0].speed,0,-Math.cos(spawn.supports[0].yaw)*spawn.supports[0].speed]}>
      <VehicleModel police model="patrol" unit="02" />
    </VehiclePhysicsBody>
    <VehiclePhysicsBody bodyRef={support3Ref} kind="suv" name="police-support-3" x={spawn.supports[1].x} z={spawn.supports[1].z} yaw={spawn.supports[1].yaw} velocity={[-Math.sin(spawn.supports[1].yaw)*spawn.supports[1].speed,0,-Math.cos(spawn.supports[1].yaw)*spawn.supports[1].speed]}>
      <VehicleModel police model="suv" unit="03" />
    </VehiclePhysicsBody>
  </>;
}
