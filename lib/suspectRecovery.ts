import type {CarSnapshot} from '../types/game.ts';
import type {SuspectDifficulty} from './gameConfig.ts';
export interface SuspectRecovery {pitCount:number;active:boolean;elapsed:number;stableFor:number}
export const makeSuspectRecovery=():SuspectRecovery=>({pitCount:0,active:false,elapsed:0,stableFor:0});
/** Observe actual motion after qualification; never imposes a zero target speed. */
export function stepSuspectRecovery(state:SuspectRecovery,pitCount:number,car:CarSnapshot,difficulty:SuspectDifficulty,dt:number){
 if(pitCount>state.pitCount){state.pitCount=pitCount;state.active=true;state.elapsed=0;state.stableFor=0;}
 if(!state.active)return false;
 state.elapsed+=dt;
 const stable=!!car.pose&&car.pose.groundedWheels>=3&&car.pose.headingValid&&car.pose.upDot>.75&&car.pose.angularSpeed<.65&&Math.abs(car.lateralSpeed)<1.5;
 state.stableFor=stable?state.stableFor+dt:0;
 const reaction=difficulty==='basic'?.8:difficulty==='normal'?.5:.3;
 if(state.elapsed>=reaction&&state.stableFor>=(difficulty==='advanced'?.2:.35))state.active=false;
 return state.active;
}
