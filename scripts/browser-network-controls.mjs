import assert from 'node:assert/strict';

/** Actual keyboard inputs; no vehicle positions, clocks or results are injected. */
export async function verifyNetworkControls({evaluate,command,delay,capture}){
 const key=(key,type='keyDown')=>command('Input.dispatchKeyEvent',{key,type});
 const tap=async value=>{await key(value);await key(value,'keyUp');};
 const read=()=>evaluate('(()=>{const r=window.__pitInspect().runtime;return {player:r.player,driving:r.driving,elapsed:r.elapsed,result:r.result};})()');
 const initial=await read();
 await key('ArrowUp');await delay(2400);await key('ArrowUp','keyUp');await delay(300);
 assert.ok((await read()).player.speed>initial.player.speed+1);
 // A nearby AI can still be touching the car after launch. Cruise correctly
 // refuses that state; drive clear first rather than bypassing its safety rule.
 let ready=await read();
 if(ready.driving.touching||ready.player.speed<4){
  await key('ArrowUp');
  for(let i=0;i<50;i++){await delay(150);ready=await read();if(!ready.driving.touching&&ready.player.speed>=4)break;}
  await key('ArrowUp','keyUp');await delay(300);
 }
 await tap('f');await delay(300);const cruise=await read();assert.equal(cruise.driving.cruise,true,JSON.stringify(cruise));
 await tap(']');await delay(200);assert.equal((await read()).driving.target,cruise.driving.target+5);
 await tap('[');await delay(200);assert.equal((await read()).driving.target,cruise.driving.target);
 await key('ArrowDown');await delay(200);await key('ArrowDown','keyUp');assert.equal((await read()).driving.cruise,false);
 await capture('network-chase');
 await tap('c');await delay(400);assert.match(await evaluate('document.querySelector(".hud-camera strong").textContent'),/駕駛/);
 await capture('network-driver');await key('r');await delay(300);await capture('network-rear');await key('r','keyUp');
 await tap('c');await delay(400);assert.match(await evaluate('document.querySelector(".hud-camera strong").textContent'),/直升機/);
 await key('ArrowUp');
 for(let i=0;i<4;i++){await delay(350);await capture(`network-helicopter-${i}`);}
 await key('ArrowUp','keyUp');await tap('c');
 await key('q');await delay(200);assert.equal(await evaluate('!!document.querySelector(".radio-wheel")'),true);await key('q','keyUp');await tap('q');
 await tap('p');await delay(200);const paused=(await read()).elapsed;await delay(400);assert.equal((await read()).elapsed,paused);await tap('p');
 for(const [label,expected] of [['準備執行 PIT','prepare-pit'],['第二單位靠近','move-up'],['封鎖嫌犯車頭','block-front'],['接替主追單位','take-primary']]){
  await evaluate('document.querySelector(".radio-trigger").click()');await delay(150);
  await evaluate(`([...document.querySelectorAll('.radio-wheel>button')].find(b=>b.textContent.includes(${JSON.stringify(label)}))).click()`);await delay(350);
  assert.equal(await evaluate('window.__pitInspect().runtime.tacticalCommand'),expected);
 }
 const final=await read();assert.equal(final.result,'playing');
 console.log('network controls passed',{initial,final});
}
