import { SUSPECT, VEHICLES, vehicleColliderStrips } from './gameConfig.ts';
import type { VehicleId } from './gameConfig.ts';

export type PhysicsVehicleKind=VehicleId|'suspect';
export const CHASSIS_COLLISION_GROUPS=(2<<16)|0xffff;
export const WHEEL_QUERY_GROUPS=(0xffff<<16)|1;
export const VEHICLE_GRAVITY=9.81;
// Metres, kilograms and seconds. Geometry follows the existing transformed GLBs;
// suspension/forces are game tuning, not specifications of a real vehicle.
const measured={
  patrol:{massKg:1050,track:1.215,frontZ:-1.2312,rearZ:1.2312,radius:.3,wheelY:.12,roofY:1.12,chassisY:.25,maxSteer:.59},
  interceptor:{massKg:900,track:1.62,frontZ:-1.1262,rearZ:1.549,radius:.36,wheelY:.18,roofY:.699,chassisY:.2,maxSteer:.61},
  suv:{massKg:1350,track:1.2155,frontZ:-1.233,rearZ:1.143,radius:.336,wheelY:.156,roofY:1.276,chassisY:.32,maxSteer:.57},
  suspect:{massKg:1000,track:1.275,frontZ:-1.1782,rearZ:1.0922,radius:.324,wheelY:.144,roofY:1.008,chassisY:.24,maxSteer:.59},
} as const;
function buildPhysicsConfig(kind:PhysicsVehicleKind) {
  const dimensions=kind==='suspect'?SUSPECT:VEHICLES[kind],m=measured[kind];
  const stiffness=32,restLength=.28,compression=VEHICLE_GRAVITY/(4*stiffness);
  return {...m,kind,width:dimensions.width,length:dimensions.length,wheelbase:m.rearZ-m.frontZ,
    acceleration:kind==='suspect'?14:VEHICLES[kind].acceleration,maxSpeed:kind==='suspect'?43:VEHICLES[kind].maxSpeed,
    suspension:{restLength,stiffness,compressionDamping:4.5,relaxationDamping:5.5,maxTravel:.16},
    mountY:m.wheelY+restLength-compression,
    // All four models share the same measured lower wheel envelope (-.18).
    rideHeight:.18,frictionSlip:1,sideStiffness:1,
  };
}
const physicsConfigs={patrol:buildPhysicsConfig('patrol'),interceptor:buildPhysicsConfig('interceptor'),suv:buildPhysicsConfig('suv'),suspect:buildPhysicsConfig('suspect')};
export function vehiclePhysicsConfig(kind:PhysicsVehicleKind){return physicsConfigs[kind];}
export function vehicleSpawnHeight(kind:PhysicsVehicleKind,groundY=-.505) {return groundY+vehiclePhysicsConfig(kind).rideHeight;}
function buildChassisShapes(kind:PhysicsVehicleKind) {
  const p=vehiclePhysicsConfig(kind);
  const shapes=vehicleColliderStrips(kind).map(s=>({halfExtents:[s.halfWidth,.2,s.halfLength] as [number,number,number],
    position:[0,p.chassisY,s.z] as [number,number,number],massKg:p.massKg*.98/3,part:'body' as const}));
  // A smaller upper cabin permits actual roof-ground contact while leaving the
  // existing longitudinal side faces and rear-quarter definitions unchanged.
  return [...shapes,{halfExtents:[p.width*.36,(p.roofY-p.chassisY-.2)/2,p.length*.25] as [number,number,number],
    position:[0,(p.roofY+p.chassisY+.2)/2,0] as [number,number,number],massKg:p.massKg*.02,part:'roof' as const}];
}
const shapeCache={patrol:buildChassisShapes('patrol'),interceptor:buildChassisShapes('interceptor'),suv:buildChassisShapes('suv'),suspect:buildChassisShapes('suspect')};
export function chassisShapes(kind:PhysicsVehicleKind){return shapeCache[kind];}
