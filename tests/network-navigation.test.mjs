import test from 'node:test';
import assert from 'node:assert/strict';
import {generateNetwork} from '../lib/networkGenerator.ts';
import {networkIndex} from '../lib/roadNetwork.ts';
import {networkGeometry,surfacePolygon} from '../lib/networkGeometry.ts';
import {navigationRoute} from '../lib/navigation.ts';
import {locateRoad} from '../lib/roadLocation.ts';
import {locationSegment} from '../lib/roadLocation.ts';
import {closestRoadSegment} from '../lib/proceduralMap.ts';
const inside=(p,poly)=>poly.every((a,i)=>{const b=poly[(i+1)%poly.length];return (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x)>=-1e-6;});
function carOn(n,e,fraction=.5,reverse=false){const index=networkIndex(n),a=index.nodes.get(reverse?e.b:e.a),b=index.nodes.get(reverse?e.a:e.b),dx=(b.x-a.x)/e.length,dz=(b.z-a.z)/e.length;return {x:a.x+dx*e.length*fraction-dz*2.7,z:a.z+dz*e.length*fraction+dx*2.7,yaw:Math.atan2(-dx,-dz),speed:0,lateralSpeed:0};}
test('navigation follows paved reachable roads for diverse starts, headings and target roads',()=>{
 for(let seed=0;seed<10;seed++){
  const n=generateNetwork(`NAV-${seed}`),surfaces=networkGeometry(n).surfaces.map(s=>surfacePolygon(s.section));
  for(let i=0;i<12;i++){
   const player=carOn(n,n.edges[i],.6,i%2===0),target=carOn(n,n.edges[(i*7+3)%n.edges.length],.4);
   const nav=navigationRoute(n,player,{position:target,observedAt:12,source:'report'});
   assert.equal(nav.status,'route');assert.ok(nav.points.length>0);
   for(const p of nav.points)assert.ok(surfaces.some(poly=>inside(p,poly)),JSON.stringify({seed,i,p}));
  }
 }
});
test('unknown targets do not produce a route and opposite-direction same-road targets do not demand a U-turn',()=>{
 const n=generateNetwork('NAV-REPORT'),e=n.edges[0],player=carOn(n,e),target=carOn(n,e,.2,true);
 assert.equal(navigationRoute(n,player,null).status,'unknown');
 const nav=navigationRoute(n,player,{position:target,observedAt:0,source:'report'});
 assert.equal(nav.status,'route');assert.ok(nav.points.length>20);
});
test('heading resolves the current road at a junction and relocation recovers after a wrong turn',()=>{
 const n=generateNetwork('NAV-LOCATION'),index=networkIndex(n),junction=n.nodes.find(node=>index.exits.get(node.id).length>=3);
 for(const e of index.exits.get(junction.id)){
  const other=index.nodes.get(e.a===junction.id?e.b:e.a),dx=(other.x-junction.x)/e.length,dz=(other.z-junction.z)/e.length;
  const car={x:junction.x+dx*30,z:junction.z+dz*30,yaw:Math.atan2(-dx,-dz)};
  const located=locateRoad(n,car,{edge:'wrong',from:'none',to:'none',distance:0,offset:0,deviation:0,nearJunction:false});
  assert.equal(located.edge,e.id);assert.equal(located.from,junction.id);
 }
});

test('spatial road lookup matches exhaustive search near cell borders, offroad and after relocation',()=>{
 for(let seed=0;seed<6;seed++){
  const n=generateNetwork(`LOCATE-${seed}`),index=networkIndex(n);
  const road={network:n,segments:n.edges.map(e=>locationSegment(n,{edge:e.id,from:e.a,to:e.b,nearJunction:false}))};
  for(let i=0;i<500;i++){
   const x=n.bounds.minX+(i*137.27)%(n.bounds.maxX-n.bounds.minX),z=n.bounds.minZ+(i*191.13)%(n.bounds.maxZ-n.bounds.minZ),yaw=i*.73;
   const previous={edge:n.edges[i%n.edges.length].id};
   const scores=n.edges.map(e=>{const a=index.nodes.get(e.a),b=index.nodes.get(e.b),dx=(b.x-a.x)/e.length,dz=(b.z-a.z)/e.length,t=Math.max(0,Math.min(e.length,(x-a.x)*dx+(z-a.z)*dz));return Math.hypot(x-a.x-dx*t,z-a.z-dz*t)+Math.min(6,6*(1-Math.abs(-Math.sin(yaw)*dx-Math.cos(yaw)*dz)))-(previous.edge===e.id?1:0);});
   assert.equal(locateRoad(n,{x,z,yaw},previous).edge,n.edges[scores.indexOf(Math.min(...scores))].id);
   const hint=i%road.segments.length,distances=road.segments.map((s,j)=>{const t=Math.max(-s.length/2,Math.min(s.length/2,-(x-s.x)*Math.sin(s.yaw)-(z-s.z)*Math.cos(s.yaw)));return Math.hypot(x-s.x+Math.sin(s.yaw)*t,z-s.z+Math.cos(s.yaw)*t)-(j===hint?.5:0);});
   assert.equal(closestRoadSegment(road,x,z,hint),distances.indexOf(Math.min(...distances)));
  }
 }
});
