import {mkdir,writeFile} from 'node:fs/promises';
import {verifyVehiclePit} from './browser-vehicle-pit.mjs';

/** Observations of stock runtime; only the existing PIT fixture sets initial bodies. */
export async function recordAiBaseline(api){
 const {evaluate,delay,capture}=api,samples=[];let profile=null,profiling=false;
 const read=async label=>samples.push({label,...await evaluate(`(()=>{const r=window.__pitInspect().runtime;return {elapsed:r.elapsed,result:r.result,control:r.control,recovery:r.suspectRecovery,events:r.pursuitEvents,damage:r.suspectDamage,command:r.tacticalCommand,pitQualified:r.pitQualified,blockade:r.blockade,player:r.player,suspect:r.suspect,supports:r.supports,arrived:r.supportArrivedFor,decision:r.decision,drivers:r.networkDrivers.map(d=>({goal:d.goal,blocked:d.blocked,offset:d.laneOffset,location:d.location,local:d.local})),radio:r.radioFeedback};})()`)});
 try{
 await read('initial');
 for(const index of [1,2,4,1]){
  await evaluate(`document.querySelector('.radio-trigger').click()`);await delay(80);
  await evaluate(`document.querySelectorAll('.radio-wheel>button')[${index}].click()`);await delay(1500);await read(`Q${index+1}`);
 }
 await verifyVehiclePit(api);await read('Q2-effective-PIT');
 if(process.env.PIT_AI_PROFILE==='true'){
  await evaluate(`(()=>{
   let context=null,runtime=null;const seen=new Set();function walk(f){if(!f||seen.has(f))return;seen.add(f);if(f.memoizedProps?.runtime?.current?.road)runtime=f.memoizedProps.runtime.current;const v=f.memoizedProps?.value;if(v?.world?.step&&v?.beforeStepCallbacks&&v?.afterStepCallbacks)context=v;walk(f.child);walk(f.sibling);}for(const r of window.__pitRoots)walk(r.current);
   if(!context||!runtime)throw Error('Physics profiling context unavailable');
   const p=window.__pitManeuverProfile={samples:[],active:true};const before={current:()=>{p.start=performance.now();}};const after={current:()=>{if(p.active)p.samples.push({ms:performance.now()-p.start,phase:runtime.blockade.phase,shoulder:!!runtime.blockade.shoulderRecovery,parking:!!runtime.blockade.parkingRecovery});}};
   const original=[...context.beforeStepCallbacks];context.beforeStepCallbacks.clear();context.beforeStepCallbacks.add(before);original.forEach(x=>context.beforeStepCallbacks.add(x));context.afterStepCallbacks.add(after);
   p.stop=()=>{p.active=false;context.beforeStepCallbacks.delete(before);context.afterStepCallbacks.delete(after);return p.samples;};
  })()`);profiling=true;
 }
 for(let i=0;i<Number(process.env.PIT_AI_POST_SECONDS??6);i++){await delay(1000);await read(`after-PIT-${i+1}`);}
 await capture('ai-baseline-after-pit');
 }finally{
 if(profiling){try{profile=await evaluate('window.__pitManeuverProfile.stop()');}catch(error){profile={error:String(error)};}}
 await mkdir('work/ai-baseline',{recursive:true});const path=`work/ai-baseline/${process.env.PIT_AI_LABEL??'comparison'}-${Date.now()}.json`;
 await writeFile(path,JSON.stringify({url:process.env.PIT_TEST_URL,laneOffset:Number(process.env.PIT_AI_LANE_OFFSET??2.7),closeSupport:process.env.PIT_AI_CLOSE_SUPPORT==='true',positionedSupport:process.env.PIT_AI_POSITIONED_SUPPORT==='true',fixture:'Actual Q2/Q3/Q5 commands; controlled PIT initial positions/velocities; no injected qualification, timers or victory.',samples,profile},null,2),{flag:'wx'});
 console.log('AI baseline saved',path);
 }
}
