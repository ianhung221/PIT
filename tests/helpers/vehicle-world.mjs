import RAPIER from '@dimforge/rapier3d-compat';
import { chassisShapes,vehicleSpawnHeight,CHASSIS_COLLISION_GROUPS } from '../../lib/vehiclePhysicsConfig.ts';
import { createVehiclePhysics,stepVehiclePhysics,removeVehiclePhysics,physicsSnapshot } from '../../lib/vehiclePhysics.ts';
export { RAPIER,stepVehiclePhysics,physicsSnapshot };
export function physicalWorld(kind='patrol',groundY=-.505) {
  const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/60;
  world.integrationParameters.numSolverIterations=8;
  world.integrationParameters.maxCcdSubsteps=4;
  const ground=world.createCollider(RAPIER.ColliderDesc.cuboid(1500,.5,1500).setTranslation(0,groundY-.5,0).setCollisionGroups((1<<16)|0xffff).setFriction(.7).setRestitution(.02));
  const add=(kind,x=0,z=0)=>{
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,vehicleSpawnHeight(kind,groundY),z).setLinearDamping(0).setAngularDamping(.1).setCanSleep(false).setCcdEnabled(true));
    for(const s of chassisShapes(kind))world.createCollider(RAPIER.ColliderDesc.cuboid(...s.halfExtents).setTranslation(...s.position).setMass(s.massKg).setFriction(.68).setRestitution(.04).setContactSkin(.005).setCollisionGroups(CHASSIS_COLLISION_GROUPS),body);
    return createVehiclePhysics(world,body,kind);
  };
  const vehicle=add(kind);
  return {world,ground,vehicle,add,step(input={throttle:0,brake:0,steer:0,gear:1},grip=1,damage){stepVehiclePhysics(vehicle,input,grip,damage);world.step();},
    dispose(){world.vehicleControllers.forEach(c=>world.removeVehicleController(c));world.free();},remove(vehicle){removeVehiclePhysics(vehicle);world.removeRigidBody(vehicle.body);}};
}
