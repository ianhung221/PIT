import assert from 'node:assert/strict';
export async function verifyVehicleRollover({evaluate,command,delay,capture,waitFor,practice=false}) {
 const tap=async key=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key});await command('Input.dispatchKeyEvent',{type:'keyUp',key});};
 await evaluate(`(() => {
  let physics=null,render=null;const seen=new Set();function walk(f){if(!f||seen.has(f))return;seen.add(f);
   const value=f.memoizedProps?.value;if(value?.world?.step&&value?.rapier)physics=value;
   if(value?.getState){const state=value.getState();if(state.camera&&state.scene)render=state;}
   walk(f.child);walk(f.sibling);
  }for(const root of window.__pitRoots)walk(root.current);
  if(!physics||!render)throw Error('Cannot locate actual physics/render providers');
  window.__pitRoll={physics,render};
 })()`);
 if(practice)await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='開始練習').click()`);
 await delay(300);
 await tap('p');
 await evaluate(`(() => {
  const {runtime:r,bodies}=window.__pitInspect(),{physics}=window.__pitRoll;
  const available=[...bodies],cars=[r.player,r.suspect,...(r.supports??[])];
  const ordered=cars.map(car=>{available.sort((a,b)=>Math.hypot(a.translation().x-car.x,a.translation().z-car.z)-Math.hypot(b.translation().x-car.x,b.translation().z-car.z));return available.shift();});
  const ground=${practice?-.49:-.6},height=.4;
  physics.world.createCollider(physics.rapier.ColliderDesc.cuboid(.2,height/2,10).setTranslation(103,ground+height/2,0).setFriction(1).setCollisionGroups((4<<16)|0xffff));
  ordered.forEach((body,i)=>{body.setTranslation({x:100+i*40,y:ground+.18,z:0},true);body.setRotation({x:0,y:0,z:0,w:1},true);body.setLinvel({x:0,y:0,z:0},true);body.setAngvel({x:0,y:0,z:0},true);});
  window.__pitRoll.player=ordered[0];
 })()`);
 await tap('p');
 await delay(2000);
 await evaluate(`(() => {const t=window.__pitRoll;t.player.setLinvel({x:35,y:0,z:0},true);t.maxTilt=0;const r=window.__pitInspect().runtime;t.physics.afterStepCallbacks.add({current:()=>{t.maxTilt=Math.max(t.maxTilt,r.player.pose?.tilt??0);}});})()`);
 try {await waitFor(`window.__pitInspect().runtime.driving.physics?.rolloverDisabled===true`,'actual-player-rollover');}
 catch(error){console.log('rollover failure evidence',await evaluate(`({maxTilt:window.__pitRoll.maxTilt,position:window.__pitRoll.player.translation(),runtime:window.__pitInspect().runtime.player})`));throw error;}
 const overturned=await evaluate(`(() => {const r=window.__pitInspect().runtime;return {pose:r.player.pose,status:r.driving.vehicleStatus,result:r.result??r.phase};})()`);
 assert.ok(overturned.pose.tilt>70*Math.PI/180);assert.equal(overturned.status.driveable,false);assert.ok(overturned.status.reason.includes('翻覆'));
 assert.equal(overturned.result,practice?'playing':'playing','rollover alone must not finish a mission or practice');
 await capture('rollover-status');
 // Keep the actual settled chassis visible: a pause overlay would hide camera defects.
 const checkCamera=async()=>evaluate(`(() => {const c=window.__pitRoll.render.camera;return {position:{x:c.position.x,y:c.position.y,z:c.position.z},up:{x:c.up.x,y:c.up.y,z:c.up.z},quaternion:{x:c.quaternion.x,y:c.quaternion.y,z:c.quaternion.z,w:c.quaternion.w}};})()`);
 if(!practice){
  await tap('c');await delay(300);
  const driver=await checkCamera();assert.ok(driver.up.y<.35,'driver view must follow the overturned vehicle');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'r'});await delay(200);await capture('rollover-driver-rear');await command('Input.dispatchKeyEvent',{type:'keyUp',key:'r'});
  for(const [width,height] of [[1280,800],[375,667],[320,420]]){
   await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await delay(250);await capture(`rollover-driver-${width}`);
   assert.ok(Object.values((await checkCamera()).position).every(Number.isFinite));
  }
  await tap('c');await delay(400);assert.equal((await checkCamera()).up.y,1);await capture('rollover-helicopter');
  await tap('c');await delay(400);assert.equal((await checkCamera()).up.y,1);await capture('rollover-chase');
 }else{assert.equal((await checkCamera()).up.y,1);await capture('rollover-practice');}
 console.log('rollover: actual curb impact, stable disable, no automatic success and camera views passed',overturned);
}
