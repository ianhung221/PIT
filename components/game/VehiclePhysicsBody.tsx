"use client";
import { useEffect,useLayoutEffect,useRef,type ReactNode,type RefObject } from 'react';
import { RigidBody,CuboidCollider,useRapier,type RapierRigidBody } from '@react-three/rapier';
import { chassisShapes,vehicleSpawnHeight,CHASSIS_COLLISION_GROUPS,type PhysicsVehicleKind } from '@/lib/vehiclePhysicsConfig';
import { createVehiclePhysics,removeVehiclePhysics,type VehiclePhysics } from '@/lib/vehiclePhysics';

/** Chassis, mass distribution and controller lifecycle shared by every driver. */
export function VehiclePhysicsBody({bodyRef,kind,name,x=0,z=0,groundY=-.505,velocity=[0,0,0],children}:{
  bodyRef:RefObject<RapierRigidBody|null>;kind:PhysicsVehicleKind;name:string;
  x?:number;z?:number;groundY?:number;velocity?:[number,number,number];children:ReactNode;
}) {
  const {world}=useRapier();const core=useRef<VehiclePhysics|null>(null);
  // Layout cleanup precedes Physics' passive world.free() on full scene exit.
  useLayoutEffect(()=>()=>{if(core.current)removeVehiclePhysics(core.current);core.current=null;},[world,kind]);
  useEffect(()=>{
    const body=bodyRef.current;if(!body)return;
    const vehicle=createVehiclePhysics(world,body,kind);core.current=vehicle;
    return()=>{removeVehiclePhysics(vehicle);if(core.current===vehicle)core.current=null;};
  },[world,bodyRef,kind]);
  return <RigidBody ref={bodyRef} name={name} colliders={false}
    position={[x,vehicleSpawnHeight(kind,groundY),z]} linearVelocity={velocity}
    linearDamping={0} angularDamping={.1} ccd canSleep={false}>
    {chassisShapes(kind).map((shape,i)=><CuboidCollider key={i} args={shape.halfExtents}
      position={shape.position} mass={shape.massKg} collisionGroups={CHASSIS_COLLISION_GROUPS}
      friction={.68} restitution={.04} contactSkin={.005}/>)}
    {children}
  </RigidBody>;
}
