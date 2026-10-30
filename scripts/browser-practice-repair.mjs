import assert from 'node:assert/strict';
export async function verifyPracticeRepair({evaluate,command,delay,capture}) {
  const read=()=>evaluate('window.__pitInspect().runtime');
  const click=async text=>{await evaluate(`([...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)})).click()`);await delay(180);};
  const key=(key,type='keyDown',autoRepeat=false)=>command('Input.dispatchKeyEvent',{type,key,code:key,autoRepeat});
  // Explicit damaged-car fixture tests controls/UI, not the origin of a user's
  // intermittent input loss. Never set PIT diagnoses, candidates or outcomes.
  await evaluate(`(() => {const {runtime:r,bodies}=window.__pitInspect();r.playerDamage.engine=0;r.playerDamage.alignment=0;bodies[0].setLinvel({x:0,y:0,z:0},true);bodies[1].setTranslation({x:100,y:-.31,z:0},true);})()`);
  await click('開始練習');await evaluate(`document.querySelector('.diagnostic-toggles input').click()`);
  for(const direction of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']) {
    await key(direction);await delay(250);
    const r=await read(),name={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'}[direction];
    assert.equal(r.driving.input[name],true);assert.equal(r.driving.vehicleStatus.driveable,false);
    assert.ok(Math.abs(r.player.speed)<.01);await key(direction,'keyUp');
  }
  const status=await evaluate(`document.querySelector('.player-status').innerText`);
  assert.match(status,/動力不可用/);assert.match(status,/定位失效/);assert.match(status,/有效按鍵/);
  await capture('repair-disabled-input');
  await click('重設練習');await click('開始練習');
  await key('ArrowUp');await delay(300);await evaluate(`window.dispatchEvent(new Event('blur'))`);
  await key('ArrowUp','keyDown',true);await delay(200);
  let r=await read();assert.equal(r.driving.throttle,0);assert.equal(r.driving.input.up,false);assert.match(r.driving.lastInputEvent,/放開後重按/);
  await key('ArrowUp','keyUp');await key('ArrowUp');await delay(300);
  r=await read();assert.ok(r.driving.throttle>0);assert.equal(r.driving.input.up,true);await key('ArrowUp','keyUp');
  await capture('repair-input-recovered');
  console.log('repair: disabled controls, status, blur/repeat and release/repress passed');
  // Real contact initially lies behind the eligible region, then moves into
  // it within the same episode. The solver and evaluator decide every result.
  const fixtures=[{z:4.5,vx:-7}];
  let promoted=false;
  for(const f of fixtures) {
    await click('重設練習');
    await evaluate(`(() => {const {bodies:b}=window.__pitInspect();b[0].setTranslation({x:2.05,y:-.31,z:${f.z}},true);b[0].setLinvel({x:${f.vx},y:0,z:-16},true);b[1].setTranslation({x:0,y:-.31,z:0},true);b[1].setLinvel({x:0,y:0,z:-12},true);})()`);
    await click('開始練習');await key('ArrowLeft');await key('ArrowUp');await delay(1600);await key('ArrowLeft','keyUp');await key('ArrowUp','keyUp');
    const s=await read(),events=s.diagnostics.events;
    const upgraded=events.find(e=>e.evidence?.status==='evaluating'&&events.some(first=>first.attempt===e.attempt&&first.evidence?.classification==='scrape'&&first.at<=e.at));
    console.log('repair: physical continuous contact',JSON.stringify({fixture:f,upgraded:!!upgraded,success:!!s.diagnostics.lastSuccess,events:events.map(e=>({id:e.attempt,at:e.at,status:e.evidence?.status,classification:e.evidence?.classification,message:e.message,contact:e.evidence?.contact}))}));
    if(upgraded){promoted=true;assert.ok(upgraded.at-events.filter(e=>e.attempt===upgraded.attempt).at(-1).at<=.5+1e-6);assert.equal(s.diagnostics.lastSuccess?.id,upgraded.attempt);await capture('repair-continuous-contact');break;}
  }
  assert.ok(promoted,'Actual continuous contact did not improve within the original observation window');
  await click('重設練習');
  await evaluate(`document.querySelectorAll('.diagnostic-toggles input').forEach(i=>{if(i.checked)i.click()})`);
}
