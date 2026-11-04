import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNetwork, validateNetwork } from '../lib/networkGenerator.ts';
import { parseMapCode, networkIndex } from '../lib/roadNetwork.ts';
import { networkGeometry, networkGroundSections, surfacePolygon } from '../lib/networkGeometry.ts';
function overlaps(a,b){
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length],nx=-(q.z-p.z),nz=q.x-p.x;
  if(Math.hypot(nx,nz)<1e-8)continue;
  const pa=a.map(v=>v.x*nx+v.z*nz),pb=b.map(v=>v.x*nx+v.z*nz);
  if(Math.min(Math.max(...pa),Math.max(...pb))-Math.max(Math.min(...pa),Math.min(...pb))<=1e-7*Math.hypot(nx,nz))return false;
 }
 return true;
}

test('100 seeded networks are connected, finite, reproducible and have genuine regional loops',()=>{
 const variants=new Set();const counts=new Set();
 for(let i=0;i<100;i++) {
  const network=generateNetwork(`MAP-${i}`);validateNetwork(network);
  assert.deepEqual(network,generateNetwork(network.code));
  counts.add(network.towns.length);variants.add(JSON.stringify(network.edges));
  assert.ok(network.edges.length>=network.nodes.length);
  assert.ok(network.towns.every(t=>Number.isFinite(t.police.x)&&Number.isFinite(t.police.z)));
  const index=networkIndex(network);
  for(const n of network.nodes) assert.ok(index.exits.get(n.id).length>=2);
  assert.ok(network.bounds.maxX-network.bounds.minX<4000);
 }
 assert.deepEqual([...counts].sort(),[2,3]);assert.ok(variants.size>90);
});

test('map codes distinguish unsupported and legacy versions without silently changing a map',()=>{
 assert.equal(parseMapCode('HIGHWAY-PIT-20261102-C6A6').kind,'legacy');
 assert.equal(parseMapCode('NET99:TEST').kind,'invalid');
 assert.equal(parseMapCode('NET1:').kind,'invalid');
 assert.equal(parseMapCode('NET1:TEST').code,'NET1:TEST');
});

test('pavement and tapered entries have upward winding and do not overlap the ground',()=>{
 for(let seed=0;seed<10;seed++) {
  const n=generateNetwork(`GEOMETRY-${seed}`),g=networkGeometry(n);
  const bounds=g.surfaces.map(s=>{
   const p=surfacePolygon(s.section);const minX=Math.min(...p.map(v=>v.x)),maxX=Math.max(...p.map(v=>v.x)),minZ=Math.min(...p.map(v=>v.z)),maxZ=Math.max(...p.map(v=>v.z));
   assert.ok(maxX>minX&&maxZ>minZ);
   const a=s.section.startLeft,b=s.section.startRight,c=s.section.endLeft;
   assert.ok((b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z)>0,'rendered triangle normal must face upward');
   return {minX,maxX,minZ,maxZ};
  });
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){
   const a=bounds[i],b=bounds[j];
   assert.ok(Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX)<1e-8||Math.min(a.maxZ,b.maxZ)-Math.max(a.minZ,b.minZ)<1e-8,'overlapping road surfaces');
  }
  for(const o of n.objects)for(const r of bounds) assert.ok(o.x+o.halfX<=r.minX||o.x-o.halfX>=r.maxX||o.z+o.halfZ<=r.minZ||o.z-o.halfZ>=r.maxZ,'object blocks pavement');
  for(const s of networkGroundSections(n,g.surfaces))for(let i=0;i<bounds.length;i++){
   const r=bounds[i],p=surfacePolygon(s);
   if(Math.max(...p.map(v=>v.x))<=r.minX||Math.min(...p.map(v=>v.x))>=r.maxX||Math.max(...p.map(v=>v.z))<=r.minZ||Math.min(...p.map(v=>v.z))>=r.maxZ)continue;
   assert.ok(!overlaps(p,surfacePolygon(g.surfaces[i].section)),'ground must not render underneath tapered road');
  }
 }
});
