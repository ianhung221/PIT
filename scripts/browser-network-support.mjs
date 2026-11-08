import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

/** Natural mission start and actual radio UI; no pose, damage or result injection. */
export async function verifyNetworkSupport({evaluate,delay,capture}){
 const samples=[],read=async label=>{
  const r=await evaluate(`(()=>{const r=window.__pitInspect().runtime;return {elapsed:r.elapsed,result:r.result,formation:r.networkSupport,command:r.tacticalCommand,radio:r.radioFeedback,player:r.player,suspect:r.suspect,supports:r.supports,arrived:r.supportArrivedFor,drivers:r.networkDrivers.map(d=>({blocked:d.blocked,local:d.local,location:d.location}))};})()`);
  samples.push({label,...r});return r;
 };
 const radio=async index=>{
  await evaluate(`document.querySelector('.radio-trigger').click()`);await delay(100);
  await evaluate(`document.querySelectorAll('.radio-wheel>button')[${index-1}].click()`);
 };
 try{
  await radio(5);await delay(250);const pending=await read('Q5 received');
  assert.equal(pending.command,'take-primary');
  let caught=false;
  for(let i=0;i<150;i++){
   await delay(1000);const sample=await read(`pursuit-${i}`);
   if(sample.formation.leader!==null){caught=true;break;}
   if(i%15===0)console.log('backup pursuit',sample.elapsed,sample.formation);
   if(sample.result!=='playing')break;
  }
  assert.ok(caught,'backup never reached a real lead position in the bounded pursuit');
  const lead=await read('actual lead');assert.equal(lead.supports[lead.formation.leader].role,'primary');
  await capture('network-backup-lead');
  await radio(2);await delay(500);const returned=await read('Q2 return');
  assert.equal(returned.formation.leader,null);assert.equal(returned.formation.candidate,null);
  await radio(3);await delay(1500);assert.equal((await read('Q3 approach')).command,'move-up');
  await capture('network-backup-approach');
  console.log('network support actual lead and command return passed');
 }finally{
  try{await read('final');}catch(error){samples.push({label:'final-read-failed',error:String(error)});}
  await mkdir('work/network-support',{recursive:true});
  const path=`work/network-support/${Date.now()}.json`;await writeFile(path,JSON.stringify({fixture:'Natural start; actual Q5/Q2/Q3 UI; no injected car states.',samples},null,2),{flag:'wx'});console.log('network support evidence',path);
 }
}
