import type { RapierRigidBody as RigidBody, useRapier } from '@react-three/rapier';
type World=ReturnType<typeof useRapier>['world'];
import { type PhysicalContact } from './pitContact.ts';
import { inverseRotateVehicleVector, readVehicleFrame, type VehicleFrame } from './vehiclePose.ts';
import { vehiclePhysicsConfig } from './vehiclePhysicsConfig.ts';
import { normalizeAngle } from './gameRules.ts';
import { SUSPECT, VEHICLES, type VehicleId } from './gameConfig.ts';
import type { DrivingFrame } from './playerVehicleForces.ts';
type Frame=(DrivingFrame&{yaw:number;velocityY?:number;headingValid?:boolean})|VehicleFrame;
// Aggregate every solver point, not the most favourable collider pair.
// Largest normal closing speed prevents averaging from hiding a hard hit.
export function physicalContactSample(world:World,p:RigidBody,s:RigidBody,pf:Frame,sf:Frame,pre:{player:Frame;suspect:Frame},vehicle:VehicleId,authorized:boolean):PhysicalContact|null {
  const pp=p.translation(),sp=s.translation();
  // A conservative rotation-independent sphere contains every chassis corner.
  // Distant cars cannot have solver contacts; avoid sixteen WASM pair queries.
  const pc=vehiclePhysicsConfig(vehicle),sc=vehiclePhysicsConfig('suspect');
  const reach=Math.hypot(pc.width/2,pc.length/2,pc.roofY)+Math.hypot(sc.width/2,sc.length/2,sc.roofY)+.1;
  if((sp.x-pp.x)**2+(sp.y-pp.y)**2+(sp.z-pp.z)**2>reach*reach)return null;
  const suspectFrame='quaternion' in sf?sf:readVehicleFrame(s,sf.yaw),playerFrame='quaternion' in pf?pf:readVehicleFrame(p,pf.yaw);
  const sideHeight=(height:number,kind:VehicleId|'suspect')=>Math.abs(height-vehiclePhysicsConfig(kind).chassisY)<=.23;
  let surfaceValid=true;
  let x=0,y=0,z=0,nx=0,ny=0,nz=0,count=0,normalSpeed=0;
  const dx=pre.player.velocityX-pre.suspect.velocityX,dy=(pre.player.velocityY??0)-(pre.suspect.velocityY??0),dz=pre.player.velocityZ-pre.suspect.velocityZ;
  for(let i=0;i<p.numColliders();i++)for(let j=0;j<s.numColliders();j++)world.contactPair(p.collider(i),s.collider(j),m=>{
    const n=m.normal(),sign=n.x*(sp.x-pp.x)+n.y*(sp.y-pp.y)+n.z*(sp.z-pp.z)>=0?1:-1;
    const normalX=n.x*sign,normalY=n.y*sign,normalZ=n.z*sign;
    for(let k=0;k<m.numSolverContacts();k++) {
      const point=m.solverContactPoint(k);x+=point.x;y+=point.y;z+=point.z;nx+=normalX;ny+=normalY;nz+=normalZ;count++;
      const sl=inverseRotateVehicleVector({x:point.x-sp.x,y:point.y-sp.y,z:point.z-sp.z},suspectFrame.quaternion);
      const pl=inverseRotateVehicleVector({x:point.x-pp.x,y:point.y-pp.y,z:point.z-pp.z},playerFrame.quaternion);
      const sn=inverseRotateVehicleVector({x:normalX,y:normalY,z:normalZ},suspectFrame.quaternion);
      surfaceValid=surfaceValid&&sideHeight(sl.y,'suspect')&&sideHeight(pl.y,vehicle)&&Math.abs(sn.y)<.6;
      normalSpeed=Math.max(normalSpeed,dx*normalX+dy*normalY+dz*normalZ);
    }
  });
  if(!count)return null;
  const local=inverseRotateVehicleVector({x:x/count-sp.x,y:y/count-sp.y,z:z/count-sp.z},suspectFrame.quaternion);
  const pl=inverseRotateVehicleVector({x:x/count-pp.x,y:y/count-pp.y,z:z/count-pp.z},playerFrame.quaternion);
  const normal=inverseRotateVehicleVector({x:nx/count,y:ny/count,z:nz/count},suspectFrame.quaternion);
  return {localX:local.x,localZ:local.z,playerLocalX:pl.x,playerLocalZ:pl.z,
    localY:local.y,playerLocalY:pl.y,
    surfaceValid,
    headingValid:suspectFrame.headingValid&&playerFrame.headingValid&&pre.player.headingValid!==false&&pre.suspect.headingValid!==false,
    normalSide:normal.x,normalSpeed,closingSpeed:Math.hypot(dx,dy,dz),
    headingDelta:normalizeAngle(pre.player.yaw-pre.suspect.yaw),halfWidth:SUSPECT.width/2,halfLength:SUSPECT.length/2,
    playerHalfLength:VEHICLES[vehicle].length/2,authorized};
}
