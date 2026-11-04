import assert from 'node:assert/strict';
/** Initial positions/velocities only; authorization is requested through Q1. */
export async function verifyVehiclePit({evaluate,command,delay,capture,waitFor}) {
 const tap=async key=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key});await command('Input.dispatchKeyEvent',{type:'keyUp',key});};
 await evaluate(`document.querySelector('.radio-trigger').click()`);
 await evaluate(`document.querySelectorAll('.radio-wheel>button')[0].click()`);
 await delay(250);await tap('p');
 await evaluate(`(() => {
  const {runtime:r,bodies}=window.__pitInspect(),cars=[r.player,r.suspect,...r.supports],available=[...bodies];
  const ordered=cars.map(c=>{available.sort((a,b)=>Math.hypot(a.translation().x-c.x,a.translation().z-c.z)-Math.hypot(b.translation().x-c.x,b.translation().z-c.z));return available.shift();});
  let yaw=0,origin={x:0,z:0};
  if(r.road.network){const n=r.road.network,e=n.edges.find(e=>e.id===n.spawn.edge),a=n.nodes.find(a=>a.id===n.spawn.from),b=n.nodes.find(b=>b.id===(e.a===a.id?e.b:e.a)),dx=(b.x-a.x)/e.length,dz=(b.z-a.z)/e.length;yaw=Math.atan2(-dx,-dz);origin={x:a.x+dx*250-dz*2.7,z:a.z+dz*250+dx*2.7};}
  const rotate=(x,z)=>({x:Math.cos(yaw)*x+Math.sin(yaw)*z,z:-Math.sin(yaw)*x+Math.cos(yaw)*z});
  ordered.forEach((b,i)=>{const p=rotate([2.05,0,-5,5][i],[-20.1,-24,15,22][i]),v=rotate(i===0?-7:0,i===0?-16:i===1?-12:0);b.setTranslation({x:origin.x+p.x,y:-.325,z:origin.z+p.z},true);b.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);b.setLinvel({...v,y:0},true);b.setAngvel({x:0,y:0,z:0},true);});
 })()`);
 await tap('p');
 try {await waitFor(`!!window.__pitInspect().runtime.diagnostics.lastSuccess`,'mission-physical-pit');}
 catch(error){console.log('mission PIT evidence',await evaluate(`window.__pitInspect().runtime.diagnostics`));throw error;}
 const state=await evaluate(`(() => {const r=window.__pitInspect().runtime;return {diagnostic:r.diagnostics.lastSuccess,pitQualified:r.pitQualified,result:r.result,authorization:r.authorization,pose:r.suspect.pose};})()`);
 assert.equal(state.pitQualified,true);assert.equal(state.diagnostic.sample.success,true);assert.equal(state.diagnostic.contact.surfaceValid,true);assert.equal(state.diagnostic.contact.authorized,true);
 await capture('shared-core-mission-pit');
 console.log('shared-core mission PIT: actual authorized contact and original criteria passed',state);
}
