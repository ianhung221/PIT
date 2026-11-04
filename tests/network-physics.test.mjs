import test from 'node:test';
import assert from 'node:assert/strict';
import {RAPIER,physicalWorld,stepVehiclePhysics,physicsSnapshot} from './helpers/vehicle-world.mjs';
import {generateNetwork} from '../lib/networkGenerator.ts';
import {networkIndex} from '../lib/roadNetwork.ts';
import {routePoints,shortestRoute} from '../lib/roadRouting.ts';
import {followNetworkRoute} from '../lib/networkDriving.ts';
import {driveVehicleTarget} from '../lib/vehicleDriver.ts';
import {WEATHER} from '../lib/gameConfig.ts';
import {makeNetworkDriver,escapeRoute,chaseRoute} from '../lib/networkPursuit.ts';
import {installNetwork as install} from './helpers/network-world.mjs';
await RAPIER.init();

test('all four vehicle types cross actual city/country/highway paving seams under wheel physics',()=>{
 const n=generateNetwork('PHYSICS-4A'),index=networkIndex(n);
 for(const biome of ['city','country','highway'])for(const kind of ['patrol','interceptor','suv','suspect']){
  const e=n.edges.find(e=>e.biome===biome),a=index.nodes.get(e.a),b=index.nodes.get(e.b);
  const s=physicalWorld(kind);try{
   install(s,n);const v=s.vehicle,dx=(b.x-a.x)/e.length,dz=(b.z-a.z)/e.length,yaw=Math.atan2(-dx,-dz);
   v.body.setTranslation({x:a.x+dx*3,y:-.2,z:a.z+dz*3},true);
   v.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
   for(let i=0;i<120;i++)s.step();
   let minY=Infinity,minWheels=4;
   for(let i=0;i<300;i++){
    s.step({throttle:.18,brake:0,steer:0,gear:1});
    const p=physicsSnapshot(v);minY=Math.min(minY,p.pose.y);minWheels=Math.min(minWheels,p.pose.groundedWheels);
   }
   const p=physicsSnapshot(v),distance=(p.x-a.x)*dx+(p.z-a.z)*dz;
   assert.ok(distance>a.radius+12,`${kind}/${biome}: did not cross junction seam (${distance} m)`);
   assert.ok(minY>-.4&&minWheels>=3,JSON.stringify({kind,biome,minY,minWheels}));
  }finally{s.dispose();}
 }
});

test('four shared-physics vehicles drive connected left/right intersection paths without chassis corrections',()=>{
 const n=generateNetwork('TURN-4A');
 const route=shortestRoute(n,'t0-0-0','t1-2-2');
 const points=routePoints(n,route);
 for(const kind of ['patrol','interceptor','suv','suspect']){
  const s=physicalWorld(kind);try{
   install(s,n);const v=s.vehicle,first=points[0],next=points[1],yaw=Math.atan2(-(next.x-first.x),-(next.z-first.z));
   v.body.setTranslation({x:first.x,y:-.2,z:first.z},true);v.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
   const progress={index:0};let maxDeviation=0,reached=false;
   for(let step=0;step<60*180;step++){
    const target=followNetworkRoute(physicsSnapshot(v),points,progress);
    maxDeviation=Math.max(maxDeviation,target.deviation);
    driveVehicleTarget(v,target);s.world.step();
    if(progress.index>points.length-5&&target.remaining<4){reached=true;break;}
   }
   assert.ok(reached,JSON.stringify({kind,index:progress.index,total:points.length,maxDeviation,position:physicsSnapshot(v)}));
   assert.ok(maxDeviation<4,`${kind}: left its driving corridor (${maxDeviation} m)`);
  }finally{s.dispose();}
 }
});

test('four distant vehicles retain floor support and land outside the road',()=>{
 const n=generateNetwork('DISTANT-4A'),s=physicalWorld();
 try{
  install(s,n);s.remove(s.vehicle);
  const corners=[{x:n.bounds.minX+40,z:n.bounds.minZ+40},{x:n.bounds.maxX-40,z:n.bounds.minZ+40},{x:n.bounds.minX+40,z:n.bounds.maxZ-40},{x:n.bounds.maxX-40,z:n.bounds.maxZ-40}];
  const vehicles=['patrol','interceptor','suv','suspect'].map((k,i)=>{const v=s.add(k,corners[i].x,corners[i].z);v.body.setTranslation({...corners[i],y:4},true);return v;});
  for(let i=0;i<360;i++){for(const v of vehicles)stepVehiclePhysics(v,{throttle:0,brake:0,steer:0,gear:1});s.world.step();}
  for(const v of vehicles){const p=physicsSnapshot(v);assert.equal(p.pose.groundedWheels,4);assert.ok(p.pose.y>-.5&&p.pose.y<0);}
 }finally{s.dispose();}
});

test('representative T/cross/corner exits remain driveable for each vehicle in clear/rain/snow',()=>{
 const n=generateNetwork('EXITS-4A'),index=networkIndex(n),cases=new Map();
 for(const node of n.nodes){const exits=index.exits.get(node.id);
  for(const incoming of exits)for(const outgoing of exits){if(incoming===outgoing)continue;
   const from=incoming.a===node.id?incoming.b:incoming.a,to=outgoing.a===node.id?outgoing.b:outgoing.a;
   const a=index.nodes.get(from),b=index.nodes.get(to);
   const cross=Math.sign((node.x-a.x)*(b.z-node.z)-(node.z-a.z)*(b.x-node.x));
   const key=`${exits.length}/${cross}/${incoming.biome==='highway'||outgoing.biome==='highway'?'highway':'street'}`;
   if(!cases.has(key))cases.set(key,[{edge:incoming.id,from,to:node.id},{edge:outgoing.id,from:node.id,to}]);
  }
 }
 for(const [name,route] of cases)for(const kind of ['patrol','interceptor','suv','suspect'])for(const {grip} of Object.values(WEATHER)){
  const full=routePoints(n,route),junction=index.nodes.get(route[0].to);
  const points=full.filter(p=>Math.hypot(p.x-junction.x,p.z-junction.z)<65);
  const s=physicalWorld(kind);try{
   install(s,n);const v=s.vehicle,first=points[0],next=points[1],yaw=Math.atan2(-(next.x-first.x),-(next.z-first.z));
   v.body.setTranslation({x:first.x,y:-.2,z:first.z},true);v.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
   const progress={index:0};let deviation=0,reached=false;
   for(let step=0;step<60*40;step++){
    const target=followNetworkRoute(physicsSnapshot(v),points,progress,grip);
    deviation=Math.max(deviation,target.deviation);driveVehicleTarget(v,target,grip);s.world.step();
    if(progress.index>points.length-5&&target.remaining<4){reached=true;break;}
   }
   assert.ok(reached&&deviation<4,JSON.stringify({name,kind,grip,reached,deviation,index:progress.index,total:points.length}));
  }finally{s.dispose();}
 }
});

test('naturally chosen pursuit routes keep a suspect and two backups driving across junctions',()=>{
 for(const seed of ['CHASE-A','CHASE-B','CHASE-C'])for(const {grip} of Object.values(WEATHER)){
 const n=generateNetwork(seed),index=networkIndex(n),edge=index.edges.get(n.spawn.edge),a=index.nodes.get(edge.a),b=index.nodes.get(edge.b);
 const dx=(b.x-a.x)/edge.length,dz=(b.z-a.z)/edge.length,yaw=Math.atan2(-dx,-dz),s=physicalWorld('suspect');
 try{
  install(s,n);s.remove(s.vehicle);
  const cars=['suspect','patrol','suv'].map((kind,i)=>{const d=110-i*30,v=s.add(kind,a.x+dx*d-dz*2.7,a.z+dz*d+dx*2.7);v.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);return v;});
  const parked=s.add('patrol',a.x+dx*95-dz*2.7,a.z+dz*95+dx*2.7);parked.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
  const parkedStart=physicsSnapshot(parked);
  const states=cars.map((_,i)=>makeNetworkDriver(`${seed}-${i}`)),visited=new Set(),supportRoads=[new Set(),new Set()];let maxGap=0;
  for(let step=0;step<60*180/Math.sqrt(grip);step++){
   const snapshots=cars.map(physicsSnapshot),player=physicsSnapshot(parked);
   driveVehicleTarget(parked,{speed:0,yawError:0},grip);
   for(let i=0;i<cars.length;i++){
    const leader=Math.hypot(player.x-snapshots[0].x,player.z-snapshots[0].z)>65?snapshots[0]:player;
    const target=i===0?escapeRoute(n,states[i],snapshots[i],step/60,grip):chaseRoute(n,states[i],snapshots[i],leader,step/60,grip,i===1?16:30,[player,...snapshots.filter((_,j)=>i!==j)]);
    driveVehicleTarget(cars[i],target,grip);
   }
   s.world.step();visited.add(states[0].location.edge);supportRoads.forEach((roads,i)=>roads.add(states[i+1].location.edge));
   if(step>300)maxGap=Math.max(maxGap,...snapshots.slice(1).map((p,i)=>Math.hypot(p.x-snapshots[i].x,p.z-snapshots[i].z)));
  }
  assert.ok(visited.size>=8,JSON.stringify({seed,visited:[...visited]}));
  const final=cars.map(physicsSnapshot),finalGap=Math.max(...final.slice(1).map(p=>Math.hypot(p.x-final[0].x,p.z-final[0].z)));
  // Passing a stationary player introduces a temporary delay; verify rejoining
  // and sustained travel instead of imposing the unobstructed convoy's peak gap.
  assert.ok(finalGap<120&&supportRoads.every(r=>r.size>=6),JSON.stringify({seed,maxGap,finalGap,roads:supportRoads.map(r=>[...r]),positions:final,states:states.map(s=>({blocked:s.blocked,index:s.progress.index,location:s.location}))}));
  assert.ok(Math.hypot(physicsSnapshot(parked).x-parkedStart.x,physicsSnapshot(parked).z-parkedStart.z)<.5,'backups must pass without pushing the parked player');
 }finally{s.dispose();}
 }
});
