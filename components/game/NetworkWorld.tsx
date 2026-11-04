"use client";
/* eslint-disable react/no-unknown-property -- Three.js properties in R3F. */
import { memo, useEffect, useMemo, useState, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, ConvexHullCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { RoadNetwork } from '@/lib/roadNetwork';
import { networkGeometry,networkGroundSections,networkSupportShapes,roadStrip } from '@/lib/networkGeometry';
import { ROAD_SURFACE_Y, SHOULDER_SURFACE_Y, GROUND_COLLISION_GROUPS, BARRIER_COLLISION_GROUPS } from '@/lib/groundPhysics';
import type { RoadSection } from '@/lib/roadGeometry';
import type { CarSnapshot } from '@/types/game';

function mergedSurface(sections: RoadSection[], y: number) {
  const points:number[]=[];
  for(const s of sections)for(const p of [s.startLeft,s.startRight,s.endLeft,s.startRight,s.endRight,s.endLeft])points.push(p.x,y,p.z);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.computeVertexNormals();return g;
}
function TownSign({label}:{label:string}){
 const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const c=canvas.getContext('2d')!;c.fillStyle='#246553';c.fillRect(0,0,512,256);c.strokeStyle='#e2eee7';c.lineWidth=8;c.strokeRect(10,10,492,236);c.fillStyle='#fff';c.font='bold 78px sans-serif';c.textAlign='center';c.fillText(label,256,150);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;},[label]);
 useEffect(()=>()=>texture.dispose(),[texture]);
 return <mesh position={[0,1.2,0]} castShadow><boxGeometry args={[3.2,2.4,.3]}/><meshStandardMaterial map={texture}/></mesh>;
}
export const NetworkWorld=memo(function NetworkWorld({network,weather='clear',cars}:{network:RoadNetwork;weather?:'clear'|'rain'|'snow';cars:MutableRefObject<{player:CarSnapshot;suspect:CarSnapshot;supports:CarSnapshot[]}>}) {
 const geometry=useMemo(()=>networkGeometry(network),[network]);
 const supports=useMemo(()=>networkSupportShapes(geometry.surfaces),[geometry]);
 const [visible,setVisible]=useState(()=>network.objects.map(o=>o.id));const tick=useRef(0);
 useFrame((_,dt)=>{tick.current+=dt;if(tick.current<.3)return;tick.current=0;const points=[cars.current.player,cars.current.suspect,...cars.current.supports];
   const ids=network.objects.filter(o=>points.some(p=>Math.hypot(p.x-o.x,p.z-o.z)<550+Math.abs(p.speed)*2)).map(o=>o.id);
   setVisible(old=>old.join(',')===ids.join(',')?old:ids);
 });
 const meshes=useMemo(()=>{
   const road=mergedSurface(geometry.surfaces.map(s=>s.section),ROAD_SURFACE_Y);
   const stripes:RoadSection[]=[];
   for(const {section:s,junction} of geometry.surfaces){if(junction)continue;
     const length=Math.hypot(s.end.x-s.start.x,s.end.z-s.start.z),dx=(s.end.x-s.start.x)/length,dz=(s.end.z-s.start.z)/length;
     for(let d=3;d<length-3;d+=12){const end=Math.min(d+6,length-2);
       stripes.push(roadStrip({x:s.start.x+dx*d,z:s.start.z+dz*d},{x:s.start.x+dx*end,z:s.start.z+dz*end},.14));
     }
   }
   return {road,ground:mergedSurface(networkGroundSections(network,geometry.surfaces),SHOULDER_SURFACE_Y),markings:mergedSurface(stripes,ROAD_SURFACE_Y+.02)};
 },[geometry,network]);
 useEffect(()=>()=>{meshes.road.dispose();meshes.ground.dispose();meshes.markings.dispose();},[meshes]);
 const b=network.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,hx=(b.maxX-b.minX)/2+20,hz=(b.maxZ-b.minZ)/2+20;
 const collision=useMemo(()=><RigidBody type="fixed" colliders={false} name="network-collision">
   <CuboidCollider args={[hx,.5,hz]} position={[cx,SHOULDER_SURFACE_Y-.5,cz]} collisionGroups={GROUND_COLLISION_GROUPS}/>
   {supports.map((s,i)=>s.halfSize?<CuboidCollider key={geometry.surfaces[i].id} args={s.halfSize} position={[s.position[0],s.position[1]-.1,s.position[2]]} collisionGroups={GROUND_COLLISION_GROUPS} friction={.7} restitution={.02}/>:<ConvexHullCollider key={geometry.surfaces[i].id} args={[s.vertices]} position={s.position} collisionGroups={GROUND_COLLISION_GROUPS} friction={.7} restitution={.02}/>)}
   {geometry.walls.map(w=><CuboidCollider key={w.id} args={[w.halfX,w.height/2,w.halfZ]} position={[w.x,SHOULDER_SURFACE_Y+w.height/2,w.z]} collisionGroups={BARRIER_COLLISION_GROUPS} friction={.74} restitution={.06}/>)}
   {network.objects.map(o=><CuboidCollider key={o.id} args={[o.halfX,o.height/2,o.halfZ]} position={[o.x,SHOULDER_SURFACE_Y+o.height/2,o.z]} collisionGroups={BARRIER_COLLISION_GROUPS} friction={.74} restitution={.06}/>)}
  </RigidBody>,[geometry,supports,network,hx,hz,cx,cz]);
 return <group name="network-world">
  <mesh geometry={meshes.ground} receiveShadow><meshStandardMaterial color={weather==='snow'?'#c4cbca':'#344731'}/></mesh>
  <mesh geometry={meshes.road} receiveShadow><meshStandardMaterial color={weather==='snow'?'#8d9695':'#303539'} roughness={weather==='rain'?.25:.85}/></mesh>
  <mesh geometry={meshes.markings}><meshStandardMaterial color="#e1d9b2"/></mesh>
  {/* Resident collision must not rerender when the visible object window changes. */}
  {collision}
  {geometry.walls.map(w=><mesh key={w.id} position={[w.x,SHOULDER_SURFACE_Y+w.height/2,w.z]}><boxGeometry args={[w.halfX*2,w.height,w.halfZ*2]}/><meshStandardMaterial color="#8b9391"/></mesh>)}
  {network.objects.filter(o=>visible.includes(o.id)).map(o=><group key={o.id} position={[o.x,SHOULDER_SURFACE_Y,o.z]}>
    {o.kind==='sign'?<TownSign label={o.label!}/>:<mesh position={[0,o.height/2,0]} castShadow><boxGeometry args={[o.halfX*2,o.height,o.halfZ*2]}/><meshStandardMaterial color={o.kind==='tree'?'#514130':o.color}/></mesh>}
    {o.kind==='tree'&&<mesh position={[0,o.height*.7,0]} castShadow><coneGeometry args={[2.6,o.height*.8,7]}/><meshStandardMaterial color={weather==='snow'?'#a2b6a5':o.color}/></mesh>}
  </group>)}
 </group>;
});
