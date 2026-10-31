import type { VehicleId, QualityId, MissionConfig, WeatherId, SuspectDifficulty } from './gameConfig.ts';
export type PracticeConfig = { vehicle:VehicleId; quality:QualityId; speedKph?:30|50|70; weather?:WeatherId; difficulty?:SuspectDifficulty; behaviorSeed?:string };
export type GameSession = { mode:'mission'; config:MissionConfig } | { mode:'practice'; config:PracticeConfig };
export const PRACTICE = { halfSize:1000, speed:50/3.6, playerX:2.4, playerZ:10, suspectX:0, suspectZ:0 } as const;
export const outsidePractice = (...positions:{x:number;z:number}[]) => positions.some(p=>Math.abs(p.x)>PRACTICE.halfSize || Math.abs(p.z)>PRACTICE.halfSize);
export const practiceSpeed = (config:PracticeConfig) => (config.speedKph ?? 50) / 3.6;
