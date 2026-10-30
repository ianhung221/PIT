// Isolated 2A gate: the same production core and fixtures in Node and Edge.
// This page does not alter the game modes or inject outcomes into a mission.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root=resolve(import.meta.dirname,'..'),output=join(root,'work','vehicle-core');
const modules=new Map(),manifest=[];
const compiledPath=path=>path.replace(/\.ts$/,'.js');
const imports=/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g;
async function compile(file) {
  const full=resolve(root,file);
  if(!full.startsWith(root+sep))throw Error('Module outside workspace: '+file);
  const route='/'+compiledPath(relative(root,full).split(sep).join('/'));
  if(modules.has(route))return;
  const original=await readFile(full,'utf8');
  let source=file.endsWith('.ts')?stripTypeScriptTypes(original,{mode:'strip'}):original;
  const dependencies=[...source.matchAll(imports)].map(m=>m[1]);
  source=source.replace(imports,(match,spec)=>spec.endsWith('.ts')?match.replace(spec,compiledPath(spec)):match);
  modules.set(route,source);
  manifest.push({file:relative(root,full).split(sep).join('/'),sha256:createHash('sha256').update(original).digest('hex')});
  const destination=join(output,route.slice(1));await mkdir(dirname(destination),{recursive:true});await writeFile(destination,source);
  for(const spec of dependencies) {
    if(spec.startsWith('.'))await compile(relative(root,resolve(dirname(full),spec)));
    else if(spec!=='@dimforge/rapier3d-compat')throw Error('Unexpected external module: '+spec);
  }
}

// Kept self-contained so exactly this function executes in both runtimes.
async function runCoreFixtures({RAPIER,physicalWorld,stepVehiclePhysics,physicsSnapshot}) {
  await RAPIER.init();
  const check=(condition,message,detail)=>{if(!condition)throw Error(message+': '+JSON.stringify(detail));};
  const neutral={throttle:0,brake:0,steer:0,gear:1};
  const results=[];
  const sample=vehicle=>{
    const s=physicsSnapshot(vehicle);
    return {x:s.x,y:s.pose.y,z:s.z,yaw:s.yaw,speed:s.speed,lateralSpeed:s.lateralSpeed,upDot:s.pose.upDot,
      grounded:s.pose.groundedWheels,angular:s.pose.angularSpeed,headingValid:s.pose.headingValid};
  };
  const finite=s=>Object.values(s).filter(x=>typeof x==='number').every(Number.isFinite);
  const advance=(f,v,steps,input=neutral)=>{for(let i=0;i<steps;i++){stepVehiclePhysics(v,input);f.world.step();}};
  const counts=f=>({bodies:f.world.bodies.len(),colliders:f.world.colliders.len(),controllers:f.world.vehicleControllers.size});
  for(const kind of ['patrol','interceptor','suv','suspect']) {
    const idle=physicalWorld(kind),v=idle.vehicle;
    try {
      const initial=sample(v);advance(idle,v,360);const samples=[];
      for(let i=0;i<4;i++){advance(idle,v,60);samples.push(sample(v));}
      const end=samples.at(-1),range=Math.max(...samples.map(s=>s.y))-Math.min(...samples.map(s=>s.y));
      check(samples.every(finite)&&Math.abs(end.y-initial.y)<.08&&range<.015&&Math.hypot(end.x,end.z)<.1&&Math.abs(end.speed)<.05&&end.angular<.05&&end.upDot>.99&&end.grounded===4,'Stationary suspension/pose', {kind,initial,end,range});
      results.push({kind,scenario:'stationary-10s',pass:true,initial,end,heightRange:range,counts:counts(idle)});
    } finally {idle.dispose();}
    for(const scenario of ['forward','reverse','left','right']) {
      const f=physicalWorld(kind),vehicle=f.vehicle;
      try {
        advance(f,vehicle,120);
        const initial=sample(vehicle),gear=scenario==='reverse'?-1:1;
        if(scenario==='left'||scenario==='right') {
          advance(f,vehicle,30,{...neutral,throttle:.25});
          advance(f,vehicle,90,{...neutral,throttle:.25,steer:scenario==='right'?.4:-.4});
        } else advance(f,vehicle,120,{...neutral,gear,throttle:.45});
        const end=sample(vehicle),turn=scenario==='left'?-1:1;
        check(finite(end)&&end.upDot>.95&&end.headingValid&&end.grounded>=3,'Finite grounded drive',{kind,scenario,end});
        if(scenario==='forward'||scenario==='reverse')check(end.speed*gear>1&&(end.z-initial.z)*gear<-2,'Signed travel direction',{kind,scenario,initial,end});
        else check((end.x-initial.x)*turn>.1&&end.yaw*turn<-.04&&end.speed>1,'Steering direction',{kind,scenario,initial,end});
        results.push({kind,scenario,pass:true,initial,end});
      } finally {f.dispose();}
    }
  }
  const f=physicalWorld('patrol'),rebuilds=[];let active=f.vehicle;
  try {
    for(let i=0;i<20;i++) {
      f.remove(active);const empty=counts(f);
      check(empty.bodies===0&&empty.colliders===1&&empty.controllers===0,'Rebuild cleanup',{i,empty});
      const kind=['patrol','interceptor','suv','suspect'][i%4];active=f.add(kind);advance(f,active,120);
      const full=counts(f),end=sample(active);
      check(full.bodies===1&&full.colliders===5&&full.controllers===1&&finite(end)&&end.grounded===4&&end.upDot>.99,'Rebuild recreation',{i,kind,full,end});
      rebuilds.push({iteration:i+1,kind,empty,full,end});
    }
  } finally {f.dispose();}
  return {version:RAPIER.version(),results,rebuilds};
}

let browser,socket,server;let id=0;const pending=new Map(),errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function command(method,params={}) {
  const key=++id;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},45000);
    pending.set(key,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});
    socket.send(JSON.stringify({id:key,method,params}));
  });
}
async function evaluate(expression) {
  const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
  return r.result.value;
}
try {
  await compile('tests/helpers/vehicle-world.mjs');
  const rapierPath=join(root,'node_modules','@dimforge','rapier3d-compat','rapier.mjs');
  const rapierSource=await readFile(rapierPath,'utf8');modules.set('/vendor/rapier.mjs',rapierSource);
  const packageVersion=JSON.parse(await readFile(join(dirname(rapierPath),'package.json'),'utf8')).version;
  if(packageVersion!=='0.19.2')throw Error('Expected pinned Rapier 0.19.2, received '+packageVersion);
  manifest.push({file:'node_modules/@dimforge/rapier3d-compat/rapier.mjs',sha256:createHash('sha256').update(rapierSource).digest('hex')});
  const nodeResult=await runCoreFixtures(await import(pathToFileURL(join(output,'tests','helpers','vehicle-world.mjs')).href));
  console.log('Node core passed',nodeResult.version,nodeResult.results.length,'drive cases; 20 rebuilds');
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>PIT 2A vehicle core verification</title><link rel="icon" href="data:,"><script type="importmap">'+JSON.stringify({imports:{'@dimforge/rapier3d-compat':'/vendor/rapier.mjs'}})+'</script><body>Isolated production vehicle core verification.</body></html>';
  server=createServer((request,response)=>{
    const path=new URL(request.url,'http://127.0.0.1').pathname;
    if(path==='/'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);}
    else if(modules.has(path)){response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});response.end(modules.get(path));}
    else {response.writeHead(404);response.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4175,'127.0.0.1',resolve);});
  const port=9800+Math.floor(Math.random()*150),url='http://127.0.0.1:4175/';
  browser=spawn(process.env.EDGE_PATH??'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
    '--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,
    `--user-data-dir=${join(tmpdir(),'pit-vehicle-core-'+Date.now())}`,url,
  ],{stdio:'ignore',windowsHide:true});
  let launchError;browser.on('error',e=>{launchError=e;});
  let page;
  for(let i=0;i<100;i++) {
    if(launchError)throw launchError;
    try {page=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(p=>p.type==='page'&&p.url.startsWith(url));if(page)break;}catch {/* DevTools may still be starting. */}
    await delay(250);
  }
  if(!page)throw Error('Edge DevTools unavailable');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',e=>{
    const m=JSON.parse(e.data);
    if(m.id){const request=pending.get(m.id);pending.delete(m.id);if(m.error)request?.reject(Error(m.error.message));else request?.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method==='Network.loadingFailed'&&!m.params.canceled)errors.push(m.params.errorText);
  });
  await command('Runtime.enable');await command('Network.enable');
  let ready=false;
  for(let i=0;i<100;i++) {
    ready=await evaluate(`location.origin===${JSON.stringify(url.slice(0,-1))}&&document.readyState==='complete'&&!!document.querySelector('script[type="importmap"]')`);
    if(ready)break;await delay(50);
  }
  if(!ready)throw Error('Isolated page did not load its import map');
  const browserResult=await evaluate(`(async()=>(${runCoreFixtures.toString()})(await import('/tests/helpers/vehicle-world.mjs')))()`);
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  if(browserResult.version!==nodeResult.version)throw Error('Node/browser Rapier version mismatch');
  let maxDelta=0;
  for(let i=0;i<nodeResult.results.length;i++)for(const key of ['x','y','z','yaw','speed','lateralSpeed','upDot','angular']) {
    maxDelta=Math.max(maxDelta,Math.abs(nodeResult.results[i].end[key]-browserResult.results[i].end[key]));
  }
  if(maxDelta>1e-5)throw Error('Node/browser result mismatch: '+maxDelta);
  const report={recordedAt:new Date().toISOString(),pass:true,limitations:'Isolated production physics core. Does not validate React scene wiring, appearance or user controls.',manifest,node:nodeResult,browser:browserResult,maxNodeBrowserDelta:maxDelta};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log('Edge core passed',browserResult.version,browserResult.results.length,'drive cases; 20 rebuilds; max delta',maxDelta);
  console.log('Report: work/vehicle-core/report.json');
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await Promise.race([command('Browser.close'),delay(1500)]);}catch {/* DevTools may still be starting. */}socket.close();}
  for(const request of pending.values())request.reject(Error('Verification finished'));pending.clear();
  browser?.kill();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
