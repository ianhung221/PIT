import {RAPIER} from './vehicle-world.mjs';
import {networkGeometry,networkSupportShapes} from '../../lib/networkGeometry.ts';
import {SHOULDER_SURFACE_Y,GROUND_COLLISION_GROUPS,BARRIER_COLLISION_GROUPS} from '../../lib/groundPhysics.ts';

export function installNetwork(s,n){
 s.world.removeCollider(s.ground,true);
 const b=n.bounds,g=networkGeometry(n);
 const box=(x,z,hx,hz,y,hy,groups)=>s.world.createCollider(RAPIER.ColliderDesc.cuboid(hx,hy,hz).setTranslation(x,y,z).setCollisionGroups(groups).setFriction(.7));
 box((b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,(b.maxX-b.minX)/2+20,(b.maxZ-b.minZ)/2+20,SHOULDER_SURFACE_Y-.5,.5,GROUND_COLLISION_GROUPS);
 for(const p of networkSupportShapes(g.surfaces)){
  const shape=p.halfSize?RAPIER.ColliderDesc.cuboid(...p.halfSize).setTranslation(p.position[0],p.position[1]-.1,p.position[2]):RAPIER.ColliderDesc.convexHull(p.vertices).setTranslation(...p.position);
  s.world.createCollider(shape.setCollisionGroups(GROUND_COLLISION_GROUPS).setFriction(.7).setRestitution(.02));
 }
 for(const o of [...g.walls,...n.objects])box(o.x,o.z,o.halfX,o.halfZ,SHOULDER_SURFACE_Y+o.height/2,o.height/2,BARRIER_COLLISION_GROUPS);
}
