import { hashSeed } from './seededRandom.ts';
import type { SuspectDifficulty } from './gameConfig.ts';

export type SuspectDecision = { random:number; noticed:number; cooldown:number; duration:number; offset:number; speedScale:number; nextChange:number; mode:'following'|'observing'|'evading'; reactions:number; misses:number };
export function makeSuspectDecision(seed:string):SuspectDecision {
  return {random:hashSeed(seed)||1,noticed:0,cooldown:0,duration:0,offset:0,speedScale:1,nextChange:2,mode:'following',reactions:0,misses:0};
}
function random(state:SuspectDecision) {
  let x=state.random; x^=x<<13; x^=x>>>17; x^=x<<5; state.random=x>>>0; return state.random/4294967296;
}
// Only observed vehicle positions enter the decision; player input is not read.
export function stepSuspectDecision(state:SuspectDecision, difficulty:SuspectDifficulty, dt:number, distance:number, lateral:number, halfWidth:number, threatSide=0) {
  state.cooldown=Math.max(0,state.cooldown-dt);
  state.nextChange=Math.max(0,state.nextChange-dt);
  const reaction=difficulty==='advanced'?.8:1.4;
  state.noticed=distance<18 ? Math.min(reaction,state.noticed+dt) : 0;
  if(state.duration>0) {
    state.duration=Math.max(0,state.duration-dt);
    if(!state.duration){state.offset=0;state.speedScale=1;}
  }
  state.mode=state.duration>0?'evading':state.noticed>0?'observing':'following';
  if(difficulty==='basic') {state.offset=0;state.speedScale=1;state.mode='following';return state;}
  if(state.noticed>=reaction && state.cooldown===0 && state.duration===0) {
    state.noticed=0;state.cooldown=(difficulty==='advanced'?4:6)+random(state)*2;
    if(random(state)>(difficulty==='advanced'?.22:.35)) {
      state.reactions++;state.mode='evading';
      state.duration=1.4+random(state);
      const direction=threatSide>0?-1:threatSide<0?1:lateral>0?-1:1;
      state.offset=Math.max(-halfWidth*.65,Math.min(halfWidth*.65,lateral+direction*((difficulty==='advanced'?1.5:.8)+random(state))));
      state.speedScale=random(state)<.4?.82:1;
    } else state.misses++;
  }
  return state;
}
