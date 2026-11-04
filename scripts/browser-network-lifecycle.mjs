import assert from 'node:assert/strict';
export async function verifyNetworkLifecycle({evaluate,delay,capture,waitFor}){
 await evaluate(`window.__networkWorldRecords=[];window.__networkResources=()=>{let w;const seen=new Set();function walk(f){if(!f||seen.has(f))return;seen.add(f);if(f.memoizedProps?.value?.world?.vehicleControllers)w=f.memoizedProps.value.world;walk(f.child);walk(f.sibling);}for(const root of window.__pitRoots)walk(root.current);if(!w)return null;let record=window.__networkWorldRecords.find(r=>r.world===w);if(!record){record={world:w,freed:false,controllersAtFree:null};window.__networkWorldRecords.push(record);const free=w.free;w.free=function(...args){record.freed=true;record.controllersAtFree=w.vehicleControllers.size;return free.apply(this,args);};}return {index:window.__networkWorldRecords.indexOf(record),bodies:w.bodies.len(),colliders:w.colliders.len(),controllers:w.vehicleControllers.size,code:window.__pitInspect().runtime.road.code};};`);
 const read=()=>evaluate('window.__networkResources()');
 const click=label=>evaluate(`([...document.querySelectorAll('button')].find(b=>(b.textContent+' '+b.getAttribute('aria-label')).includes(${JSON.stringify(label)}))).click()`);
 const original=await read();assert.equal(original.controllers,4);assert.ok(original.code.startsWith('NET1:'));
 for(let cycle=0;cycle<4;cycle++){
  const prior=await read();await click('無線電指令');await delay(100);await click('終止追逐');await delay(250);
  const ended=await evaluate('window.__pitInspect().runtime.elapsed');await delay(250);assert.equal(await evaluate('window.__pitInspect().runtime.elapsed'),ended);
  await click('相同');
  await waitFor(`(()=>{const r=window.__networkResources();return r&&r.index>${prior.index}&&r.controllers===4;})()`,'new-network-world');
  const next=await read(),disposed=await evaluate(`(()=>{const r=window.__networkWorldRecords[${prior.index}];return {freed:r.freed,controllersAtFree:r.controllersAtFree};})()`);
  assert.equal(disposed.freed,true);assert.equal(disposed.controllersAtFree,0);assert.equal(next.code,original.code);assert.equal(next.colliders,original.colliders);assert.equal(next.bodies,original.bodies);
 }
 await capture('network-four-retries');
 await click('暫停');await delay(150);await click('返回設定');await delay(250);
 await click('路線輔助關');await click('部署攔截單位');await waitFor('!!document.querySelector(".network-minimap svg")','navigation-off');await delay(500);
 assert.equal(await evaluate('!!document.querySelector(".navigation-turn")'),false);
 assert.equal(await evaluate('document.querySelectorAll(".network-minimap polyline").length'),0);
 await capture('network-navigation-off');
 console.log('network lifecycle passed: four retries release every controller/world; same map and collider counts; navigation off hides route');
}
