import { classifyPhysicalContact, physicalPitOutcome, V2_PIT, type PhysicalContact } from './pitContact.ts';
import { normalizeAngle } from './gameRules.ts';
import type { ContactEpisode } from './pitContactEpisode.ts';

export const DIAGNOSTIC_LIMIT = 60;
export type ContactCheck = { code: string; label: string; pass: boolean; value: string; hint: string };
export function contactChecks(c: PhysicalContact): ContactCheck[] {
  const check = (code: string, label: string, pass: boolean, value: string, hint: string) => ({ code, label, pass, value, hint });
  return [
    check('data', '接觸資料', [c.localX,c.localZ,c.playerLocalZ,c.normalSide,c.closingSpeed,c.normalSpeed].every(Number.isFinite), '實體接觸量測', '需有有效的實體接觸資料。'),
    check('relative-speed', '相對速度', c.closingSpeed <= V2_PIT.maxClosingSpeed, `${c.closingSpeed.toFixed(2)} / ≤12 m/s`, '在遊戲中先減小兩車速度差。'),
    check('normal-speed-high', '法向撞擊速度', c.normalSpeed <= 8, `${c.normalSpeed.toFixed(2)} / ≤8 m/s`, '減小向目標車側面撞入的速度。'),
    check('target-zone', '目標後側區域', c.localZ >= c.halfLength*.5 && c.localZ <= c.halfLength+.08 && Math.abs(c.localX)>=c.halfWidth*.65 && Math.abs(c.localX)<=c.halfWidth+.08, `x ${c.localX.toFixed(2)} · z ${c.localZ.toFixed(2)} m`, '可在練習場開啟區域提示，檢查目標後側的接觸位置。'),
    check('player-zone', '玩家前端區域', c.playerLocalZ <= -c.playerHalfLength*.45 && c.playerLocalZ >= -c.playerHalfLength-.08, `z ${c.playerLocalZ.toFixed(2)} m`, '檢查是否由玩家車頭前段接觸。'),
    check('normal-direction', '側向接觸方向', Math.abs(c.normalSide)>.6, `${Math.abs(c.normalSide).toFixed(2)} / >0.60`, '車尾正後方的碰撞不算側面接觸。'),
    check('heading', '車身夾角', Math.abs(normalizeAngle(c.headingDelta))<=V2_PIT.maxAngle, `${(Math.abs(normalizeAngle(c.headingDelta))*180/Math.PI).toFixed(1)} / ≤35°`, '先讓兩車朝向接近，再嘗試接觸。'),
    check('normal-speed-low', '最低接觸速度', c.normalSpeed>=V2_PIT.minNormalSpeed, `${c.normalSpeed.toFixed(2)} / ≥0.35 m/s`, '輕微擦碰可能不足以啟動評估。'),
    check('authorization', '接觸當下授權', c.authorized, c.authorized?'有效':'無效', '一般任務請等待目前授權有效。'),
  ];
}
export type OutcomeSample = { yaw: number; speedDrop: number; lateralSpeed: number; contactTime: number; startSpeed: number; remaining: number; success: boolean; reasons: string[] };
export function outcomeSample(startYaw: number, yaw: number, startSpeed: number, speed: number, lateralSpeed: number, contactTime: number, remaining: number): OutcomeSample {
  const result = physicalPitOutcome(startYaw,yaw,startSpeed,speed,lateralSpeed,contactTime);
  const angle = Math.abs(normalizeAngle(yaw-startYaw));
  const drop = startSpeed<=.1 ? 0 : Math.max(0,(startSpeed-speed)/startSpeed);
  const reasons: string[] = [];
  if (angle < Math.PI*55/180) reasons.push('旋轉未達 55°');
  if (drop<.35 && Math.abs(lateralSpeed)<4) reasons.push('減速未達 35% 且側滑未達 4 m/s');
  if (contactTime<V2_PIT.minContactTime) reasons.push('接觸時間不足');
  if (startSpeed<=4) reasons.push('接觸前速度未高於 4 m/s');
  return { yaw:angle*180/Math.PI,speedDrop:drop,lateralSpeed:Math.abs(lateralSpeed),contactTime,startSpeed,remaining:Math.max(0,remaining),success:result.success,reasons };
}
export type DiagnosticAttempt = { id:number; at:number; contact:PhysicalContact; checks:ContactCheck[]; classification:ReturnType<typeof classifyPhysicalContact>['classification']; status:'observing'|'rejected'|'evaluating'|'qualified'|'expired'; message:string; sample:OutcomeSample|null };
export type DiagnosticEvent = { attempt:number; at:number; message:string; evidence:DiagnosticAttempt|null };
export type PitDiagnostics = { version:'v3-batch1'; mode:'mission'|'practice'; config:string; nextId:number; latest:DiagnosticAttempt|null; lastSuccess:DiagnosticAttempt|null; events:DiagnosticEvent[] };
export function makeDiagnostics(mode: PitDiagnostics['mode'], config:string): PitDiagnostics {
  return {version:'v3-batch1',mode,config,nextId:1,latest:null,lastSuccess:null,events:[]};
}
function record(d:PitDiagnostics, attempt:number, at:number, message:string) {
  d.events.unshift({attempt,at,message,evidence:d.latest?structuredClone(d.latest):null}); d.events.splice(DIAGNOSTIC_LIMIT);
}
export function beginDiagnostic(d:PitDiagnostics,c:PhysicalContact,at:number) {
  const assessed=classifyPhysicalContact(c), checks=contactChecks(c), failed=checks.filter(x=>!x.pass);
  const message=assessed.classification==='effective'?'接觸成立，評估實際失控':failed.map(x=>x.label+'不符').join('、');
  d.latest={id:d.nextId++,at,contact:{...c},checks,classification:assessed.classification,status:assessed.classification==='effective'?'evaluating':'rejected',message,sample:null};
  record(d,d.latest.id,at,message);
  return assessed;
}
export function updateDiagnostic(d:PitDiagnostics,sample:OutcomeSample,at:number,expired:boolean) {
  const attempt=d.latest;
  if (!attempt || attempt.status!=='evaluating') return;
  attempt.sample=sample;
  if (!sample.success && !expired) return;
  attempt.status=sample.success?'qualified':'expired';
  attempt.message=sample.success?'有效 PIT 已確認':`評估期限已到：${sample.reasons.join('；')}`;
  if(sample.success) d.lastSuccess=structuredClone(attempt);
  record(d,attempt.id,at,attempt.message);
}
export function diagnosticSummary(d:PitDiagnostics) {
  const latest=d.latest;
  return {
    latest:latest ? `#${latest.id} · ${latest.at.toFixed(1)}s · ${latest.message}`:'尚無接觸紀錄',
    history:d.lastSuccess?`本局已完成有效 PIT #${d.lastSuccess.id}（${d.lastSuccess.at.toFixed(1)}s 接觸）`:'本局尚未確認有效 PIT',
  };
}
export function observeDiagnostic(d:PitDiagnostics,contact:PhysicalContact,episode:ContactEpisode,at:number,changed:boolean) {
  if(!episode.diagnosticId) {beginDiagnostic(d,contact,at);episode.diagnosticId=d.latest!.id;}
  const attempt=d.latest;
  if(!attempt||attempt.id!==episode.diagnosticId)return;
  if(episode.status==='done')return;
  if(episode.status==='evaluating'&&!changed)return;
  if(episode.status==='locked'&&!changed)return;
  const oldMessage=attempt.message;
  attempt.contact={...contact};attempt.checks=contactChecks(contact);attempt.classification=episode.classification;
  if(episode.status==='observing') {attempt.status='observing';attempt.message='接觸觀察中：'+attempt.checks.filter(c=>!c.pass).map(c=>c.label+'不符').join('、');}
  if(episode.status==='evaluating') {attempt.status='evaluating';attempt.message='連續接觸符合條件，評估實際失控';}
  if(episode.status==='expired') {attempt.status='rejected';attempt.message='接觸觀察期限已到，未形成合適接觸';}
  if(episode.status==='locked') {attempt.status='rejected';attempt.message=classifyPhysicalContact(contact).reason+'；本段不可轉為合格，需分離後重試';}
  if(changed&&attempt.message!==oldMessage)record(d,attempt.id,at,attempt.message);
}
export function closeContactDiagnostic(d:PitDiagnostics,episode:ContactEpisode|null,at:number) {
  const a=d.latest;
  if(!episode||!a||episode.diagnosticId!==a.id||a.status!=='observing')return;
  a.status='rejected';a.message='接觸已分離，未形成合適接觸';
  record(d,a.id,at,a.message);
}
