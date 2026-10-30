/** Physical availability only; never awards PIT credit or rights the chassis. */
export interface RolloverState { disabled:boolean; unstableFor:number; recoveredFor:number }
export interface RolloverSample {
  upDot:number; groundedWheels:number; groundContact:boolean;
  planarSpeed:number; angularSpeed:number; verticalSpeed:number;
}
export const makeRolloverState=():RolloverState=>({disabled:false,unstableFor:0,recoveredFor:0});
export function updateRollover(state:RolloverState,s:RolloverSample,dt:number) {
  const finite=[s.upDot,s.planarSpeed,s.angularSpeed,s.verticalSpeed,dt].every(Number.isFinite);
  const overturned=finite&&s.upDot<Math.cos(70*Math.PI/180)&&s.groundedWheels<2;
  const settled=overturned&&s.groundContact&&s.planarSpeed<.65&&s.angularSpeed<.12&&Math.abs(s.verticalSpeed)<.15;
  state.unstableFor=settled?state.unstableFor+dt:0;
  if(state.unstableFor>=1)state.disabled=true;
  const restored=finite&&s.upDot>Math.cos(35*Math.PI/180)&&s.groundedWheels>=2;
  state.recoveredFor=restored?state.recoveredFor+dt:0;
  if(state.recoveredFor>=1)state.disabled=false;
  return state;
}
