import type {World,RigidBody} from '@dimforge/rapier3d-compat';
import type {VehicleDamage} from '../types/game.ts';
import {applySeverityDamage} from './vehicleDamage.ts';
import {inverseRotateVehicleVector,type VehicleFrame} from './vehiclePose.ts';
import {vehiclePhysicsConfig,type PhysicsVehicleKind} from './vehiclePhysicsConfig.ts';

type Actor={body:RigidBody;kind:PhysicsVehicleKind;damage:VehicleDamage;before:VehicleFrame};
type Episode={lastAt:number;max:Record<number,number>};
export type DamageEpisodes=Record<string,Episode>;
export const makeDamageEpisodes=():DamageEpisodes=>({});
type Impact={actor:number;severity:number;localX:number;localZ:number};

/** Contact damage is independent from PIT scoring; tyre ray contacts are excluded. */
export function sampleCollisionDamage(world:World,actors:Actor[],episodes:DamageEpisodes,at:number):VehicleDamage[] {
  const impacts=new Map<string,Map<number,Impact>>();
  const actorByHandle=new Map(actors.map((actor,index)=>[actor.body.handle,index]));
  for(let i=0;i<actors.length;i++){
    const actor=actors[i],p=actor.body.translation();
    for(let n=0;n<actor.body.numColliders();n++){
      const collider=actor.body.collider(n);
      world.contactPairsWith(collider,other=>{
        const parent=other.parent(),j=parent?actorByHandle.get(parent.handle):undefined;
        if(j===i||other.isSensor())return;
        const group=(other.collisionGroups()>>>16)&0xffff;
        const environment=j===undefined?(group&4?'barrier':group&1?'ground':null):null;
        if(j===undefined&&!environment)return;
        const key=j===undefined?`${i}:${environment}`:`${Math.min(i,j)}:${Math.max(i,j)}`;
        world.contactPair(collider,other,manifold=>{
          if(!manifold.numSolverContacts())return;
          let bucket=impacts.get(key);if(!bucket){bucket=new Map();impacts.set(key,bucket);}
          const normal=manifold.normal();
          for(let k=0;k<manifold.numSolverContacts();k++){
            const point=manifold.solverContactPoint(k);
            const sign=normal.x*(point.x-p.x)+normal.y*(point.y-p.y)+normal.z*(point.z-p.z)>=0?1:-1;
            const otherFrame=j===undefined?undefined:actors[j].before;
            const relative={x:actor.before.velocityX-(otherFrame?.velocityX??0),y:actor.before.velocityY-(otherFrame?.velocityY??0),z:actor.before.velocityZ-(otherFrame?.velocityZ??0)};
            const approach=Math.max(0,sign*(relative.x*normal.x+relative.y*normal.y+relative.z*normal.z));
            const severity=Math.max(0,Math.min(.72,(approach*2-2)/26));
            if(severity>(bucket.get(i)?.severity??0)){
              const local=inverseRotateVehicleVector({x:point.x-p.x,y:point.y-p.y,z:point.z-p.z},actor.body.rotation());
              bucket.set(i,{actor:i,severity,localX:local.x,localZ:local.z});
            }
          }
        });
      });
    }
  }
  for(const key of Object.keys(episodes))if(at-episodes[key].lastAt>=.1-1e-8&&!impacts.has(key))delete episodes[key];
  const result=actors.map(a=>a.damage);
  for(const [key,bucket] of impacts){
    const ep=episodes[key]??={lastAt:at,max:{}};
    ep.lastAt=at;
    for(const hit of bucket.values()){
      const previous=ep.max[hit.actor]??0,delta=Math.max(0,hit.severity-previous);
      ep.max[hit.actor]=Math.max(previous,hit.severity);
      if(!delta)continue;
      const p=vehiclePhysicsConfig(actors[hit.actor].kind);
      result[hit.actor]=applySeverityDamage(result[hit.actor],{impulse:0,localX:hit.localX,localZ:hit.localZ,halfWidth:p.width/2,halfLength:p.length/2},delta);
    }
  }
  return result;
}
