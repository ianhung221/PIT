import type {RadioCommand} from '../types/game.ts';
/** The tactical request survives an automatic attempt; PIT history is never an arm switch. */
export interface PursuitEvents {seenPit:number;automatic:boolean;commandAt:number;attempt:number}
export const makePursuitEvents=():PursuitEvents=>({seenPit:0,automatic:false,commandAt:-1,attempt:0});
export function cancelPursuitAttempt(state:PursuitEvents,pitCount:number,commandAt:number){state.automatic=false;state.seenPit=pitCount;state.commandAt=commandAt;}
export function stepPursuitEvents(state:PursuitEvents,input:{pitCount:number;pitQualified:boolean;command:RadioCommand|null;commandAt:number;running:boolean}){
 let cancelled=false,started=false;
 if(!input.running||input.command==='terminate'){
  cancelled=state.automatic;state.automatic=false;state.seenPit=input.pitCount;state.commandAt=input.commandAt;
  return {active:false,automatic:false,cancelled,started};
 }
 // A new manual instruction consumes previous PITs, including a simultaneous old event.
 if(input.commandAt!==state.commandAt){
  cancelled=state.automatic;state.automatic=false;state.seenPit=input.pitCount;state.commandAt=input.commandAt;
 }
 if(input.pitCount>state.seenPit){state.seenPit=input.pitCount;state.automatic=true;state.attempt++;started=true;}
 if(!input.pitQualified)state.automatic=false;
 return {active:input.command==='block-front'||state.automatic,automatic:state.automatic,cancelled,started};
}
