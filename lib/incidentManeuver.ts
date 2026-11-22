import type {RoadNetwork} from './roadNetwork.ts';
import {carBox,drivingPoint,nearbyDrivingObjects,type DrivingCar,type DrivingBox} from './drivingObservation.ts';
import {vehiclePhysicsConfig} from './vehiclePhysicsConfig.ts';

type Pose={x:number;z:number;yaw:number};
export type ManeuverPoint=Pose&{gear:1|-1};
export interface IncidentManeuver {points:ManeuverPoint[];index:number;elapsed:number;stoppedFor:number;nodes:number;lastYaw?:number;goal?:Pose}
const angle=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
const distance=(a:Pose,b:Pose)=>Math.hypot(a.x-b.x,a.z-b.z);
type PreparedObstacle=DrivingBox&{cos:number;sin:number;extentX:number;extentZ:number};
const prepareObstacle=(box:DrivingBox):PreparedObstacle=>{
 const cos=Math.cos(box.yaw),sin=Math.sin(box.yaw);
 return {...box,cos,sin,extentX:Math.abs(cos)*box.halfX+Math.abs(sin)*box.halfZ,extentZ:Math.abs(sin)*box.halfX+Math.abs(cos)*box.halfZ};
};

/** Short car-shaped forward/reverse arcs, not a point path or chassis motor.
 * Search is bounded and only used after a low-speed approach stalls. */
export function* createIncidentSearch(network:RoadNetwork,car:DrivingCar,goal:Pose,incident:Pose,neighbors:DrivingCar[],maxNodes=5000,withinSurface?:(box:DrivingBox)=>boolean,goalWeight=1.3):Generator<number,IncidentManeuver|null,void>{
 const rear=vehiclePhysicsConfig(car.model??'patrol').rearZ;
 const objects=nearbyDrivingObjects(network,incident,36);
 const obstacles=[...objects,...neighbors.map(c=>carBox(c,.2))].map(prepareObstacle);
 const footprint=carBox(car,.35);
 const clear=(p:Pose)=>{
  const box={x:p.x,z:p.z,yaw:p.yaw,halfX:footprint.halfX,halfZ:footprint.halfZ};
  return (!withinSurface||withinSurface(box))&&incidentPoseClear(network,box,incident,obstacles);
 };
 if(!clear(car)||!clear(goal))return null;
 type Node={pose:Pose;gear:1|-1;cost:number;score:number;parent:Node|null;arc:ManeuverPoint[]};
 const heap:Node[]=[],seen=new Map<string,number>();
 const heuristic=(p:Pose)=>distance(p,goal)+2*Math.abs(angle(goal.yaw-p.yaw));
 const push=(node:Node)=>{heap.push(node);let i=heap.length-1;while(i){const parent=(i-1)>>1;if(heap[parent].score<=node.score)break;heap[i]=heap[parent];i=parent;}heap[i]=node;};
 const pop=()=>{const node=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].score<heap[child].score)child++;if(heap[child].score>=last.score)break;heap[i]=heap[child];i=child;}heap[i]=last;}return node;};
 push({pose:car,gear:1,cost:0,score:heuristic(car),parent:null,arc:[]});
 let visited=0;
 while(heap.length&&visited++<maxNodes){
  const node=pop();
  yield visited;
  if(distance(node.pose,goal)<.35&&Math.abs(angle(node.pose.yaw-goal.yaw))<.1){
   const arcs:ManeuverPoint[][]=[];for(let n:Node|null=node;n?.parent;n=n.parent)arcs.unshift(n.arc);
   return {points:arcs.flat(),index:0,elapsed:0,stoppedFor:0,nodes:visited,goal:{...goal}};
  }
  if(node.cost>65)continue;
  const shortArcs=distance(node.pose,goal)<5;
  for(const gear of [1,-1] as const)for(const curvature of [0,-.2,.2,-.1,.1]){
   let p=node.pose;const arc:ManeuverPoint[]=[];
   // The short candidates are prefixes of the same eight-step swept arc.
   // Check each pose once; copy a prefix only when it enters the frontier.
   for(let i=0;i<8;i++){
    const ds=gear*.25,da=ds*curvature;
    const axle=drivingPoint(p,0,-rear),yaw=angle(p.yaw+da);
    p={x:axle.x-Math.sin(p.yaw+da/2)*ds-Math.sin(yaw)*rear,z:axle.z-Math.cos(p.yaw+da/2)*ds-Math.cos(yaw)*rear,yaw};
    if(!clear(p))break;arc.push({...p,gear});
    const steps=i+1;
    if(steps!==8&&!(shortArcs&&(steps===2||steps===4)))continue;
    const cost=node.cost+steps*.25+(gear<0?.3:0)+(node.parent&&node.gear!==gear?2:0);
    const key=`${Math.round(p.x/.3)},${Math.round(p.z/.3)},${Math.round(p.yaw/.1)},${gear}`;
    if(cost>=(seen.get(key)??Infinity))continue;seen.set(key,cost);
    push({pose:p,gear,cost,score:cost+heuristic(p)*goalWeight,parent:node,arc:arc.slice()});
   }
  }
 }
 return null;
}

/** Synchronous entry point for isolated tests; the game advances the generator
 * under a time/node budget and brakes while planning. */
export function planIncidentManeuver(...args:Parameters<typeof createIncidentSearch>){
 const search=createIncidentSearch(...args);let result=search.next();while(!result.done)result=search.next();return result.value;
}
export function advanceIncidentSearch(search:ReturnType<typeof createIncidentSearch>,budgetMs=1.5,maxNodes=32){
 const started=performance.now();let count=0;
 do{const result=search.next();if(result.done)return {done:true as const,plan:result.value};count++;}while(count<maxNodes&&performance.now()-started<budgetMs);
 return {done:false as const,plan:null};
}

/** All candidates share the caller's time/node slice, one node per turn. */
export function* interleaveIncidentSearches(searches:ReturnType<typeof createIncidentSearch>[],onExhausted?:(index:number)=>void):Generator<number,IncidentManeuver|null,void>{
 const active=searches.map((search,index)=>({search,index}));let cursor=0,visited=0;
 try{
 while(active.length){
  const candidate=active[cursor],result=candidate.search.next();
  if(result.done){
   if(result.value)return result.value;
   onExhausted?.(candidate.index);
   active.splice(cursor,1);if(cursor>=active.length)cursor=0;
  }else{cursor=(cursor+1)%active.length;yield ++visited;}
 }
 return null;
 }finally{for(const candidate of active)candidate.search.return(null);}
}

function incidentPoseClear(network:RoadNetwork,box:DrivingBox,incident:Pose,obstacles:PreparedObstacle[]){
 const b=network.bounds,c=Math.cos(box.yaw),s=Math.sin(box.yaw);
 // This runs for every swept pose. Reuse trig and dimensions instead of
 // cloning full vehicle snapshots and allocating corner arrays per query.
 for(let side=-1;side<=1;side+=2)for(let forward=-1;forward<=1;forward+=2){
  const x=box.x+c*side*box.halfX-s*forward*box.halfZ;
  const z=box.z-s*side*box.halfX-c*forward*box.halfZ;
  const dx=x-incident.x,dz=z-incident.z;
  if(dx*dx+dz*dz>=32*32||x<=b.minX||x>=b.maxX||z<=b.minZ||z>=b.maxZ)return false;
 }
 const extentX=Math.abs(c)*box.halfX+Math.abs(s)*box.halfZ,extentZ=Math.abs(s)*box.halfX+Math.abs(c)*box.halfZ;
 for(const other of obstacles){
  const dx=other.x-box.x,dz=other.z-box.z;
  if(Math.abs(dx)>=extentX+other.extentX||Math.abs(dz)>=extentZ+other.extentZ)continue;
  // Same four separating axes as boxesOverlap; obstacle orientation is fixed
  // for this search snapshot, so its trig does not need repeating per arc.
  const aligned=Math.abs(c*other.cos+s*other.sin),crossed=Math.abs(s*other.cos-c*other.sin);
  if(Math.abs(dx*c-dz*s)<box.halfX+other.halfX*aligned+other.halfZ*crossed
   &&Math.abs(dx*s+dz*c)<box.halfZ+other.halfX*crossed+other.halfZ*aligned
   &&Math.abs(dx*other.cos-dz*other.sin)<other.halfX+box.halfX*aligned+box.halfZ*crossed
   &&Math.abs(dx*other.sin+dz*other.cos)<other.halfZ+box.halfX*crossed+box.halfZ*aligned)return false;
 }
 return true;
}

export function driveIncidentManeuver(plan:IncidentManeuver,network:RoadNetwork,car:DrivingCar,incident:Pose,neighbors:DrivingCar[],dt:number,grip:number,withinSurface?:(box:DrivingBox)=>boolean){
 plan.elapsed+=dt;
 const stop=(status:'blocked'|'done',reason='')=>({speed:0,yawError:0,status,reason});
 if(!plan.points.length)return stop('done');
 const rear=vehiclePhysicsConfig(car.model??'patrol').rearZ;
 const tracking={...drivingPoint(car,0,-rear),yaw:car.yaw};
 const axle=(p:Pose)=>({...drivingPoint(p,0,-rear),yaw:p.yaw});
 const start=plan.points[plan.index];
 // Advance only inside this gear segment; stop before changing direction.
 let end=plan.index;while(end+1<plan.points.length&&plan.points[end+1].gear===start.gear)end++;
 let nearest=plan.index;for(let i=plan.index;i<=Math.min(end,plan.index+16);i++)if(distance(tracking,axle(plan.points[i]))<distance(tracking,axle(plan.points[nearest])))nearest=i;
 plan.index=nearest;
 const endDistance=distance(tracking,axle(plan.points[end]));
 if(endDistance<.25){
  if(Math.hypot(car.speed,car.lateralSpeed)>.2)return {speed:0,yawError:0,status:'driving' as const};
  if(end===plan.points.length-1)return stop('done');
  plan.index=end+1;return {speed:0,yawError:0,status:'driving' as const};
 }
 if(distance(car,plan.points[nearest])>2||plan.elapsed>45)return stop('blocked','偏離路徑或機動逾時');
 const obstacles=[...nearbyDrivingObjects(network,car,10),...neighbors.flatMap(c=>[0,.75].map(t=>({...carBox(c,.2),...drivingPoint(c,c.lateralSpeed*t,c.speed*t)})))].map(prepareObstacle);
 if(!incidentPoseClear(network,carBox(car,.15),incident,obstacles))return stop('blocked','目前車身安全空間不足');
 for(let i=nearest;i<=Math.min(end,nearest+12);i++){
  const footprint=carBox({...car,...plan.points[i]},.2);
  if((withinSurface&&!withinSurface(footprint))||!incidentPoseClear(network,footprint,incident,obstacles))return stop('blocked','前方路徑安全空間不足');
 }
 const routeTarget=axle(plan.points[Math.min(end,nearest+6)]);
 // At a gear change the last arc is short. Aim along its tangent rather than
 // chasing a point beside the axle, which demands an impossible last-second turn.
 const target=nearest+6>=end?drivingPoint(routeTarget,0,start.gear*1.5):routeTarget;
 const dx=target.x-tracking.x,dz=target.z-tracking.z,side=dx*Math.cos(car.yaw)-dz*Math.sin(car.yaw);
 const curvature=-2*side/Math.max(.25,dx*dx+dz*dz);
 const rate=plan.lastYaw===undefined?0:angle(car.yaw-plan.lastYaw)/dt;plan.lastYaw=car.yaw;
 const signedSpeed=(Math.abs(car.speed)>.6?Math.sign(car.speed):start.gear)*Math.max(2,Math.abs(car.speed));
 const yawError=(curvature*signedSpeed+rate*.25)/1.8;
 return {speed:start.gear*Math.min(1.5*Math.sqrt(grip),Math.sqrt(Math.max(0,endDistance-.12)*2)),yawError,status:'driving' as const};
}
