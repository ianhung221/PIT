"use client";
/* eslint-disable react/no-unknown-property -- R3F properties. */
/* eslint-disable react-hooks/immutability -- Fixed-step Rapier runtime. */
import { useRef, type MutableRefObject } from 'react';
import { RigidBody, CuboidCollider, useBeforePhysicsStep, useAfterPhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { VehicleModel } from './VehicleModel';
import type { PracticeRuntime } from './practiceRuntime';
import { PRACTICE, outsidePractice, type PracticeConfig } from '@/lib/practiceConfig';
import { SUSPECT, VEHICLES, vehicleColliderStrips } from '@/lib/gameConfig';
import { applyPlayerForces } from '@/lib/playerVehicleForces';
import { applyPitTargetControl } from '@/lib/pitTargetControl';
import { V2_PIT } from '@/lib/pitContact';
import { normalizeAngle } from '@/lib/gameRules';
import { observeDiagnostic, closeContactDiagnostic, outcomeSample, updateDiagnostic } from '@/lib/pitDiagnostics';
import { observeContactEpisode, finishContactEpisode } from '@/lib/pitContactEpisode';
import { physicalContactSample } from '@/lib/physicalContactSample';
import { applyImpactDamage, vehicleCanContinue, vehicleDriveability } from '@/lib/vehicleDamage';
import { cancelCruise, resetPlayerDriving } from '@/lib/playerDriving';

function frame(body:RapierRigidBody) {
  const q=body.rotation(),quat=new THREE.Quaternion(q.x,q.y,q.z,q.w);
  const yaw=new THREE.Euler().setFromQuaternion(quat,'YXZ').y;
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(quat),right=new THREE.Vector3(1,0,0).applyQuaternion(quat),v=body.linvel();
  return {yaw,forwardX:forward.x,forwardZ:forward.z,rightX:right.x,rightZ:right.z,velocityX:v.x,velocityZ:v.z,
    forwardSpeed:v.x*forward.x+v.z*forward.z,lateralSpeed:v.x*right.x+v.z*right.z};
}
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
    applyPlayerForces(p,pf,state.driving,state.playerDamage,keys.current,config.vehicle,1,dt);
    if(state.candidate) { applyPitTargetControl(s,sf,state.suspectDamage,1,dt); return; }
    // Basic straight-driving target. Finite impulses, never force a success/stop.
    const control=1,mass=s.mass(),health=vehicleDriveability(state.suspectDamage);
    const desired=vehicleCanContinue(state.suspectDamage)?PRACTICE.speed*health*Math.max(.2,Math.cos(sf.yaw)):0;
    const acceleration=THREE.MathUtils.clamp((desired-sf.forwardSpeed)*1.8,-8,8);
    s.applyImpulse({x:sf.forwardX*mass*acceleration*dt,y:0,z:sf.forwardZ*mass*acceleration*dt},true);
    const lateral=-sf.lateralSpeed*mass*Math.min(1,7*dt*control*state.suspectDamage.alignment);
    s.applyImpulse({x:sf.rightX*lateral,y:0,z:sf.rightZ*lateral},true);
    const desiredTurn=THREE.MathUtils.clamp(normalizeAngle(-sf.yaw)*1.4,-.75,.75)*Math.min(1,Math.abs(sf.forwardSpeed)/4);
    const av=s.angvel();
    s.setAngvel({x:0,y:THREE.MathUtils.lerp(av.y,desiredTurn,Math.min(1,dt*2.7*control)),z:0},true);
  });
  useAfterPhysicsStep(world=>{
    const state=runtime.current,p=playerRef.current,s=suspectRef.current;
    if(!p||!s||state.phase!=='playing') return;
    const pf=frame(p),sf=frame(s),pp=p.translation(),sp=s.translation(),pre=previous.current??{player:pf,suspect:sf};
    state.player={x:pp.x,z:pp.z,yaw:pf.yaw,speed:pf.forwardSpeed,lateralSpeed:pf.lateralSpeed};
    state.suspect={x:sp.x,z:sp.z,yaw:sf.yaw,speed:sf.forwardSpeed,lateralSpeed:sf.lateralSpeed};
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
    state.driving.touching=!!contact;
    if(contact)cancelCruise(state.driving,'碰撞／接觸目標');
    const candidate=state.candidate;
    if(candidate) {
      if(contact&&!decision.promoted) candidate.contactTime+=world.timestep;
      const sample=outcomeSample(candidate.startYaw,sf.yaw,candidate.startSpeed,Math.hypot(sf.velocityX,sf.velocityZ),sf.lateralSpeed,candidate.contactTime,candidate.expires-state.elapsed);
      updateDiagnostic(state.diagnostics,sample,state.elapsed,state.elapsed>=candidate.expires);
      if(sample.success||state.elapsed>=candidate.expires) {state.candidate=null;finishContactEpisode(state.contactEpisodes);}
      if(sample.success&&!state.successPresented) {state.successPresented=true;state.phase='qualified';}
    }
    if(outsidePractice(pp,sp)) state.phase='outside';
    lastUi.current+=world.timestep;
    if(state.phase!=='playing') {keys.current.clear();resetPlayerDriving(state.driving,'練習暫停');}
    if(lastUi.current>=.1||state.phase!=='playing'){lastUi.current=0;onUpdate();}
  });
  return <>
    <RigidBody ref={playerRef} name="practice-player" colliders={false} position={[PRACTICE.playerX,.02,PRACTICE.playerZ]} linearVelocity={[0,0,-PRACTICE.speed]} enabledTranslations={[true,false,true]} enabledRotations={[false,true,false]} linearDamping={.08} angularDamping={1.8} ccd canSleep={false}>
      {vehicleColliderStrips(config.vehicle).map((s,i)=><CuboidCollider key={i} args={[s.halfWidth,.48,s.halfLength]} position={[0,0,s.z]} mass={s.mass} friction={.68} restitution={.08} contactSkin={.005}/>)}
      <VehicleModel police model={config.vehicle} unit="01"/>
    </RigidBody>
    <RigidBody ref={suspectRef} name="practice-target" colliders={false} position={[0,.02,0]} linearVelocity={[0,0,-PRACTICE.speed]} enabledTranslations={[true,false,true]} enabledRotations={[false,true,false]} linearDamping={.06} angularDamping={.55} ccd canSleep={false}>
      {vehicleColliderStrips('suspect').map((s,i)=><CuboidCollider key={i} args={[s.halfWidth,.48,s.halfLength]} position={[0,0,s.z]} mass={s.mass} friction={.66} restitution={.08} contactSkin={.005}/>)}
      <VehicleModel/>
      {zones&&[-1,1].map(side=><mesh key={side} position={[side*(SUSPECT.width/2+.02),.6,SUSPECT.length*.375]}><boxGeometry args={[.035,.45,SUSPECT.length*.25]}/><meshBasicMaterial color="#38f0c0" transparent opacity={.7}/></mesh>)}
    </RigidBody>
  </>;
}
