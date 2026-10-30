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
  ordered.forEach((b,i)=>{const x=[2.05,0,-5,5][i],z=[-20.1,-24,15,22][i];b.setTranslation({x,y:-.325,z},true);b.setRotation({x:0,y:0,z:0,w:1},true);b.setLinvel({x:i===0?-7:0,y:0,z:i===0?-16:i===1?-12:0},true);b.setAngvel({x:0,y:0,z:0},true);});
 })()`);
 await tap('p');
 try {await waitFor(`!!window.__pitInspect().runtime.diagnostics.lastSuccess`,'mission-physical-pit');}
 catch(error){console.log('mission PIT evidence',await evaluate(`window.__pitInspect().runtime.diagnostics`));throw error;}
 const state=await evaluate(`(() => {const r=window.__pitInspect().runtime;return {diagnostic:r.diagnostics.lastSuccess,pitQualified:r.pitQualified,result:r.result,authorization:r.authorization,pose:r.suspect.pose};})()`);
 assert.equal(state.pitQualified,true);assert.equal(state.diagnostic.sample.success,true);assert.equal(state.diagnostic.contact.surfaceValid,true);assert.equal(state.diagnostic.contact.authorized,true);
 await capture('shared-core-mission-pit');
 console.log('shared-core mission PIT: actual authorized contact and original criteria passed',state);
}
