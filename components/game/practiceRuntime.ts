import { makePlayerDriving } from '../../lib/playerDriving.ts';
import { pristineDamage } from '../../lib/vehicleDamage.ts';
import { makeDiagnostics } from '../../lib/pitDiagnostics.ts';
import { PRACTICE, type PracticeConfig } from '../../lib/practiceConfig.ts';
import type { CarSnapshot } from '../../types/game.ts';
export type PracticePhase='ready'|'playing'|'paused'|'qualified'|'outside';
export type PracticeCandidate={startYaw:number;startSpeed:number;expires:number;contactTime:number};
export function makePracticeRuntime(config:PracticeConfig) {
  const car=(x:number,z:number):CarSnapshot=>({x,z,yaw:0,speed:PRACTICE.speed,lateralSpeed:0});
  return {mode:'practice' as const,phase:'ready' as PracticePhase,elapsed:0,
    player:car(PRACTICE.playerX,PRACTICE.playerZ),suspect:car(0,0),
    driving:makePlayerDriving(),playerDamage:pristineDamage(),suspectDamage:pristineDamage(),
    candidate:null as PracticeCandidate|null,cooldown:0,successPresented:false,
    diagnostics:makeDiagnostics('practice',`晴朗／白天／${config.vehicle}／50 km/h`)};
}
export type PracticeRuntime=ReturnType<typeof makePracticeRuntime>;
