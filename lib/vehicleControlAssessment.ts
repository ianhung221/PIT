import { SUSPECT, vehicleColliderStrips, type VehicleId } from "./gameConfig.ts";
import type { CarSnapshot } from "../types/game.ts";
import type { RoadPoint, RoadSection } from "./roadGeometry.ts";

type Point = RoadPoint;
type Polygon = Point[];
export interface ControlCar extends CarSnapshot { model: VehicleId | "suspect"; angularSpeed: number }
export interface ControlAssessment {
  status: "moving" | "open" | "blocked" | "uncertain";
  reason: string;
  nodes: number;
}
export const CONTROL = { speed: .65, blockerSpeed: .45, angularSpeed: .12, hold: 1.2, disabledHold: 1.2, interval: .1, maxNodes: 180, step: .75, radius: 4.5, escapeDistance: 6 } as const;
export const initialControl = (): ControlAssessment => ({ status: "uncertain", reason: "等待車輛與道路資料", nodes: 0 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const center = (p: Polygon): Point => ({ x:p.reduce((s,v)=>s+v.x,0)/p.length, z:p.reduce((s,v)=>s+v.z,0)/p.length });

function hull(points: Point[]): Polygon {
  const sorted = [...points].sort((a,b)=>a.x-b.x || a.z-b.z);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) { while(out.length>1 && cross(out.at(-2)!,out.at(-1)!,p)<=0) out.pop(); out.push(p); }
    return out.slice(0,-1);
  };
  return [...half(sorted),...half([...sorted].reverse())];
}
function inside(p: Point, polygon: Polygon) {
  return polygon.every((a,i)=>cross(a,polygon[(i+1)%polygon.length],p)>=-1e-8);
}
function intersection(a: Polygon,b: Polygon): Point | null {
  for (const p of a) if(inside(p,b)) return p;
  for (const p of b) if(inside(p,a)) return p;
  for(let i=0;i<a.length;i++) for(let j=0;j<b.length;j++) {
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    const denominator=(q.x-p.x)*(s.z-r.z)-(q.z-p.z)*(s.x-r.x);
    if(Math.abs(denominator)<1e-9) continue;
    const t=((r.x-p.x)*(s.z-r.z)-(r.z-p.z)*(s.x-r.x))/denominator;
    const u=((r.x-p.x)*(q.z-p.z)-(r.z-p.z)*(q.x-p.x))/denominator;
    if(t>=0&&t<=1&&u>=0&&u<=1) return {x:p.x+t*(q.x-p.x),z:p.z+t*(q.z-p.z)};
  }
  return null;
}
function rectangle(p: Point,yaw: number,halfWidth: number,halfLength: number): Polygon {
  const c=Math.cos(yaw),s=Math.sin(yaw);
  return hull([-1,1].flatMap(x=>[-1,1].map(z=>({x:p.x+c*x*halfWidth+s*z*halfLength,z:p.z-s*x*halfWidth+c*z*halfLength}))));
}
/** Exact compound-strip outlines shared with Rapier, not decorative meshes. */
export function controlFootprint(car: ControlCar, padding=0): Polygon[] {
  return vehicleColliderStrips(car.model).map(strip=>rectangle({x:car.x+Math.sin(car.yaw)*strip.z,z:car.z+Math.cos(car.yaw)*strip.z},car.yaw,strip.halfWidth+padding,strip.halfLength+padding));
}
export function controlRoadGeometry(sections: readonly RoadSection[]) {
  return sections.map(section=>({
    surface:hull([section.startLeft,section.startRight,section.endLeft,section.endRight]),
    walls: [[section.startLeft,section.endLeft],[section.startRight,section.endRight]].map(([a,b])=>rectangle({x:(a.x+b.x)/2,z:(a.z+b.z)/2},Math.atan2(b.x-a.x,b.z-a.z),.16,distance(a,b)/2)),
  }));
}
type Geometry = ReturnType<typeof controlRoadGeometry>;
const stationary = (c: ControlCar) => Math.hypot(c.speed,c.lateralSpeed)<CONTROL.blockerSpeed && Math.abs(c.angularSpeed)<CONTROL.angularSpeed;

/** A sufficient (not necessary) enclosure certificate. Every vehicle contains
 * this orientation-independent disk. Inflate real obstacles by an INSCRIBED
 * polygon, so we cannot invent a closed gap by overestimating its radius.
 * An obstacle-chain cycle with nonzero winding traps the disk's center even
 * after unlimited reversing/turning. Search failure alone is never a certificate.
 * Connecting edges run THROUGH an actual shared point of the two convex shapes;
 * simply connecting their centers would not in general stay inside the union. */
export function hasControlEnclosure(origin: Point, obstacles: Polygon[]): boolean {
  const radius=SUSPECT.width/2-.06;
  const disk=Array.from({length:12},(_,i)=>({x:radius*Math.cos(i*Math.PI/6),z:radius*Math.sin(i*Math.PI/6)}));
  const inflated=obstacles.map(p=>hull(p.flatMap(v=>disk.map(d=>({x:v.x+d.x,z:v.z+d.z})))));
  if(inflated.some(p=>inside(origin,p))) return false;
  const centers=inflated.map(center), links=inflated.map(()=>[] as {to:number;angle:number}[]);
  const turn=(a:Point,b:Point)=>Math.atan2((a.x-origin.x)*(b.z-origin.z)-(a.z-origin.z)*(b.x-origin.x),(a.x-origin.x)*(b.x-origin.x)+(a.z-origin.z)*(b.z-origin.z));
  for(let i=0;i<inflated.length;i++) for(let j=i+1;j<inflated.length;j++) {
    const shared=intersection(inflated[i],inflated[j]); if(!shared) continue;
    const angle=turn(centers[i],shared)+turn(shared,centers[j]);
    links[i].push({to:j,angle}); links[j].push({to:i,angle:-angle});
  }
  const angles=new Map<number,number>();
  for(let root=0;root<links.length;root++) {
    if(angles.has(root)) continue;
    angles.set(root,0); const queue=[root];
    for(let head=0;head<queue.length;head++) for(const edge of links[queue[head]]) {
      const next=angles.get(queue[head])!+edge.angle;
      if(angles.has(edge.to)) { if(Math.abs(angles.get(edge.to)!-next)>Math.PI) return true; }
      else {angles.set(edge.to,next);queue.push(edge.to);}
    }
  }
  return false;
}

export function assessVehicleControl(suspect: ControlCar, blockers: readonly ControlCar[], geometry: Geometry, maxNodes:number=CONTROL.maxNodes): ControlAssessment {
  const answer=(status:ControlAssessment["status"],reason:string,nodes=0):ControlAssessment=>({status,reason,nodes});
  if(![suspect,...blockers].every(c=>[c.x,c.z,c.yaw,c.speed,c.lateralSpeed,c.angularSpeed].every(Number.isFinite))) return answer("uncertain","車輛資料不足，仍在評估");
  if(Math.hypot(suspect.speed,suspect.lateralSpeed)>=CONTROL.speed || Math.abs(suspect.angularSpeed)>=CONTROL.angularSpeed) return answer("moving","嫌犯仍在移動或旋轉");
  const local=geometry.filter(g=>g.surface.some(p=>distance(p,suspect)<100));
  if(!local.some(g=>inside(suspect,g.surface))) return answer("uncertain","道路邊界資料不足，仍在評估");
  const walls=local.flatMap(g=>g.walls);
  const nearby=blockers.filter(c=>distance(c,suspect)<18);
  const obstacles=[...walls,...nearby.flatMap(c=>controlFootprint(c))];
  const valid=(car:ControlCar,padding=0)=>local.some(g=>inside(car,g.surface)) && !controlFootprint(car,padding).some(p=>obstacles.some(o=>intersection(p,o)));
  if(!valid(suspect,-.025)) return answer("uncertain","車身接觸／交疊尚在解析，仍在評估");
  const stable=[...walls,...nearby.filter(stationary).flatMap(c=>controlFootprint(c))];
  if(hasControlEnclosure(suspect,stable)) return answer("blocked","玩家／警車與實體護欄已封閉出口，穩定控制中");
  // Deterministic bounded hybrid search; each primitive sweeps the entire body.
  // Padding bounds motion between samples, including the outer turning corner.
  const queue=[{car:suspect,first:0,depth:0}], seen=new Set<string>(); let nodes=0;
  while(queue.length && nodes<maxNodes) {
    queue.sort((a,b)=>(distance(b.car,suspect)-b.depth*.05)-(distance(a.car,suspect)-a.depth*.05));
    const state=queue.shift()!;nodes++;
    for(const direction of [1,-1]) for(const curve of [0,-1,1]) {
      let car={...state.car}; let clear=true;
      for(let i=0;i<10;i++) {
        const ds=direction*CONTROL.step/10, da=ds*curve/CONTROL.radius;
        car={...car,x:car.x-Math.sin(car.yaw+da/2)*ds,z:car.z-Math.cos(car.yaw+da/2)*ds,yaw:car.yaw+da};
        if(!valid(car,.065)) { clear=false;break; }
      }
      if(!clear) continue;
      const first=state.first || direction;
      if(distance(car,suspect)>=CONTROL.escapeDistance) return answer("open",first<0?"後方仍可倒車轉出，尚未控制":"前方或側方仍有可行出口，尚未控制",nodes);
      const key=`${Math.round(car.x/.4)},${Math.round(car.z/.4)},${Math.round(car.yaw/.15)}`;
      if(!seen.has(key)&&state.depth<18) { seen.add(key);queue.push({car,first,depth:state.depth+1}); }
    }
  }
  return answer("uncertain",nearby.some(c=>!stationary(c))?"封鎖車仍在移動，不能視為穩定障礙":"暫時受阻，尚無完整封鎖證據；仍在評估",nodes);
}

export function advanceControlTimers(previous:{heldFor:number;disabledFor:number}, assessment:ControlAssessment, driveable:boolean, speed:number, dt:number, paused=false) {
  if(paused) return {...previous};
  return {heldFor:assessment.status==="blocked"?previous.heldFor+dt:0,disabledFor:!driveable&&assessment.status!=="moving"&&Number.isFinite(speed)&&speed<CONTROL.speed?previous.disabledFor+dt:0};
}
