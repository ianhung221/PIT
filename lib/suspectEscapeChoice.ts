import {networkIndex,otherEnd,type RoadNetwork,type NetworkEdge} from './roadNetwork.ts';
import type {DrivingObservation} from './drivingObservation.ts';
import type {SuspectDifficulty} from './gameConfig.ts';

/** Only the supplied, locally observed cars can discourage an exit. */
export function observedExitRisk(network:RoadNetwork,nodeId:string,edge:NetworkEdge,observation:DrivingObservation){
 const index=networkIndex(network),a=index.nodes.get(nodeId)!,b=index.nodes.get(otherEnd(edge,nodeId))!;
 const dx=(b.x-a.x)/edge.length,dz=(b.z-a.z)/edge.length;
 let risk=0;
 for(const car of observation.cars){
  const x=car.x-a.x,z=car.z-a.z,along=x*dx+z*dz,side=Math.abs(x*-dz+z*dx);
  if(along>-4&&along<65&&side<edge.width/2+2)risk+=Math.max(0,1-along/85)*(car.speed<3?2:1);
 }
 return risk;
}

export function chooseObservedExit(network:RoadNetwork,node:string,choices:NetworkEdge[],observation:DrivingObservation,difficulty:SuspectDifficulty,random:()=>number){
 const weighted=choices.flatMap(edge=>edge.biome==='city'?[edge]:[edge,edge]);
 if(!weighted.length)return undefined;
 const fallback=weighted[Math.floor(random()*weighted.length)];
 if(difficulty==='basic'||!observation.cars.length)return fallback;
 // A driver can misread the available escape, even after observing it.
 if(random()<(difficulty==='advanced'?.15:.3))return fallback;
 let best=fallback,bestScore=Infinity;
 for(const edge of choices){
  const score=observedExitRisk(network,node,edge,observation)+(edge.biome==='city'?.1:0)+random()*.2;
  if(score<bestScore){bestScore=score;best=edge;}
 }
 return best;
}
