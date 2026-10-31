"use client";
/* eslint-disable react/no-unknown-property -- R3F properties. */
/* eslint-disable react-hooks/immutability -- Fixed-step Rapier runtime. */
import { useRef, type MutableRefObject } from 'react';
import { useBeforePhysicsStep, useAfterPhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import {VehiclePhysicsBody} from './VehiclePhysicsBody';
import {getVehiclePhysics,physicsSnapshot,sampleVehiclePhysics} from '@/lib/vehiclePhysics';
import {readVehicleFrame,vehicleSnapshot} from '@/lib/vehiclePose';
import {driveVehicleTarget} from '@/lib/vehicleDriver';
import { VehicleModel } from './VehicleModel';
import type { PracticeRuntime } from './practiceRuntime';
import { PRACTICE, outsidePractice, practiceSpeed, type PracticeConfig } from '@/lib/practiceConfig';
import { SUSPECT, VEHICLES, WEATHER } from '@/lib/gameConfig';
import { stepSuspectDecision } from '@/lib/suspectDriving';
import { applyPlayerForces } from '@/lib/playerVehicleForces';
import { applyPitTargetControl } from '@/lib/pitTargetControl';
import { V2_PIT } from '@/lib/pitContact';
import { normalizeAngle } from '@/lib/gameRules';
import { observeDiagnostic, closeContactDiagnostic, outcomeSample, updateDiagnostic } from '@/lib/pitDiagnostics';
import { observeContactEpisode, finishContactEpisode } from '@/lib/pitContactEpisode';
import { physicalContactSample } from '@/lib/physicalContactSample';
import { applyImpactDamage, vehicleCanContinue, vehicleDriveability } from '@/lib/vehicleDamage';
import { cancelCruise, resetPlayerDriving } from '@/lib/playerDriving';

function frame(body:RapierRigidBody) {return readVehicleFrame(body,getVehiclePhysics(body)?.lastYaw??0);}
function snapshot(body:RapierRigidBody) {const core=getVehiclePhysics(body);return core?physicsSnapshot(core):vehicleSnapshot(body);}
export function PracticeVehicleSimulation({runtime,keys,config,zones,onUpdate}:{runtime:MutableRefObject<PracticeRuntime>;keys:MutableRefObject<Set<string>>;config:PracticeConfig;zones:boolean;onUpdate:()=>void}) {
  const playerRef=useRef<RapierRigidBody>(null),suspectRef=useRef<RapierRigidBody>(null);
  const previous=useRef<{player:ReturnType<typeof frame>;suspect:ReturnType<typeof frame>}|null>(null);
  const lastUi=useRef(0);
  useBeforePhysicsStep(world=>{
    const state=runtime.current,p=playerRef.current,s=suspectRef.current;
    if(!p||!s||state.phase!=='playing') return;
    const dt=world.timestep,pf=frame(p),sf=frame(s);
    previous.current={player:pf,suspect:sf};
    state.elapsed+=dt; state.cooldown=Math.max(0,state.cooldown-dt);
    const grip=WEATHER[config.weather ?? 'clear'].grip;
    applyPlayerForces(p,pf,state.driving,state.playerDamage,keys.current,config.vehicle,grip,dt,pf);
    if(state.candidate) { applyPitTargetControl(s,sf,state.suspectDamage,grip,dt); return; }
    const core=getVehiclePhysics(s);if(!core)return;
    const health=vehicleDriveability(state.suspectDamage);
    const pp=p.translation(),sp=s.translation();
    const decision=stepSuspectDecision(state.decision,config.difficulty ?? 'normal',dt,Math.hypot(pp.x-sp.x,pp.z-sp.z),sp.x,8,pp.x-sp.x);
    const desired=vehicleCanContinue(state.suspectDamage)&&!core.disabled?practiceSpeed(config)*health*Math.max(.2,Math.cos(sf.yaw))*decision.speedScale:0;
    const targetYaw=Math.atan2(-(decision.offset-sp.x),35);
    driveVehicleTarget(core,{speed:desired,yawError:normalizeAngle(targetYaw-sf.yaw)},grip,state.suspectDamage,dt,sf);
  });
  useAfterPhysicsStep(world=>{
    const state=runtime.current,p=playerRef.current,s=suspectRef.current;
    if(!p||!s||state.phase!=='playing') return;
    for(const body of [p,s]){const core=getVehiclePhysics(body);if(core)sampleVehiclePhysics(core,world.timestep);}
    const pf=frame(p),sf=frame(s),pp=p.translation(),sp=s.translation(),pre=previous.current??{player:pf,suspect:sf};
    state.player=snapshot(p);
    state.suspect=snapshot(s);
    const contact=physicalContactSample(world,p,s,pf,sf,pre,config.vehicle,true);
    const previousEpisode=state.contactEpisodes.current;
    const decision=observeContactEpisode(state.contactEpisodes,contact,state.elapsed,!!state.candidate);
    if(previousEpisode!==state.contactEpisodes.current)closeContactDiagnostic(state.diagnostics,previousEpisode,state.elapsed);
    const episode=state.contactEpisodes.current;
    if(contact&&episode) {
      if(decision.started||episode.diagnosticId)observeDiagnostic(state.diagnostics,contact,episode,state.elapsed,decision.changed);
      if(decision.damage) {
        const impulse=Math.max(2,contact.normalSpeed*2);
        state.suspectDamage=applyImpactDamage(state.suspectDamage,{impulse,localX:contact.localX,localZ:contact.localZ,halfWidth:SUSPECT.width/2,halfLength:SUSPECT.length/2});
        state.playerDamage=applyImpactDamage(state.playerDamage,{impulse:impulse*.72,localX:contact.playerLocalX,localZ:contact.playerLocalZ,halfWidth:VEHICLES[config.vehicle].width/2,halfLength:VEHICLES[config.vehicle].length/2});
      }
      if(decision.unsafe)state.candidate=null;
      if(decision.promoted)state.candidate={startYaw:pre.suspect.yaw,startSpeed:Math.hypot(pre.suspect.velocityX,pre.suspect.velocityZ),expires:state.elapsed+V2_PIT.window,contactTime:world.timestep};
    }
    let solidContact=false;
    for(let i=0;i<p.numColliders();i++)world.contactPairsWith(p.collider(i),other=>{
      world.contactPair(p.collider(i),other,m=>{if(m.numSolverContacts())solidContact=true;});
    });
    state.driving.touching=solidContact;
    if(solidContact)cancelCruise(state.driving,'碰撞／接觸障礙');
    const candidate=state.candidate;
    if(candidate) {
      if(contact&&!decision.promoted) candidate.contactTime+=world.timestep;
      const sample=outcomeSample(candidate.startYaw,sf.yaw,candidate.startSpeed,Math.hypot(sf.velocityX,sf.velocityZ),sf.lateralSpeed,candidate.contactTime,candidate.expires-state.elapsed,sf.headingValid);
      updateDiagnostic(state.diagnostics,sample,state.elapsed,!sf.headingValid||state.elapsed>=candidate.expires);
      if(sample.success||!sf.headingValid||state.elapsed>=candidate.expires) {state.candidate=null;finishContactEpisode(state.contactEpisodes);}
      if(sample.success&&!state.successPresented) {state.successPresented=true;state.phase='qualified';}
    }
    if(outsidePractice(pp,sp)) state.phase='outside';
    lastUi.current+=world.timestep;
    if(state.phase!=='playing') {keys.current.clear();resetPlayerDriving(state.driving,'練習暫停');}
    if(lastUi.current>=.1||state.phase!=='playing'){lastUi.current=0;onUpdate();}
  });
  return <>
    <VehiclePhysicsBody bodyRef={playerRef} kind={config.vehicle} name="practice-player" x={PRACTICE.playerX} z={PRACTICE.playerZ} groundY={-.49} velocity={[0,0,-practiceSpeed(config)]}>
      <VehicleModel police model={config.vehicle} unit="01"/>
    </VehiclePhysicsBody>
    <VehiclePhysicsBody bodyRef={suspectRef} kind="suspect" name="practice-target" groundY={-.49} velocity={[0,0,-practiceSpeed(config)]}>
      <VehicleModel/>
      {zones&&[-1,1].map(side=><mesh key={side} position={[side*(SUSPECT.width/2+.02),.6,SUSPECT.length*.375]}><boxGeometry args={[.035,.45,SUSPECT.length*.25]}/><meshBasicMaterial color="#38f0c0" transparent opacity={.7}/></mesh>)}
    </VehiclePhysicsBody>
  </>;
}
