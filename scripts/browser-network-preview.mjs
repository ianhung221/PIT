import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const id=Date.now(),port=9500+Math.floor(Math.random()*400),url=process.env.PIT_TEST_URL??'http://127.0.0.1:4174/PIT/?network-preview=1';
const directory=`work/network-preview-${id}`;
const child=spawn(process.env.EDGE_PATH??'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
 '--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${join(tmpdir(),`pit-network-${id}`)}`,url],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
const errors=[];
try {
 let page;
 for(let i=0;i<40;i++) {try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page'&&p.url.startsWith(url));if(page)break;}catch{/* Browser may still be starting. */}await delay(250);}
 if(!page)throw Error('Edge did not expose a page');
 socket=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let next=0;const pending=new Map();
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
 socket.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Edge connection closed before verification'));}pending.clear();});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout: ${method}`));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await command('Runtime.enable');await command('Page.enable');await command('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 if(new URL(url).searchParams.get('mission')==='1'){
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__pitRoots=new Set();window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberRoot:(_,r)=>window.__pitRoots.add(r),onCommitFiberUnmount:()=>{}};`});
  await command('Page.reload',{ignoreCache:true});
 }
 if(new URL(url).searchParams.get('setup')==='1'){
  for(let i=0;i<60;i++){if(await evaluate('!!document.querySelector(".deploy-button")&&document.body.innerText.includes("多城鎮路網")'))break;await delay(500);}
  await mkdir(directory,{recursive:true});
  const click=async text=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing button');b.click();})()`);
  const setSeed=async value=>evaluate(`(()=>{const input=document.querySelector('.seed-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await setSeed('HIGHWAY-OLD-TEST');await delay(250);
  if(!await evaluate('document.querySelector(".deploy-button").disabled'))throw Error('Legacy code was silently accepted');
  await click('以原種子建立新版地圖');await delay(200);
  if(await evaluate('document.querySelector(".seed-field input").value')!=='NET1:OLD-TEST')throw Error('Legacy conversion failed');
  await click('白天');await click('部署攔截單位');
  for(let i=0;i<60;i++){if(await evaluate('window.__pitNetworkMission?.().elapsed>1'))break;await delay(500);}
  if(!await evaluate('!!document.querySelector(".network-minimap svg")'))throw Error('Minimap missing');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp'});await delay(4000);await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp'});
  for(const [width,height,name] of [[1280,800,'wide'],[390,844,'narrow'],[844,390,'landscape']]){
   await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(500);
   const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(`${directory}/${name}.png`,Buffer.from(shot.data,'base64'),{flag:'wx'});
   if(!await evaluate('(()=>{const r=document.querySelector(".network-minimap").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'))throw Error('Minimap outside viewport');
  }
  const key=async value=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key:value});await command('Input.dispatchKeyEvent',{type:'keyUp',key:value});};
  await key('p');await delay(300);const paused=await evaluate('window.__pitNetworkMission().elapsed');await delay(700);
  if(await evaluate('window.__pitNetworkMission().elapsed')!==paused)throw Error('Paused simulation continued');
  const originalCode=await evaluate('window.__pitNetworkMission().road.code');
  await click('繼續任務');await delay(200);await click('無線電指令');await delay(200);await click('終止追逐');await delay(300);
  await click('相同');await delay(1500);
  if(await evaluate('window.__pitNetworkMission().road.code')!==originalCode)throw Error('Retry changed map');
  if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify({directory,originalCode,errors}));
 }else if(new URL(url).searchParams.get('mission')==='1'){
  const seen=new Set(),resources=[],maxSupportTravel=[0,0];let state,initialSupports;
  await mkdir(directory,{recursive:true});
  const duration=Number(process.env.PIT_NETWORK_SECONDS??105);
  for(let i=0;i<duration*3;i++){
   state=await evaluate('(()=>{const s=window.__pitNetworkMission?.();return s?{elapsed:s.elapsed,result:s.result,player:s.player,suspect:s.suspect,supports:s.supports,edge:s.networkDrivers[0].location?.edge,damage:s.suspectDamage,events:s.eventLog}:null})()');
   if(state?.edge)seen.add(state.edge);
   if(state){initialSupports??=state.supports.map(c=>({x:c.x,z:c.z}));state.supports.forEach((c,j)=>{maxSupportTravel[j]=Math.max(maxSupportTravel[j],Math.hypot(c.x-initialSupports[j].x,c.z-initialSupports[j].z));});}
   if(state&&i%15===0){
    const sample=await evaluate(`(()=>{let context;const visited=new Set();function walk(f){if(!f||visited.has(f))return;visited.add(f);const v=f.memoizedProps?.value;if(v?.world?.step&&v?.beforeStepCallbacks)context=v;walk(f.child);walk(f.sibling);}for(const root of window.__pitRoots)walk(root.current);if(!context)return null;const w=context.world;return {elapsed:window.__pitNetworkMission().elapsed,bodies:w.bodies.len(),colliders:w.colliders.len(),controllers:w.vehicleControllers.size,heap:performance.memory?.usedJSHeapSize};})()`);
    if(sample)resources.push(sample);
    if(i%60===0)console.log('mission progress',{elapsed:state.elapsed,edges:seen.size,resources:sample});
   }
   if(state?.elapsed>=duration||state&&state.result!=='playing')break;
   await delay(1000);
  }
  const shot=await command('Page.captureScreenshot',{format:'png'});await writeFile(`${directory}/mission.png`,Buffer.from(shot.data,'base64'),{flag:'wx'});
  await writeFile(`${directory}/mission.json`,JSON.stringify({state,edges:[...seen],resources,initialSupports,maxSupportTravel,errors},null,2),{flag:'wx'});
  if(!resources.length||resources.some(r=>r.controllers!==4||r.bodies!==resources[0].bodies||r.colliders!==resources[0].colliders))throw Error('Physics resource counts changed during the run');
  if(!state||state.elapsed<duration||state.result!=='playing'||seen.size<4||maxSupportTravel.some(d=>d<100)||errors.length)throw Error(JSON.stringify({directory,state,edges:[...seen],maxSupportTravel,errors}));
  console.log(JSON.stringify({directory,state,edges:[...seen],errors}));
 }else{
 for(let i=0;i<60;i++){if(await evaluate('Boolean(window.__pitNetworkPreview?.().body)'))break;await delay(500);}
 const before=await evaluate('JSON.stringify(window.__pitNetworkPreview?.().cars.player)');if(!before)throw Error(JSON.stringify({message:'Preview did not load',page:await evaluate('({url:location.href,text:document.body.innerText})'),errors}));
 await mkdir(directory,{recursive:true});
 const capture=async name=>{const r=await command('Page.captureScreenshot',{format:'png'});await writeFile(`${directory}/${name}.png`,Buffer.from(r.data,'base64'),{flag:'wx'});};
 await capture('start');
 if(new URL(url).searchParams.get('auto')==='1'){
  for(let i=0;i<180;i++){if(await evaluate('window.__pitNetworkPreview().metrics.reached'))break;await delay(500);}
  const metrics=await evaluate('window.__pitNetworkPreview().metrics');
  if(!metrics.reached||metrics.maxDeviation>4)throw Error(JSON.stringify({message:'Route failed',metrics}));
 }else{
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp'});await delay(4000);await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp'});
 }
 await capture('driven');
 const after=await evaluate('window.__pitNetworkPreview().cars.player');const first=JSON.parse(before);
 if(Math.hypot(after.x-first.x,after.z-first.z)<3)throw Error('Player did not drive');
 if(after.pose?.groundedWheels<2)throw Error('Player lost road support');
 if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({directory,before:first,after,metrics:await evaluate('window.__pitNetworkPreview().metrics'),errors}));
 }
}finally{socket?.close();child.kill();}
