import {networkIndex,type RoadNetwork} from './roadNetwork.ts';
import {locateRoad,type RoadLocation} from './roadLocation.ts';
import {shortestRoute,returningRoute,routePoints,type DirectedRoad} from './roadRouting.ts';
import type {CarSnapshot} from '../types/game.ts';

// Navigation only receives disclosed information. Future last-report mode can
// supply an older fix without giving this module the real suspect position.
export interface NavigationFix {position:Pick<CarSnapshot,'x'|'z'|'yaw'>;observedAt:number;source:'live-assistance'|'report'}
export function navigationRoute(network:RoadNetwork,player:CarSnapshot,fix:NavigationFix|null,previous?:RoadLocation){
 const location=locateRoad(network,player,previous);
 const empty={location,points:[] as {x:number;z:number}[],direction:'straight' as 'straight'|'left'|'right'|'target',distance:0};
 if(!fix)return {...empty,status:'unknown' as const};
 const target=locateRoad(network,fix.position),first={edge:location.edge,from:location.from,to:location.to},last={edge:target.edge,from:target.from,to:target.to};
 let route:DirectedRoad[]|null;
 if(first.edge===last.edge&&first.from===last.from&&target.distance>=location.distance)route=[first];
 else{
  const excluded=new Set([first.edge,last.edge]);
  const middle=first.edge===last.edge&&first.to===last.from?returningRoute(network,first.to,excluded):shortestRoute(network,first.to,last.from,excluded);
  route=middle?[first,...middle,last]:null;
 }
 if(!route)return {...empty,status:'blocked' as const};
 const index=networkIndex(network),all=routePoints(network,route);
 let start=0,best=Infinity;
 const endFirst=index.nodes.get(first.to)!;
 for(let i=0;i<all.length;i++){const p=all[i],d=Math.hypot(p.x-player.x,p.z-player.z);if(d<best){best=d;start=i;}if(Math.hypot(p.x-endFirst.x,p.z-endFirst.z)<endFirst.radius+1)break;}
 let end=all.length-1;best=Infinity;
 const lastStart=index.nodes.get(last.from)!;
 for(let i=all.length-1;i>=start;i--){const p=all[i],d=Math.hypot(p.x-fix.position.x,p.z-fix.position.z);if(d<best){best=d;end=i;}if(Math.hypot(p.x-lastStart.x,p.z-lastStart.z)<lastStart.radius+1)break;}
 const points=all.slice(start,Math.max(start+1,end+1));
 let distance=Math.max(0,index.edges.get(first.edge)!.length-location.distance),direction=empty.direction;
 let found=false;
 for(let i=0;i<route.length-1;i++){
  const a=index.nodes.get(route[i].from)!,b=index.nodes.get(route[i].to)!,c=index.nodes.get(route[i+1].to)!;
  const cross=(b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x);
  if(Math.abs(cross)>1){direction=cross>0?'right':'left';distance=Math.max(0,distance-b.radius);found=true;break;}
  distance+=index.edges.get(route[i+1].edge)!.length;
 }
 if(!found){distance=points.reduce((sum,p,i)=>i?sum+Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z):0,0);direction=distance<35?'target':'straight';}
 return {location,points,direction,distance,status:'route' as const};
}
