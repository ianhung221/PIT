import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSuspectDecision,stepSuspectDecision} from '../lib/suspectDriving.ts';
import {chooseObservedExit,observedExitRisk} from '../lib/suspectEscapeChoice.ts';
import {createSeededRandom} from '../lib/seededRandom.ts';

test('five seeds per difficulty show delayed, bounded reactions without idle weaving',t=>{
 const summary=[];
 for(const difficulty of ['basic','normal','advanced'])for(let seed=0;seed<5;seed++){
  const state=makeSuspectDecision(`OBS-${seed}`);let first=null,lastReaction=-Infinity,previous=0;
  for(let frame=0;frame<1800;frame++){
   stepSuspectDecision(state,difficulty,1/60,frame<300?100:10,0,8,2);
   if(frame<300)assert.equal(state.offset,0,'no unobserved threat may trigger weaving');
   if(state.reactions>previous){
    if(first===null)first=(frame-300+1)/60;
    assert.ok(frame/60-lastReaction>=(difficulty==='advanced'?4:6));
    lastReaction=frame/60;previous=state.reactions;
    assert.ok(state.offset<0&&Math.abs(state.offset)<=8*.65);
   }
  }
  if(difficulty==='basic')assert.equal(first,null);
  else if(first!==null)assert.ok(first>=(difficulty==='advanced'?.8:1.4));
  summary.push({difficulty,seed,first,reactions:state.reactions,misses:state.misses});
 }
 assert.ok(summary.some(s=>s.difficulty==='normal'&&s.reactions>0));
 assert.ok(summary.some(s=>s.misses>0));
 t.diagnostic(JSON.stringify(summary));
});

test('observed blocked exit discourages escape; absent observations do not reveal police',()=>{
 const nodes=[{id:'center',x:0,z:0},{id:'north',x:0,z:-100},{id:'east',x:100,z:0}];
 const edges=[{id:'n',a:'center',b:'north',width:12,length:100,biome:'city'},{id:'e',a:'center',b:'east',width:12,length:100,biome:'city'}];
 const network={nodes,edges},observed={at:0,cars:[{x:0,z:-20,yaw:0,speed:0,lateralSpeed:0}],objects:[]},empty={...observed,cars:[]};
 assert.ok(observedExitRisk(network,'center',edges[0],observed)>0);
 assert.equal(observedExitRisk(network,'center',edges[1],observed),0);
 let avoided=0;
 for(let seed=0;seed<5;seed++){
  const key=`EXIT-${seed}`;
  const actual=chooseObservedExit(network,'center',edges,observed,'advanced',createSeededRandom(key));
  if(actual.id==='e')avoided++;
  assert.equal(chooseObservedExit(network,'center',edges,empty,'advanced',createSeededRandom(key)),chooseObservedExit(network,'center',edges,empty,'basic',createSeededRandom(key)));
 }
 assert.ok(avoided>=4);
});
