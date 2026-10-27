import type { RapierRigidBody as RigidBody, useRapier } from '@react-three/rapier';
type World=ReturnType<typeof useRapier>['world'];
import { localPoint, type PhysicalContact } from './pitContact.ts';
import { normalizeAngle } from './gameRules.ts';
import { SUSPECT, VEHICLES, type VehicleId } from './gameConfig.ts';
import type { DrivingFrame } from './playerVehicleForces.ts';
type Frame=DrivingFrame&{yaw:number};
// Aggregate every solver point, not the most favourable collider pair.
// Largest normal closing speed prevents averaging from hiding a hard hit.
export function physicalContactSample(world:World,p:RigidBody,s:RigidBody,pf:Frame,sf:Frame,pre:{player:Frame;suspect:Frame},vehicle:VehicleId,authorized:boolean):PhysicalContact|null {
  const pp=p.translation(),sp=s.translation();
  let x=0,z=0,nx=0,nz=0,count=0,normalSpeed=0;
  const dx=pre.player.velocityX-pre.suspect.velocityX,dz=pre.player.velocityZ-pre.suspect.velocityZ;
  for(let i=0;i<p.numColliders();i++)for(let j=0;j<s.numColliders();j++)world.contactPair(p.collider(i),s.collider(j),m=>{
    const n=m.normal(),sign=n.x*(sp.x-pp.x)+n.z*(sp.z-pp.z)>=0?1:-1;
    const normalX=n.x*sign,normalZ=n.z*sign;
    for(let k=0;k<m.numSolverContacts();k++) {
      const point=m.solverContactPoint(k);x+=point.x;z+=point.z;nx+=normalX;nz+=normalZ;count++;
      normalSpeed=Math.max(normalSpeed,dx*normalX+dz*normalZ);
    }
  });
  if(!count)return null;
  const local=localPoint({x:sp.x,z:sp.z,yaw:sf.yaw},{x:x/count,z:z/count});
  const pl=localPoint({x:pp.x,z:pp.z,yaw:pf.yaw},{x:x/count,z:z/count});
  return {localX:local.x,localZ:local.z,playerLocalX:pl.x,playerLocalZ:pl.z,
    normalSide:(nx*sf.rightX+nz*sf.rightZ)/count,normalSpeed,closingSpeed:Math.hypot(dx,dz),
    headingDelta:normalizeAngle(pre.player.yaw-pre.suspect.yaw),halfWidth:SUSPECT.width/2,halfLength:SUSPECT.length/2,
    playerHalfLength:VEHICLES[vehicle].length/2,authorized};
}
