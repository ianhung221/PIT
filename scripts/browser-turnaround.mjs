import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

/** Only starting poses/velocities are arranged; Q5 and all later driving are real. */
export async function verifyBrowserTurnaround({evaluate,command,delay,capture}){
 const samples=[];
 const read=async label=>{const r=await evaluate(`(()=>{const r=window.__pitInspect().runtime,d=r.networkDrivers[1];return {elapsed:r.elapsed,result:r.result,player:r.player,suspect:r.suspect,support:r.supports[0],formation:r.networkSupport,turn:d.turnaround,notice:d.turnaroundReason,blocked:d.blocked};})()`);samples.push({label,...r});return r;};
 const tap=async key=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key});await command('Input.dispatchKeyEvent',{type:'keyUp',key});};
 try{
  await evaluate(`document.querySelector('.radio-trigger').click()`);await delay(100);
  await evaluate(`document.querySelectorAll('.radio-wheel>button')[4].click()`);await delay(200);await tap('p');
  await evaluate(`(()=>{
   const {runtime:r,bodies}=window.__pitInspect(),n=r.road.network,edge=n.edges.find(e=>e.biome==='highway'&&e.length>350);if(!edge)throw Error('No suitable highway edge');
   const a=n.nodes.find(x=>x.id===edge.a),b=n.nodes.find(x=>x.id===edge.b),dx=(b.x-a.x)/edge.length,dz=(b.z-a.z)/edge.length,yaw=Math.atan2(-dx,-dz);
   const cars=[r.player,r.suspect,...r.supports],available=[...bodies],ordered=cars.map(c=>{available.sort((x,y)=>Math.hypot(x.translation().x-c.x,x.translation().z-c.z)-Math.hypot(y.translation().x-c.x,y.translation().z-c.z));return available.shift();});
   for(let i=0;i<ordered.length;i++){const dist=[80,140,180,60][i],side=i===1?-2.7:2.7,angle=i===1?yaw+Math.PI:yaw,speed=i===1?5:0;
    ordered[i].setTranslation({x:a.x+dx*dist-dz*side,y:-.315,z:a.z+dz*dist+dx*side},true);
    ordered[i].setRotation({x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},true);
    ordered[i].setLinvel({x:-Math.sin(angle)*speed,y:0,z:-Math.cos(angle)*speed},true);ordered[i].setAngvel({x:0,y:0,z:0},true);
   }
  })()`);
  await tap('p');let started=false,complete=false;
  for(let i=0;i<45;i++){
   await delay(1000);const s=await read(`second-${i+1}`);started||=!!s.turn;
   if(s.notice==='已完成迴轉，重新追蹤'){complete=true;break;}
   if(s.result!=='playing')break;
  }
  assert.equal(started,true,'No actual turnaround began');assert.equal(complete,true,'The backup did not complete the turnaround');
  const completed=await read('turn-completed'),begin=samples.find(s=>s.turn)?.turn.start;let resumed=false;
  for(let i=0;i<12;i++){
   await delay(1000);const s=await read(`after-turn-${i+1}`),dx=s.support.x-completed.support.x,dz=s.support.z-completed.support.z;
   const along=dx*Math.sin(begin.yaw)+dz*Math.cos(begin.yaw);
   if(along>4&&s.support.speed>3){resumed=true;break;}
  }
  await capture('network-turnaround');assert.equal(resumed,true,'Turn completed but backup did not resume in the opposite direction');
  console.log('browser actual wheel-driven turnaround passed');
 }finally{
  await mkdir('work/network-turnaround',{recursive:true});const path=`work/network-turnaround/${Date.now()}.json`;
  await writeFile(path,JSON.stringify({fixture:'Q5 via UI; arranged initial poses/velocities on a wide road; no subsequent state changes.',samples},null,2),{flag:'wx'});console.log('turnaround evidence',path);
 }
}
