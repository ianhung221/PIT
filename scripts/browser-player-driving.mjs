export async function verifyPlayerDriving({evaluate,command,delay,capture}) {
  const key=async(key,type='keyDown')=>command('Input.dispatchKeyEvent',{type,key});
  const tap=async(k)=>{await key(k);await key(k,'keyUp');};
  const read=()=>evaluate(`(() => {const r=window.__pitInspect().runtime;return {driving:r.driving,player:r.player,result:r.result,elapsed:r.elapsed}})()`);
  // Controlled initial placement only; normal player forces and real keyboard
  // input remain active. Keep AI far away to isolate stationary steering.
  await tap('p');
  await evaluate(`(() => {const r=window.__pitInspect().runtime, bs=window.__pitInspect().bodies, cars=[r.player,r.suspect,...r.supports],available=[...bs];cars.forEach((c,i)=>{available.sort((a,b)=>Math.hypot(a.translation().x-c.x,a.translation().z-c.z)-Math.hypot(b.translation().x-c.x,b.translation().z-c.z));const b=available.shift(),seg=r.road.segments[i===0?1:10+i];b.setTranslation({x:seg.x,y:.02,z:seg.z},true);b.setRotation({x:0,y:Math.sin(seg.yaw/2),z:0,w:Math.cos(seg.yaw/2)},true);b.setLinvel({x:0,y:0,z:0},true);b.setAngvel({x:0,y:0,z:0},true);Object.assign(c,{x:seg.x,z:seg.z,yaw:seg.yaw,speed:0,lateralSpeed:0});});})()`);
  await tap('p');await delay(300);
  const initial=await read();await key('ArrowRight');await delay(900);await key('ArrowRight','keyUp');
  const still=await read();if(Math.abs(still.player.yaw-initial.player.yaw)>.01)throw Error('Stationary steering rotated body');
  await key('ArrowUp');await delay(2400);await key('ArrowUp','keyUp');await delay(300);
  const accelerated=await read();if(accelerated.player.speed<3)throw Error('Progressive throttle failed');
  await tap('f');await delay(300);let cruise=await read();if(!cruise.driving.cruise)throw Error('Cruise did not enable '+JSON.stringify(cruise));
  await tap(']');await delay(300);const raised=await read();if(Math.abs(raised.driving.target-cruise.driving.target-5)>.01)throw Error('Cruise target step');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:']',autoRepeat:true});await key(']','keyUp');await delay(100);
  if((await read()).driving.target!==raised.driving.target)throw Error('Repeated key changed target');
  await capture('player-cruise');
  await key('ArrowDown');await delay(200);await key('ArrowDown','keyUp');if((await read()).driving.cruise)throw Error('Brake failed to cancel');
  await tap('f');await delay(200);await evaluate(`window.dispatchEvent(new Event('blur'))`);await delay(200);
  const blur=await read();if(blur.driving.cruise||blur.driving.throttle||blur.driving.steering)throw Error('Blur did not reset');
  await key('ArrowUp');await delay(500);await tap('p');await key('ArrowUp','keyUp');await tap('p');await delay(300);
  if((await read()).driving.throttle)throw Error('Pause retained throttle');
  // Repeat at safe initial positions to test actual forward/reverse steering
  // and each solid collision class, without injecting control state.
  const stage=async(mode)=>{
    await tap('p');
    await evaluate(`(() => {const {runtime:r,bodies}=window.__pitInspect(),cars=[r.player,r.suspect,...r.supports],available=[...bodies];const ordered=cars.map(c=>{available.sort((a,b)=>Math.hypot(a.translation().x-c.x,a.translation().z-c.z)-Math.hypot(b.translation().x-c.x,b.translation().z-c.z));return available.shift();});const seg=r.road.segments[1];cars.forEach((c,i)=>{const obstacle=${JSON.stringify(mode)}==='suspect'?1:2;const near=i===0||(['suspect','support'].includes(${JSON.stringify(mode)})&&i===obstacle);const yaw=near?seg.yaw:r.road.segments[12+i].yaw;const x=near?seg.x:r.road.segments[12+i].x,z=near?seg.z-(i===0?0:12):r.road.segments[12+i].z;const b=ordered[i];b.setTranslation({x,y:.02,z},true);b.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);const speed=i===0?(${JSON.stringify(mode)}==='reverse'?-5:15):0;b.setLinvel({x:0,y:0,z:-speed},true);b.setAngvel({x:0,y:0,z:0},true);Object.assign(c,{x,z,yaw,speed,lateralSpeed:0});});if(${JSON.stringify(mode)}==='wall'){const b=ordered[0],yaw=-Math.PI/2;b.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);b.setLinvel({x:15,y:0,z:0},true);Object.assign(r.player,{yaw});}r.elapsed=0;})()`);
    await tap('p');await delay(100);
  };
  for(const mode of ['forward','reverse']) {
    await stage(mode);const before=await read();await key('ArrowRight');await delay(600);await key('ArrowRight','keyUp');const after=await read();
    const change=after.player.yaw-before.player.yaw;
    if(mode==='forward'?change>=-.02:change<=.02)throw Error('Real steering direction failed '+JSON.stringify({mode,before,after}));
    console.log('player driving: physical steering',mode,change);
  }
  for(const mode of ['wall','suspect','support']) {
    await stage(mode);await tap('f');await delay(100);
    const first=await read();
    // Slow CDP roundtrips can observe the collision before the first sample.
    // Pause reset target to zero: a positive target proves F enabled cruise.
    let hit=!first.driving.cruise&&first.driving.target>0&&first.driving.reason.includes('碰撞');
    if(!first.driving.cruise&&!hit)throw Error('Collision fixture cruise not enabled: '+mode+' '+JSON.stringify(first));
    for(let i=0;i<50&&!hit;i++){await delay(100);const r=await read();if(!r.driving.cruise&&r.driving.reason.includes('碰撞')){hit=true;break;}}
    if(!hit)throw Error('Collision failed to cancel cruise: '+mode);
    console.log('player driving: actual collision cancelled cruise',mode);
  }
  await command('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:1,mobile:true});await delay(300);await capture('player-controls-mobile');
  const layout=await evaluate(`(() => {const a=document.querySelector('.driving-controls').getBoundingClientRect(),b=document.querySelector('.radio-trigger').getBoundingClientRect();return {overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,bottom:a.bottom}})()`);
  if(layout.overlap||layout.bottom>667)throw Error('Controls overlap '+JSON.stringify(layout));
  console.log('player driving: real input, cruise, cancel, focus, pause, stationary yaw and mobile passed',{initial,still,accelerated,raised});
}
