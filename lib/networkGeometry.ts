import { networkIndex, type RoadNetwork } from './roadNetwork.ts';
import type { RoadSection, RoadPoint } from './roadGeometry.ts';
import {roadSupportPrisms} from './groundPhysics.ts';

export interface NetworkSurface { id: string; section: RoadSection; biome: 'city' | 'country' | 'highway'; junction: boolean }
export interface NetworkWall { id: string; x: number; z: number; halfX: number; halfZ: number; height: number }
const geometries=new WeakMap<RoadNetwork,{surfaces:NetworkSurface[];walls:NetworkWall[]}>();
export function rectangleSection(minX: number, maxX: number, minZ: number, maxZ: number): RoadSection {
  return { start: { x:(minX+maxX)/2, z:maxZ }, end:{ x:(minX+maxX)/2, z:minZ },
    startLeft:{x:minX,z:maxZ}, startRight:{x:maxX,z:maxZ}, endLeft:{x:minX,z:minZ}, endRight:{x:maxX,z:minZ} };
}
export const surfacePolygon = (s: RoadSection): RoadPoint[] => [s.startLeft,s.endLeft,s.endRight,s.startRight];
export const boxPolygon = (o: {x:number;z:number;halfX:number;halfZ:number}) => surfacePolygon(rectangleSection(o.x-o.halfX,o.x+o.halfX,o.z-o.halfZ,o.z+o.halfZ));
/** Axis-aligned constant-width surfaces use exact boxes; tapers retain convex tops. */
export function networkSupportShapes(surfaces:NetworkSurface[]){
 return roadSupportPrisms(surfaces.map(s=>s.section)).map(p=>{
  const xs=[...p.vertices].filter((_,i)=>i%3===0),zs=[...p.vertices].filter((_,i)=>i%3===2);
  const rectangular=new Set(xs).size===2&&new Set(zs).size===2;
  return {...p,halfSize:rectangular?[(Math.max(...xs)-Math.min(...xs))/2,.1,(Math.max(...zs)-Math.min(...zs))/2] as [number,number,number]:null};
 });
}
export function roadStrip(start:RoadPoint,end:RoadPoint,startWidth:number,endWidth=startWidth):RoadSection {
  const length=Math.hypot(end.x-start.x,end.z-start.z),dx=(end.x-start.x)/length,dz=(end.z-start.z)/length;
  return {start,end,startLeft:{x:start.x+dz*startWidth/2,z:start.z-dx*startWidth/2},startRight:{x:start.x-dz*startWidth/2,z:start.z+dx*startWidth/2},endLeft:{x:end.x+dz*endWidth/2,z:end.z-dx*endWidth/2},endRight:{x:end.x-dz*endWidth/2,z:end.z+dx*endWidth/2}};
}
export function networkGeometry(network: RoadNetwork) {
  const cached=geometries.get(network);if(cached)return cached;
  const { nodes, exits } = networkIndex(network), surfaces: NetworkSurface[] = [], walls: NetworkWall[] = [];
  for (const node of network.nodes) {
    const adjacent = exits.get(node.id)!;
    surfaces.push({id:`node-${node.id}`,section:rectangleSection(node.x-node.radius,node.x+node.radius,node.z-node.radius,node.z+node.radius),
      biome:adjacent.some(e=>e.biome==='city')?'city':adjacent.some(e=>e.biome==='highway')?'highway':'country',junction:true});
  }
  for (const edge of network.edges) {
    const a=nodes.get(edge.a)!,b=nodes.get(edge.b)!,dx=(b.x-a.x)/edge.length,dz=(b.z-a.z)/edge.length;
    const start={x:a.x+dx*a.radius,z:a.z+dz*a.radius},end={x:b.x-dx*b.radius,z:b.z-dz*b.radius};
    const length=edge.length-a.radius-b.radius,taper=Math.min(40,length/2);
    const widthA=Math.max(...exits.get(a.id)!.map(e=>e.width)),widthB=Math.max(...exits.get(b.id)!.map(e=>e.width));
    const cuts=[...new Set([0,...(widthA!==edge.width?[taper]:[]),...(widthB!==edge.width?[length-taper]:[]),length])].sort((a,b)=>a-b);
    const widthAt=(d:number)=>edge.width+(widthA-edge.width)*Math.max(0,1-d/taper)+(widthB-edge.width)*Math.max(0,1-(length-d)/taper);
    for(let i=0;i<cuts.length-1;i++) {
      if(cuts[i+1]-cuts[i]<1e-8)continue;
      const p={x:start.x+dx*cuts[i],z:start.z+dz*cuts[i]},q={x:start.x+dx*cuts[i+1],z:start.z+dz*cuts[i+1]};
      surfaces.push({id:`${edge.id}-${i}`,biome:edge.biome,junction:false,section:roadStrip(p,q,widthAt(cuts[i]),widthAt(cuts[i+1]))});
    }
    if(edge.biome==='highway') for(const side of [-1,1]) walls.push({id:`rail-${edge.id}-${side}`,x:(start.x+end.x)/2+dz*side*(edge.width/2+.2),z:(start.z+end.z)/2-dx*side*(edge.width/2+.2),halfX:dx===0?.16:length/2,halfZ:dz===0?.16:length/2,height:.62});
  }
  const b=network.bounds;
  walls.push({id:'boundary-west',x:b.minX,z:(b.minZ+b.maxZ)/2,halfX:.5,halfZ:(b.maxZ-b.minZ)/2,height:2},
    {id:'boundary-east',x:b.maxX,z:(b.minZ+b.maxZ)/2,halfX:.5,halfZ:(b.maxZ-b.minZ)/2,height:2},
    {id:'boundary-north',x:(b.minX+b.maxX)/2,z:b.minZ,halfX:(b.maxX-b.minX)/2,halfZ:.5,height:2},
    {id:'boundary-south',x:(b.minX+b.maxX)/2,z:b.maxZ,halfX:(b.maxX-b.minX)/2,halfZ:.5,height:2});
  const result={surfaces,walls};geometries.set(network,result);return result;
}

/** Subtract pavement from the visual ground so distant roads cannot z-fight. */
export function networkGroundSections(network:RoadNetwork,surfaces:NetworkSurface[]) {
 const b=network.bounds,polygons=surfaces.map(({section:s})=>surfacePolygon(s));
 const xs=[...new Set([b.minX-20,b.maxX+20,...polygons.flatMap(p=>p.map(v=>v.x))])].sort((a,b)=>a-b);
 const ground:RoadSection[]=[];
 for(let i=0;i<xs.length-1;i++){
  const left=xs[i],right=xs[i+1],middle=(left+right)/2;
  if(right-left<1e-8)continue;
  const spans=polygons.flatMap(p=>{
   const crossings=p.flatMap((a,j)=>{const c=p[(j+1)%p.length];if(middle<=Math.min(a.x,c.x)||middle>=Math.max(a.x,c.x))return [];
    const z=(x:number)=>a.z+(c.z-a.z)*(x-a.x)/(c.x-a.x);return [{middle:z(middle),left:z(left),right:z(right)}];}).sort((a,b)=>a.middle-b.middle);
   return crossings.length>=2?[{low:crossings[0],high:crossings[crossings.length-1]}]:[];
  }).sort((a,b)=>a.low.middle-b.low.middle);
  let zLeft=b.minZ-20,zRight=zLeft;
  const append=(lowLeft:number,lowRight:number,highLeft:number,highRight:number)=>{
   if((highLeft-lowLeft)+(highRight-lowRight)<1e-8)return;
   ground.push({start:{x:middle,z:(highLeft+highRight)/2},end:{x:middle,z:(lowLeft+lowRight)/2},startLeft:{x:left,z:highLeft},startRight:{x:right,z:highRight},endLeft:{x:left,z:lowLeft},endRight:{x:right,z:lowRight}});
  };
  for(const r of spans){if(r.low.middle>(zLeft+zRight)/2+1e-8)append(zLeft,zRight,r.low.left,r.low.right);if(r.high.middle>(zLeft+zRight)/2){zLeft=r.high.left;zRight=r.high.right;}}
  append(zLeft,zRight,b.maxZ+20,b.maxZ+20);
 }
 return ground;
}

/** Same physical objects as the world; never infer imaginary road-edge walls. */
export function networkControlGeometry(network: RoadNetwork, near: RoadPoint, radius=55) {
  const geometry=networkGeometry(network), b=network.bounds;
  const walls=[...geometry.walls,...network.objects].filter(o=>Math.abs(o.x-near.x)<o.halfX+radius&&Math.abs(o.z-near.z)<o.halfZ+radius).map(boxPolygon);
  return [{surface:surfacePolygon(rectangleSection(Math.max(b.minX,near.x-radius),Math.min(b.maxX,near.x+radius),Math.max(b.minZ,near.z-radius),Math.min(b.maxZ,near.z+radius))),walls}];
}
