import { hashSeed } from './seededRandom.ts';
import type { SuspectDifficulty } from './gameConfig.ts';

export type SuspectDecision = { random:number; noticed:number; cooldown:number; duration:number; offset:number; speedScale:number; nextChange:number };
export function makeSuspectDecision(seed:string):SuspectDecision {
  return {random:hashSeed(seed)||1,noticed:0,cooldown:0,duration:0,offset:0,speedScale:1,nextChange:2};
}
function random(state:SuspectDecision) {
  let x=state.random; x^=x<<13; x^=x>>>17; x^=x<<5; state.random=x>>>0; return state.random/4294967296;
}
// Only observed vehicle positions enter the decision; player input is not read.
export function stepSuspectDecision(state:SuspectDecision, difficulty:SuspectDifficulty, dt:number, distance:number, lateral:number, halfWidth:number, threatSide=0) {
  state.cooldown=Math.max(0,state.cooldown-dt);
  state.nextChange=Math.max(0,state.nextChange-dt);
  state.noticed=distance<18 ? Math.min(.8,state.noticed+dt) : 0;
  if(state.duration>0) {
    state.duration=Math.max(0,state.duration-dt);
    if(!state.duration){state.offset=0;state.speedScale=1;}
  }
  if(difficulty==='basic') {state.offset=0;state.speedScale=1;return state;}
  if(difficulty==='advanced' && state.noticed>=.8 && state.cooldown===0 && state.duration===0) {
    state.noticed=0;state.cooldown=4+random(state)*2;
    if(random(state)>.22) {
      state.duration=1.4+random(state);
      const direction=threatSide>0?-1:threatSide<0?1:lateral>0?-1:1;
      state.offset=Math.max(-halfWidth*.65,Math.min(halfWidth*.65,lateral+direction*(1.5+random(state))));
      state.speedScale=random(state)<.4?.82:1;
    }
  } else if(state.duration===0 && state.nextChange<=0) {
    state.offset=(random(state)*2-1)*Math.min(1,halfWidth*.2);
    state.speedScale=1;state.duration=2+random(state)*2;state.nextChange=state.duration+1;
  }
  return state;
}
