import {mkdir,writeFile} from 'node:fs/promises';

/** Real inputs and retries only. Saves partial observations even on interruption. */
export async function verifyLongChase({evaluate,command,delay,waitFor,capture}){
 const observations=[],started=Date.now();let complete=false;
 const key=(value,type='keyDown')=>command('Input.dispatchKeyEvent',{key:value,type});
 const tap=async value=>{await key(value);await key(value,'keyUp');};
 const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent+' '+x.getAttribute('aria-label')).includes(${JSON.stringify(label)}));if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();})()`);
 const read=()=>evaluate(`(()=>{const r=window.__pitInspect().runtime;return {elapsed:r.elapsed,result:r.result,player:{...r.player},suspect:{...r.suspect},supports:r.supports.map(c=>({...c})),blockade:{...r.blockade},control:{...r.control},command:r.tacticalCommand};})()`);
 try{
  for(let i=0;i<60;i++){
   if(i>0&&i%18===0){await click('無線電指令');await delay(150);await click('終止追逐');await delay(300);await click('相同');await waitFor('!!window.__pitInspect()?.runtime && window.__pitInspect().runtime.result === "playing"','long-chase-retry');await delay(500);}
   if(i%6===0){await key('ArrowUp');await delay(2000);await key('ArrowUp','keyUp');}
   if(i%12===3){await click('無線電指令');await delay(100);await click('第二單位靠近');}
   if(i%12===7){await click('無線電指令');await delay(100);await click('接替主追單位');}
   if(i%12===10){await click('無線電指令');await delay(100);await click('準備執行 PIT');}
   if(i%15===5){await tap('c');}
   observations.push({second:(Date.now()-started)/1000,...await read()});
   await delay(10000);
  }
  await capture('long-chase');complete=true;
 } finally {
  try{await key('ArrowUp','keyUp');}catch{/* Browser may have disconnected. */}
  await mkdir('work/long-chase',{recursive:true});const file=`work/long-chase/${Date.now()}.json`;
  await writeFile(file,JSON.stringify({complete,wallSeconds:(Date.now()-started)/1000,fixture:'Keyboard, Q commands and same-map retries; no positions, clock or result injected. Not a substitute for human driving.',observations},null,2),{flag:'wx'});console.log('long chase saved',file,'complete',complete);
 }
}
