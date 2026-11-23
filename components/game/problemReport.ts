import type {MissionConfig} from '../../lib/gameConfig';
import type {V2Runtime} from './v2Runtime';

export function createProblemReport(runtime:V2Runtime,config:MissionConfig,version:string){
  const drivers=runtime.networkDrivers.slice(1).map(driver=>({
    road:driver.location??null,
    blocked:driver.blocked,
    localMode:driver.local.mode,
    localReason:driver.local.reason||null,
    turnaroundReason:driver.turnaroundReason??null,
  }));
  const blockade=runtime.blockade;
  return JSON.stringify({
    format:'PIT problem report 1',
    version,
    map:runtime.road.code,
    settings:config,
    elapsed:runtime.elapsed,
    vehicles:{
      player:{state:runtime.player,damage:runtime.playerDamage,driving:runtime.driving},
      suspect:{state:runtime.suspect,damage:runtime.suspectDamage},
      supports:runtime.supports.map((state,index)=>({state,damage:runtime.supportDamage[index],control:runtime.supportControl[index],driver:drivers[index]})),
    },
    command:runtime.command,
    tacticalCommand:runtime.tacticalCommand,
    radio:runtime.radioFeedback,
    pit:{qualified:runtime.pitQualified,candidate:runtime.pitCandidate,attempts:runtime.attempts,contacts:runtime.successfulContacts},
    assessment:runtime.control,
    blockade:{
      phase:blockade.phase,reason:blockade.reason,anchor:blockade.anchor,frontUnit:blockade.frontUnit,
      stages:blockade.stages,settled:blockade.settled,blockedFor:blockade.blockedFor,
      available:blockade.available,playerCovered:blockade.playerCovered,assigned:blockade.assigned,
      nearby:blockade.nearby,parkingGoal:blockade.parkingGoal,planning:blockade.planning,
      maneuverAttempts:blockade.maneuverAttempts,planningSpent:blockade.planningSpent,
    },
    events:runtime.eventLog,
  },null,2);
}
