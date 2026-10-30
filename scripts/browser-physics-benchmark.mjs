// Repeatable browser benchmark. No victory/physics flags are injected.
// Default: three fresh 60-second missions, same seed and no player input.
// Solver timing and complete fixed-step timing are reported separately.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const url=process.env.PIT_TEST_URL??'https://ianhung221.github.io/PIT/';
const label=process.env.PIT_BENCH_LABEL??`benchmark-${Date.now()}`;
const seconds=Number(process.env.PIT_BENCH_SECONDS??60),runs=Number(process.env.PIT_BENCH_RUNS??3);
const seed='V3-PHYSICS-BENCH',quality=process.env.PIT_TEST_QUALITY??'high';
const port=9600+Math.floor(Math.random()*300);
const browser=spawn(process.env.EDGE_PATH??'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,
  `--user-data-dir=${join(tmpdir(),'pit-physics-benchmark-'+Date.now())}`,url,
],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let socket,id=0;const pending=new Map(),errors=[];
async function command(method,params={}) {
  const key=++id;socket.send(JSON.stringify({id:key,method,params}));
  return new Promise((resolve,reject)=>pending.set(key,{resolve,reject}));
}
async function evaluate(expression) {
  const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression) {
  for(let i=0;i<90;i++){if(await evaluate(expression))return;await delay(500);}
  throw Error('Timed out: '+expression);
}
const aggregate=values=>{
  const sorted=[...values].sort((a,b)=>a-b),at=q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))]??null;
  return {samples:values.length,median:at(.5),p95:at(.95),max:at(1),mean:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length)};
};
try {
  let page;
  for(let i=0;i<100;i++) {
    try {page=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(p=>p.type==='page'&&p.url.startsWith(url));if(page)break;}catch {/* DevTools may still be starting. */}
    await delay(250);
  }
  if(!page)throw Error('Edge DevTools unavailable');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',e=>{
    const m=JSON.parse(e.data);
    if(m.id){const r=pending.get(m.id);pending.delete(m.id);if(m.error)r?.reject(Error(m.error.message));else r?.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method==='Network.loadingFailed'&&!m.params.canceled)errors.push(m.params.errorText);
  });
  await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__pitRoots=new Set();window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberRoot:(_,r)=>window.__pitRoots.add(r),onCommitFiberUnmount:()=>{}};`});
  await command('Page.reload',{ignoreCache:true});
  const records=[];
  for(let round=0;round<runs;round++) {
    await waitFor(`!!document.querySelector('.deploy-button')`);await delay(500);
    await evaluate(`(() => {
      const buttons=[...document.querySelectorAll('button')];
      buttons.find(b=>b.textContent.includes('州際高速')).click();
      buttons.find(b=>b.textContent==='白天').click();
      buttons.find(b=>b.textContent.includes('巡邏轎車')).click();
      [...document.querySelectorAll('.quality-field button')].find(b=>b.textContent===${JSON.stringify({low:'低',medium:'中',high:'高'}[quality])}).click();
      const select=document.querySelector('select[aria-label="選擇天候"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'clear');select.dispatchEvent(new Event('change',{bubbles:true}));
      const input=document.querySelector('.seed-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(seed)});input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await delay(300);await evaluate(`document.querySelector('.deploy-button').click()`);
    await waitFor(`!!document.querySelector('.hud-camera')`);await delay(3000);
    const installed=await evaluate(`(() => {
      let context=null,runtime=null;const visited=new Set();
      function walk(f){if(!f||visited.has(f))return;visited.add(f);
        if(f.memoizedProps?.runtime?.current?.road)runtime=f.memoizedProps.runtime.current;
        const value=f.memoizedProps?.value;
        if(value?.world?.step&&value?.beforeStepCallbacks&&value?.afterStepCallbacks)context=value;
        walk(f.child);walk(f.sibling);
      }for(const root of window.__pitRoots)walk(root.current);
      if(!context||!runtime)throw Error('Could not find actual Rapier physics context');
      const world=context.world,original=world.step;
      const b=window.__pitBenchmark={solver:[],fixed:[],frames:[],resources:[],start:performance.now(),elapsedStart:runtime.elapsed,active:true,context,runtime,world,previousFrame:null};
      const before={current:()=>{b.stepStart=performance.now();}};
      const after={current:()=>{if(b.active)b.fixed.push(performance.now()-b.stepStart);}};
      const originals=[...context.beforeStepCallbacks];context.beforeStepCallbacks.clear();context.beforeStepCallbacks.add(before);originals.forEach(x=>context.beforeStepCallbacks.add(x));context.afterStepCallbacks.add(after);
      world.step=function(...args){const t=performance.now();const result=original.apply(this,args);if(b.active)b.solver.push(performance.now()-t);return result;};
      b.stop=()=>{b.active=false;context.beforeStepCallbacks.delete(before);context.afterStepCallbacks.delete(after);world.step=original;};
      const frame=t=>{if(!b.active)return;if(b.previousFrame!==null)b.frames.push(t-b.previousFrame);b.previousFrame=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
      return {rapier:context.rapier.version(),seed:runtime.road.seed,code:runtime.road.code,bodyCount:world.bodies.len(),colliderCount:world.colliders.len(),controllers:world.vehicleControllers.size};
    })()`);
    if(installed.seed!==seed)throw Error('Fixed seed did not apply: '+JSON.stringify(installed));
    console.log('benchmark start',round+1,installed);
    const started=Date.now();
    while(Date.now()-started<seconds*1000) {
      await delay(1000);
      const status=await evaluate(`(() => {const b=window.__pitBenchmark,r=b.runtime,w=b.world;const x={at:(performance.now()-b.start)/1000,elapsed:r.elapsed,result:r.result,bodies:w.bodies.len(),colliders:w.colliders.len(),controllers:w.vehicleControllers.size};b.resources.push(x);return x;})()`);
      if(status.result!=='playing')throw Error('Mission ended during timed sample: '+JSON.stringify(status));
      if(Math.floor((Date.now()-started)/1000)%30===0)console.log('benchmark progress',round+1,status);
    }
    const data=await evaluate(`(() => {const b=window.__pitBenchmark;b.stop();return {solver:b.solver,fixed:b.fixed,frames:b.frames,resources:b.resources,elapsedStart:b.elapsedStart,elapsedEnd:b.runtime.elapsed,wallSeconds:(performance.now()-b.start)/1000};})()`);
    records.push({...data,...installed,round:round+1});
    console.log('benchmark result',round+1,{solver:aggregate(data.solver),fixed:aggregate(data.fixed),frames:aggregate(data.frames),elapsed:data.elapsedEnd-data.elapsedStart});
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'p'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'p'});await delay(200);
    await evaluate(`([...document.querySelectorAll('.debrief-actions button')].find(b=>b.textContent==='返回設定')).click()`);await delay(300);
  }
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  const result={label,url,recordedAt:new Date().toISOString(),seed,quality,viewport:[1280,800],scenario:'Three fresh fixed-seed missions; highway/day/clear/patrol; no player input; no state/timer/victory changes; startup excluded; stock AI and all four cars active.',limitations:'Edge headless --disable-gpu. rAF intervals are presented frame intervals, not isolated GPU render duration. Fixed-step includes before callbacks, solver and after callbacks; solver measures actual world.step only. Independent timer instrumentation adds small overhead equally to baseline/new runs.',totals:{solver:aggregate(records.flatMap(r=>r.solver)),fixed:aggregate(records.flatMap(r=>r.fixed)),frames:aggregate(records.flatMap(r=>r.frames)),wallSeconds:records.reduce((n,r)=>n+r.wallSeconds,0),simulationSeconds:records.reduce((n,r)=>n+r.elapsedEnd-r.elapsedStart,0)},records};
  await mkdir('work/physics-benchmark',{recursive:true});
  const path=join('work/physics-benchmark',label.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json');await writeFile(path,JSON.stringify(result,null,2));
  console.log('benchmark saved',path,result.totals);
} finally {if(socket?.readyState===WebSocket.OPEN)socket.close();browser.kill();}
