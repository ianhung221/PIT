import { makePlayerDriving } from '../../lib/playerDriving.ts';
import { pristineDamage } from '../../lib/vehicleDamage.ts';
import { makeDiagnostics } from '../../lib/pitDiagnostics.ts';
import { PRACTICE, practiceSpeed, type PracticeConfig } from '../../lib/practiceConfig.ts';
import { makeSuspectDecision } from '../../lib/suspectDriving.ts';
import type { CarSnapshot } from '../../types/game.ts';
import { makeContactEpisodes } from '../../lib/pitContactEpisode.ts';
export type PracticePhase='ready'|'playing'|'paused'|'qualified'|'outside';
export type PracticeCandidate={startYaw:number;startSpeed:number;expires:number;contactTime:number};
export function makePracticeRuntime(config:PracticeConfig) {
  const car=(x:number,z:number):CarSnapshot=>({x,z,yaw:0,speed:practiceSpeed(config),lateralSpeed:0});
  return {decision:makeSuspectDecision(config.behaviorSeed ?? 'PIT-TRAINING'),mode:'practice' as const,phase:'ready' as PracticePhase,elapsed:0,contactEpisodes:makeContactEpisodes(),
    player:car(PRACTICE.playerX,PRACTICE.playerZ),suspect:car(0,0),
    driving:makePlayerDriving(),playerDamage:pristineDamage(),suspectDamage:pristineDamage(),
    candidate:null as PracticeCandidate|null,cooldown:0,successPresented:false,
    diagnostics:makeDiagnostics('practice',`${config.weather ?? 'clear'}／白天／${config.vehicle}／${config.speedKph ?? 50} km/h／${config.difficulty ?? 'normal'}`)};
}
export type PracticeRuntime=ReturnType<typeof makePracticeRuntime>;
