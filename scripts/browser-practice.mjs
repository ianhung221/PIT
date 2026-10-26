import assert from 'node:assert/strict';
export async function verifyPractice({evaluate,command,delay,capture,waitFor}) {
  const state=()=>evaluate(`window.__pitInspect().runtime`);
  const click=async label=>{await evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.click();})()`);await delay(200);};
  const key=async(k,type='keyDown')=>command('Input.dispatchKeyEvent',{type,key:k,code:k.length===1?'Key'+k.toUpperCase():k});
  const tap=async k=>{await key(k);await key(k,'keyUp');await delay(150);};
  const shape=await evaluate(`(() => {const s=window.__pitInspect();return {bodies:s.bodies.length,colliders:s.bodies.reduce((n,b)=>n+b.numColliders(),0),road:!!s.runtime.road,supports:!!s.runtime.supports}})()`);
  assert.deepEqual(shape,{bodies:2,colliders:6,road:false,supports:false});
  assert.equal((await state()).elapsed,0);assert.equal((await state()).phase,'ready');
  await capture('practice-ready');
  await click('開始練習');await delay(700);
  assert.ok((await state()).elapsed>0);
  await tap('f');assert.equal((await state()).driving.cruise,true);
  await key('ArrowUp');await delay(300);assert.equal((await state()).driving.cruise,false);await key('ArrowUp','keyUp');
  await evaluate(`window.dispatchEvent(new Event('blur'))`);await delay(200);assert.equal((await state()).driving.throttle,0);
  await tap('p');const frozen=(await state()).elapsed;await delay(300);assert.equal((await state()).elapsed,frozen);
  await click('繼續練習');
  await click('重設練習');await waitFor(`window.__pitInspect().runtime.phase==='ready'`,'practice-reset');
  assert.equal((await state()).elapsed,0);assert.equal((await state()).diagnostics.lastSuccess,null);assert.equal((await state()).driving.cruise,false);
  // Only arrange initial physical positions and velocities; never insert a
  // candidate, success, diagnosis or result. Production solver decides.
  const place=async(center=false)=>evaluate(`(() => {
    const {bodies}=window.__pitInspect();
    bodies[0].setTranslation({x:2.05,y:.02,z:${center?0:3.9}},true);
    bodies[0].setLinvel({x:-7,y:0,z:-16},true);
    bodies[1].setTranslation({x:0,y:.02,z:0},true);
    bodies[1].setLinvel({x:0,y:0,z:-12},true);
  })()`);
  await place();await click('開始練習');
  await key('ArrowLeft');await key('ArrowUp');await delay(1500);await key('ArrowLeft','keyUp');await key('ArrowUp','keyUp');
  for(let i=0;i<25;i++){if((await state()).phase==='qualified')break;await delay(150);}
  const hit=await state();console.log('practice: physical contact',{vehicle:hit.diagnostics.config,contact:hit.diagnostics.latest?.contact,sample:hit.diagnostics.lastSuccess?.sample});
  assert.equal(hit.phase,'qualified','Actual PIT should qualify');assert.ok(hit.diagnostics.lastSuccess.sample.success);
  await capture('practice-qualified');
  const success=hit.diagnostics.lastSuccess.id;
  await click('繼續觀察');await delay(2500);
  const observed=await state();assert.equal(observed.phase,'playing');assert.equal(observed.diagnostics.lastSuccess.id,success);assert.ok(observed.elapsed>hit.elapsed+1);
  await evaluate(`document.querySelectorAll('.diagnostic-toggles input').forEach(i=>i.click())`);await delay(100);
  await capture('practice-observe');
  // New scrape uses a fresh session; an ordinary contact must not award success.
  await click('重設練習');await place(true);await click('開始練習');await delay(3100);
  const scrape=await state();assert.equal(scrape.diagnostics.lastSuccess,null);assert.equal(scrape.diagnostics.latest.classification,'scrape');
  // Verify the actual success-modal retry button, not only the HUD reset.
  await click('重設練習');await place();await click('開始練習');
  await key('ArrowLeft');await key('ArrowUp');await delay(1500);await key('ArrowLeft','keyUp');await key('ArrowUp','keyUp');
  await waitFor(`window.__pitInspect().runtime.phase==='qualified'`,'practice-second-success');
  await click('立即再練');assert.equal((await state()).phase,'ready');assert.equal((await state()).diagnostics.lastSuccess,null);
  if(process.env.PIT_TEST_PRACTICE_LONG==='true') {
    await click('重設練習');
    await evaluate(`(() => {const {bodies}=window.__pitInspect();bodies[0].setTranslation({x:2.4,y:.02,z:910},true);bodies[1].setTranslation({x:0,y:.02,z:900},true);})()`);
    await click('開始練習');await tap('f');
    for(let i=0;i<130;i++){const s=await state();assert.equal(s.phase,'playing');if(s.elapsed>91)break;await delay(1000);}
    assert.ok((await state()).elapsed>91);console.log('practice: actual simulation exceeded 91 seconds without countdown');
    await capture('practice-no-countdown');
  }
  await click('重設練習');await evaluate(`window.__pitInspect().bodies[0].setTranslation({x:1001,y:.02,z:0},true)`);await click('開始練習');
  await waitFor(`window.__pitInspect().runtime.phase==='outside'`,'practice-boundary');
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:1,mobile:false});await delay(250);
  const layout=await evaluate(`(() => {const buttons=[...document.querySelectorAll('.debrief-actions button')];return {fits:document.documentElement.scrollWidth<=innerWidth,buttons:buttons.every(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})}})()`);
  assert.ok(layout.fits&&layout.buttons,JSON.stringify(layout));await capture('practice-narrow');
  await click('重設練習');assert.equal((await state()).diagnostics.events.length,0);
  await click('返回設定');assert.ok(await evaluate(`!!document.querySelector('.deploy-button')`));
}
