import type {RadioCommand,PursuitRole} from '../types/game.ts';
import type {DrivingCar} from './drivingObservation.ts';
import {relativePosition} from './drivingObservation.ts';
import type {RoadNetwork} from './roadNetwork.ts';
import {locateRoad} from './roadLocation.ts';

export interface NetworkSupportState {
 leader:0|1|null;candidate:0|1|null;commandAt:number;farFor:number;readyFor:number;
}
export const makeNetworkSupport=():NetworkSupportState=>({leader:null,candidate:null,commandAt:-1,farFor:0,readyFor:0});
export interface NetworkSupportInput {
 network:RoadNetwork;player:DrivingCar;suspect:DrivingCar;supports:[DrivingCar,DrivingCar];
 available:[boolean,boolean];playerAvailable:boolean;command:RadioCommand|null;commandAt:number;grip:number;dt:number;
 pitPreparing?:boolean;
}
const distance=(a:DrivingCar,b:DrivingCar)=>Math.hypot(a.x-b.x,a.z-b.z);
export function stepNetworkSupport(state:NetworkSupportState,input:NetworkSupportInput){
 const {player,suspect,supports,available,playerAvailable,command,grip,dt,network}=input;
 const preferred:0|1|null=available[0]?0:available[1]?1:null;
 if(state.leader!==null&&!available[state.leader])state.leader=null;
 if(state.candidate!==null&&!available[state.candidate])state.candidate=null;
 if(input.commandAt!==state.commandAt){
  state.commandAt=input.commandAt;state.readyFor=0;
  if((command==='prepare-pit'||command==='move-up')&&playerAvailable){state.leader=null;state.candidate=null;state.farFor=0;}
  if(command==='take-primary')state.candidate=state.leader??preferred;
 }
 state.farFor=distance(player,suspect)>110?state.farFor+dt:0;
 if((!playerAvailable||state.farFor>5||command==='take-primary')&&state.leader===null&&state.candidate===null)state.candidate=preferred;
 if(state.candidate!==null){
  const car=supports[state.candidate],p=locateRoad(network,player),c=locateRoad(network,car);
  const ahead=p.edge===c.edge&&p.from===c.from&&c.distance-p.distance>6;
  const reachableLead=distance(car,suspect)<75&&(ahead||(!playerAvailable||state.farFor>5)&&distance(car,suspect)+8<distance(player,suspect));
  state.readyFor=reachableLead?state.readyFor+dt:0;
  if(state.readyFor>.6){state.leader=state.candidate;state.candidate=null;}
 }
 const followUnit=state.leader??(state.farFor>5?state.candidate:null);
 const leader=followUnit===null?player:supports[followUnit];
 const slots=supports.map((car,unit)=>{
  const taking=unit===state.candidate||unit===state.leader;
  const close=command==='move-up'&&unit===preferred;
  const headway=(command==='prepare-pit'||input.pitPreparing?1.15:close?.55:.85)/Math.sqrt(Math.max(.25,grip));
  const gap=taking?14:Math.max(close?9:14,Math.abs(leader.speed)*headway+8)+(unit===preferred?0:18);
  const role:PursuitRole=!available[unit]?'unavailable':unit===state.leader?'primary':unit===preferred?'secondary':'tertiary';
  const target=taking||followUnit!==null&&distance(car,leader)>80?suspect:leader;
  // Until the candidate is physically ahead it is still a supporting unit.
  const relative=relativePosition(player,car);
  const allowOvertake=unit===state.candidate&&relative.forward<8;
  return {target,gap,role,allowOvertake};
 });
 return {slots,leader:state.leader,candidate:state.candidate,preferred,playerRole:(state.leader===null?'primary':'secondary') as PursuitRole};
}
