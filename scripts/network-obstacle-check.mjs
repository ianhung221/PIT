// Controlled initial conditions; this is not evidence of natural PIT rollover frequency.
import {mkdir,writeFile} from 'node:fs/promises';
import {RAPIER,physicalWorld,physicsSnapshot} from '../tests/helpers/vehicle-world.mjs';
import {installNetwork} from '../tests/helpers/network-world.mjs';
import {generateNetwork} from '../lib/networkGenerator.ts';
import {sampleVehiclePhysics} from '../lib/vehiclePhysics.ts';
await RAPIER.init();
const network=generateNetwork('OBSTACLE-4D'),records=[];
for(const kind of ['patrol','interceptor','suv','suspect'])for(const scenario of ['tree','boundary']){
 const s=physicalWorld(kind);try{
  installNetwork(s,network);const body=s.vehicle.body;
  const obstacle=scenario==='tree'?network.objects.find(o=>o.kind==='tree'):{x:network.bounds.maxX,z:network.bounds.minZ+45};
  const yaw=scenario==='tree'?Math.PI/2:-Math.PI/2;
  const forward={x:-Math.sin(yaw),z:-Math.cos(yaw)};
  body.setTranslation({x:obstacle.x-forward.x*50,y:-.2,z:obstacle.z-forward.z*50+.4},true);
  body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
  for(let i=0;i<120;i++)s.step();
  // Inject only the starting velocity, then leave all movement to the tyres/solver.
  body.setLinvel({x:forward.x*28,y:0,z:forward.z*28},true);
  let maxTilt=0,minimumUp=1,contact=false;
  for(let i=0;i<60*12;i++){
   s.step();sampleVehiclePhysics(s.vehicle,1/60);const p=physicsSnapshot(s.vehicle);
   maxTilt=Math.max(maxTilt,p.pose.tilt);minimumUp=Math.min(minimumUp,p.pose.upDot);
   for(let c=0;c<body.numColliders();c++)s.world.contactPairsWith(body.collider(c),other=>{if((other.collisionGroups()>>>16)&4)s.world.contactPair(body.collider(c),other,m=>{if(m.numSolverContacts()>0)contact=true;});});
  }
  const final=physicsSnapshot(s.vehicle);
  if(!contact||!Number.isFinite(final.pose.y)||final.pose.y<-.7)throw Error(JSON.stringify({kind,scenario,contact,final}));
  records.push({kind,scenario,initialSpeedKph:100.8,maxTiltDegrees:maxTilt*180/Math.PI,minimumUp,contact,final});
 }finally{s.dispose();}
}
const directory=`work/network-obstacles-${Date.now()}`;await mkdir(directory,{recursive:true});await writeFile(`${directory}/results.json`,JSON.stringify({code:network.code,limitations:'Artificial starting positions and speed; no PIT contact. Does not measure natural rollover rate.',records},null,2),{flag:'wx'});
console.log(JSON.stringify({directory,records:records.map(({kind,scenario,maxTiltDegrees,contact,final})=>({kind,scenario,maxTiltDegrees,contact,disabled:final.pose.rolloverDisabled}))}));
