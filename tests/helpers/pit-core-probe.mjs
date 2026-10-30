// Exploratory 2A gate only: real new-core collisions, existing PIT criteria.
// Does not write game state, lower thresholds or add collision impulses.
import {pathToFileURL} from 'node:url';
import {RAPIER,physicalWorld,stepVehiclePhysics} from './vehicle-world.mjs';
import {readVehicleFrame} from '../../lib/vehiclePose.ts';
import {physicalContactSample} from '../../lib/physicalContactSample.ts';
import {makeContactEpisodes,observeContactEpisode} from '../../lib/pitContactEpisode.ts';
import {physicalPitOutcome,V2_PIT} from '../../lib/pitContact.ts';
import {applyImpactDamage,pristineDamage} from '../../lib/vehicleDamage.ts';
import {SUSPECT,VEHICLES} from '../../lib/gameConfig.ts';

const neutral={throttle:0,brake:0,steer:0,gear:1},dt=1/60;
export function probeFixture({x=2.05,z=3.9,vx=-7,playerSpeed=16,targetSpeed=12,grip=1,damageEnabled=true,playerThrottle=0,playerSteer=0,authorized=true}={}) {
  const sim=physicalWorld('patrol'),p=sim.vehicle,s=sim.add('suspect');
  const episodes=makeContactEpisodes();let pd=pristineDamage(),sd=pristineDamage(),candidate=null;
  let maxYaw=0,maxDrop=0,maxLateral=0,minUp=1,success=null,firstContact=null,promotion=null,contacts=0;
  const classifications=new Set();
  try {
    p.body.setTranslation({x,y:p.body.translation().y,z},true);
    for(let i=0;i<120;i++){stepVehiclePhysics(p,neutral,grip);stepVehiclePhysics(s,neutral,grip);sim.world.step();}
    p.body.setLinvel({x:vx,y:0,z:-playerSpeed},true);s.body.setLinvel({x:0,y:0,z:-targetSpeed},true);
    for(let tick=0;tick<240;tick++) {
      const t=tick*dt,pre={player:readVehicleFrame(p.body),suspect:readVehicleFrame(s.body)};
      stepVehiclePhysics(p,{...neutral,throttle:playerThrottle,steer:playerSteer},grip,pd);
      // Target remains on passive wheels before and after candidate promotion;
      // this isolates chassis/tyre feasibility from an AI steering controller.
      stepVehiclePhysics(s,neutral,grip,sd);sim.world.step();
      const pf=readVehicleFrame(p.body,pre.player.yaw),sf=readVehicleFrame(s.body,pre.suspect.yaw);
      const contact=physicalContactSample(sim.world,p.body,s.body,pf,sf,pre,'patrol',authorized);
      const decision=observeContactEpisode(episodes,contact,t,!!candidate);
      minUp=Math.min(minUp,sf.upDot);
      if(contact){contacts++;classifications.add(decision.assessment.classification);if(!firstContact)firstContact={at:t,...contact,classification:decision.assessment.classification};}
      if(decision.damage&&damageEnabled){
        const impulse=Math.max(2,contact.normalSpeed*2);
        sd=applyImpactDamage(sd,{impulse,localX:contact.localX,localZ:contact.localZ,halfWidth:SUSPECT.width/2,halfLength:SUSPECT.length/2});
        pd=applyImpactDamage(pd,{impulse:impulse*.72,localX:contact.playerLocalX,localZ:contact.playerLocalZ,halfWidth:VEHICLES.patrol.width/2,halfLength:VEHICLES.patrol.length/2});
      }
      if(decision.promoted){candidate={yaw:pre.suspect.yaw,speed:pre.suspect.planarSpeed,at:t,contactTime:dt};promotion={at:t,...contact};}
      else if(candidate&&contact)candidate.contactTime+=dt;
      if(candidate){
        const result=physicalPitOutcome(candidate.yaw,sf.yaw,candidate.speed,sf.planarSpeed,sf.lateralSpeed,candidate.contactTime,sf.headingValid);
        maxYaw=Math.max(maxYaw,result.yawChange*180/Math.PI);maxDrop=Math.max(maxDrop,result.speedDrop);maxLateral=Math.max(maxLateral,Math.abs(sf.lateralSpeed));
        if(result.success&&!success)success={at:t,afterPromotion:t-candidate.at,...result,lateralSpeed:sf.lateralSpeed,upDot:sf.upDot,headingValid:sf.headingValid};
        if(t-candidate.at>=V2_PIT.window||success)break;
      }
    }
    return {input:{x,z,vx,playerSpeed,targetSpeed,grip,damageEnabled,playerThrottle,playerSteer},contacts,classifications:[...classifications],firstContact,promotion,success,maxYaw,maxDrop,maxLateral,minUp,finalDamage:sd};
  } finally {sim.dispose();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await RAPIER.init();
  const original=probeFixture();console.log('ORIGINAL',JSON.stringify(original));
  const results=[];
  for(const grip of [1,.78,.58])for(const z of [3.5,3.9,4.2])for(const vx of [-5,-6,-7,-7.8])for(const playerSpeed of [14,16,18,20]) {
    results.push(probeFixture({grip,z,vx,playerSpeed}));
  }
  const successes=results.filter(r=>r.success&&r.success.headingValid&&r.success.upDot>.9);
  const promoted=results.filter(r=>r.promotion);
  console.log('SUMMARY',JSON.stringify({cases:results.length,promoted:promoted.length,validUprightSuccesses:successes.length,perGrip:[1,.78,.58].map(grip=>({grip,success:successes.filter(r=>r.input.grip===grip).length})),bestPromoted:promoted.toSorted((a,b)=>b.maxYaw-a.maxYaw).slice(0,5)}));
  console.log('SUCCESS_CASES',JSON.stringify(successes.slice(0,8)));
}
