import {networkIndex,nearbyNetworkEdges,type RoadNetwork} from './roadNetwork.ts';
import type {RoadSegment,CarSnapshot} from '../types/game.ts';

export interface RoadLocation {edge:string;from:string;to:string;distance:number;offset:number;deviation:number;nearJunction:boolean}
export function locateRoad(network:RoadNetwork,car:Pick<CarSnapshot,'x'|'z'|'yaw'>,previous?:RoadLocation):RoadLocation {
 const index=networkIndex(network);let best:RoadLocation|undefined,bestScore=Infinity;
 const evaluate=(edges:typeof network.edges)=>{for(const edge of edges){
  const a=index.nodes.get(edge.a)!,b=index.nodes.get(edge.b)!,dx=(b.x-a.x)/edge.length,dz=(b.z-a.z)/edge.length;
  const t=Math.max(0,Math.min(edge.length,(car.x-a.x)*dx+(car.z-a.z)*dz));
  const distance=Math.hypot(car.x-a.x-dx*t,car.z-a.z-dz*t);
  const dot=-Math.sin(car.yaw)*dx-Math.cos(car.yaw)*dz,forward=dot>=0;
  const score=distance+Math.min(6,6*(1-Math.abs(dot)))-(previous?.edge===edge.id?1:0);
  if(score<bestScore){bestScore=score;best={edge:edge.id,from:forward?edge.a:edge.b,to:forward?edge.b:edge.a,distance:forward?t:edge.length-t,
   offset:((car.x-a.x)*-dz+(car.z-a.z)*dx)*(forward?1:-1),deviation:distance,nearJunction:Math.min(t,edge.length-t)<28};}
 }
 };
 evaluate(nearbyNetworkEdges(network,car.x,car.z));
 // Outside this bound a non-local edge might win; recover by searching all roads.
 if(bestScore>=30){bestScore=Infinity;evaluate(network.edges);}
 if(!best)throw Error('Empty road network');return best;
}
export function locationSegment(network:RoadNetwork,location:RoadLocation):RoadSegment {
 const index=networkIndex(network),e=index.edges.get(location.edge)!,a=index.nodes.get(location.from)!,b=index.nodes.get(location.to)!;
 return {id:e.id,index:network.edges.indexOf(e),x:(a.x+b.x)/2,z:(a.z+b.z)/2,yaw:Math.atan2(-(b.x-a.x),-(b.z-a.z)),length:e.length,width:e.width,biome:e.biome,turn:0,risk:location.nearJunction?.8:e.biome==='city'?.5:.2,kind:location.nearJunction?'junction':'straight'};
}
