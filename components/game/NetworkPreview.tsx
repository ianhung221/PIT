"use client";
/* eslint-disable react/no-unknown-property -- R3F scene properties. */
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, useBeforePhysicsStep, useAfterPhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import { Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { generateNetwork } from '@/lib/networkGenerator';
import { networkIndex } from '@/lib/roadNetwork';
import type { RoadNetwork } from '@/lib/roadNetwork';
import { NetworkWorld } from './NetworkWorld';
import { VehiclePhysicsBody } from './VehiclePhysicsBody';
import { VehicleModel } from './VehicleModel';
import { applyPlayerForces } from '@/lib/playerVehicleForces';
import { makePlayerDriving } from '@/lib/playerDriving';
import { pristineDamage } from '@/lib/vehicleDamage';
import { readVehicleFrame } from '@/lib/vehiclePose';
import { getVehiclePhysics, physicsSnapshot, sampleVehiclePhysics } from '@/lib/vehiclePhysics';
import { FixedPhysicsStepper } from './FixedPhysicsStepper';
import type { CarSnapshot } from '@/types/game';
import {routePoints,shortestRoute} from '@/lib/roadRouting';
import {followNetworkRoute} from '@/lib/networkDriving';
import {driveVehicleTarget} from '@/lib/vehicleDriver';
import type {PhysicsVehicleKind} from '@/lib/vehiclePhysicsConfig';
import {WEATHER} from '@/lib/gameConfig';

function PreviewScene({network}:{network:RoadNetwork}) {
 const body=useRef<RapierRigidBody>(null),keys=useRef(new Set<string>()),driving=useRef(makePlayerDriving()),damage=useRef(pristineDamage());
 const node=networkIndex(network).nodes.get(network.spawn.from)!;
 const options=useMemo(()=>new URLSearchParams(location.search),[]),automatic=options.get('auto')==='1';
 const requested=options.get('vehicle')??'patrol',kind:PhysicsVehicleKind=['patrol','interceptor','suv','suspect'].includes(requested)?requested as PhysicsVehicleKind:'patrol';
 const weather=options.get('weather')==='snow'?'snow':options.get('weather')==='rain'?'rain':'clear';
 const grip=WEATHER[weather].grip;
 const points=useMemo(()=>routePoints(network,shortestRoute(network,'t0-0-0','t0-2-2')!),[network]);
 const progress=useRef({index:0}),metrics=useRef({elapsed:0,maxDeviation:0,reached:false});
 const initial:CarSnapshot=automatic?{...points[0],yaw:Math.atan2(-(points[1].x-points[0].x),-(points[1].z-points[0].z)),speed:0,lateralSpeed:0}:{x:node.x,z:node.z-40,yaw:0,speed:0,lateralSpeed:0};
 const cars=useRef({player:initial,suspect:initial,supports:[] as CarSnapshot[]});
 useEffect(()=>{const w=window as unknown as Record<string,unknown>;w.__pitNetworkPreview=()=>({network,cars:cars.current,body:body.current,driving:driving.current,metrics:metrics.current});return()=>{delete w.__pitNetworkPreview;};},[network]);
 useEffect(()=>{const down=(e:KeyboardEvent)=>{if(e.key.startsWith('Arrow'))e.preventDefault();keys.current.add(e.key.toLowerCase());};const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());const blur=()=>keys.current.clear();window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};},[]);
 useBeforePhysicsStep(world=>{const b=body.current;if(!b)return;const f=readVehicleFrame(b),core=getVehiclePhysics(b);metrics.current.elapsed+=world.timestep;
  if(automatic&&core){const target=followNetworkRoute(physicsSnapshot(core),points,progress.current,grip);metrics.current.maxDeviation=Math.max(metrics.current.maxDeviation,target.deviation);metrics.current.reached=progress.current.index>points.length-5&&target.remaining<4;driveVehicleTarget(core,target,grip,damage.current,world.timestep,f);}
  else applyPlayerForces(b,f,driving.current,damage.current,keys.current,kind==='suspect'?'patrol':kind,grip,world.timestep,f);
 });
 useAfterPhysicsStep(world=>{const b=body.current;if(!b)return;const core=getVehiclePhysics(b);if(core){sampleVehiclePhysics(core,world.timestep);cars.current.player=physicsSnapshot(core);cars.current.suspect=cars.current.player;}});
 useFrame(({camera})=>{const p=cars.current.player;camera.position.set(p.x,90,p.z+80);camera.lookAt(p.x,0,p.z-30);});
 return <><NetworkWorld network={network} cars={cars} weather={weather}/><VehiclePhysicsBody bodyRef={body} kind={kind} name="preview-player" x={initial.x} z={initial.z} yaw={initial.yaw}><VehicleModel police={kind!=='suspect'} model={kind==='suspect'?undefined:kind}/></VehiclePhysicsBody><FixedPhysicsStepper running={()=>!metrics.current.reached}/></>;
}
const subscribeHost=()=>()=>{};
export function NetworkPreview(){
 const allowed=useSyncExternalStore(subscribeHost,()=>['localhost','127.0.0.1'].includes(location.hostname),()=>false);
 const network=useMemo(()=>generateNetwork('4A-PREVIEW'),[]);
 if(!allowed)return <p>此道路原型僅供本機驗證。</p>;
 return <main style={{height:'100vh',background:'#78909c'}}><p style={{position:'absolute',zIndex:2,padding:12}}>4A 道路原型 · {network.code} · 方向鍵駕駛（非正式任務）</p><Canvas camera={{position:[0,90,80],near:.1,far:1200}}><color attach="background" args={['#9db5c4']}/><ambientLight intensity={1.4}/><directionalLight position={[100,150,40]} intensity={2}/><Suspense fallback={null}><Physics paused timeStep={1/60} numSolverIterations={8} maxCcdSubsteps={4} colliders={false} gravity={[0,-9.81,0]}><PreviewScene network={network}/></Physics></Suspense></Canvas></main>;
}
