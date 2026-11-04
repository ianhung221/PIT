import { networkIndex, otherEnd, type RoadNetwork } from './roadNetwork.ts';
import type { RoadPoint } from './roadGeometry.ts';

export interface DirectedRoad { edge: string; from: string; to: string }
/** Distance-weighted graph search; the current roads permit both directions. */
export function shortestRoute(network:RoadNetwork,start:string,end:string,excluded:ReadonlySet<string>=new Set()):DirectedRoad[]|null {
 const index=networkIndex(network);
 if(!index.nodes.has(start)||!index.nodes.has(end))return null;
 const distance=new Map([[start,0]]),previous=new Map<string,DirectedRoad>(),open=new Set([start]);
 while(open.size){
  let current='';let best=Infinity;for(const id of open){const d=distance.get(id)!;if(d<best){current=id;best=d;}}
  open.delete(current);if(current===end)break;
  for(const edge of index.exits.get(current)!){if(excluded.has(edge.id))continue;const next=otherEnd(edge,current),candidate=best+edge.length;
   if(candidate<(distance.get(next)??Infinity)){distance.set(next,candidate);previous.set(next,{edge:edge.id,from:current,to:next});open.add(next);}
  }
 }
 if(!distance.has(end))return null;
 const route:DirectedRoad[]=[];let current=end;
 while(current!==start){const step=previous.get(current)!;route.unshift(step);current=step.from;}
 return route;
}
export interface RoutePoint extends RoadPoint { speed: number }
/** Find a legal loop when reaching a target would otherwise require a U-turn. */
export function returningRoute(network:RoadNetwork,node:string,excluded:ReadonlySet<string>):DirectedRoad[]|null {
 const index=networkIndex(network);let best:DirectedRoad[]|null=null,bestLength=Infinity;
 for(const e of index.exits.get(node)??[]){
  if(excluded.has(e.id))continue;
  const to=otherEnd(e,node),back=shortestRoute(network,to,node,new Set([...excluded,e.id]));
  if(!back)continue;
  const route=[{edge:e.id,from:node,to},...back],length=route.reduce((sum,s)=>sum+index.edges.get(s.edge)!.length,0);
  if(length<bestLength){best=route;bestLength=length;}
 }
 return best;
}
/** Right-hand lanes, joined by quadratic paths inside each intersection. */
export function routePoints(network:RoadNetwork,route:DirectedRoad[]):RoutePoint[]{
 const index=networkIndex(network),points:RoutePoint[]=[];
 const lane=(step:DirectedRoad)=>{
  const edge=index.edges.get(step.edge)!,a=index.nodes.get(step.from)!,b=index.nodes.get(step.to)!;
  const dx=(b.x-a.x)/edge.length,dz=(b.z-a.z)/edge.length,offset=Math.min(2.7,edge.width/4);
  return {a,b,dx,dz,speed:edge.biome==='highway'?32:edge.biome==='country'?25:15,
   at:(distance:number)=>({x:a.x+dx*distance-dz*offset,z:a.z+dz*distance+dx*offset})};
 };
 for(let i=0;i<route.length;i++){
  const line=lane(route[i]),length=Math.hypot(line.b.x-line.a.x,line.b.z-line.a.z);
  const start=i===0?0:line.a.radius,end=i===route.length-1?length:length-line.b.radius;
  const steps=Math.max(1,Math.ceil((end-start)/8));
  for(let k=0;k<=steps;k++)points.push({...line.at(start+(end-start)*k/steps),speed:line.speed});
  if(i===route.length-1)continue;
  const next=lane(route[i+1]);if(route[i].to!==route[i+1].from)throw Error('Disconnected driving route');
  const p=line.at(end),q=next.at(next.a.radius),cross=line.dx*next.dz-line.dz*next.dx;
  if(line.dx*next.dx+line.dz*next.dz<-.5)throw Error('A junction U-turn requires a separate maneuver');
  const turn=Math.abs(cross)>.01;
  const t=turn?((q.x-p.x)*next.dz-(q.z-p.z)*next.dx)/cross:0;
  const c=turn?{x:p.x+line.dx*t,z:p.z+line.dz*t}:{x:(p.x+q.x)/2,z:(p.z+q.z)/2};
  for(let k=1;k<12;k++){const u=k/12,v=1-u;points.push({x:v*v*p.x+2*u*v*c.x+u*u*q.x,z:v*v*p.z+2*u*v*c.z+u*u*q.z,speed:turn?7:Math.min(line.speed,next.speed)});}
 }
 return points;
}
