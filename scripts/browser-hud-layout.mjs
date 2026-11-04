import assert from 'node:assert/strict';

export async function verifyHudLayout({evaluate,command,delay,capture}) {
  const sizes=[[1920,1080],[1280,800],[1366,768],[390,844],[844,390]];
  const inspect=()=>evaluate(`(()=>{
    const selectors=['.hud-target','.player-status','.network-minimap','.network-minimap svg','.hud-camera','.hud-speed','.radio-trigger','.game-top>button'];
    return Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s);if(!e)return [s,null];const r=e.getBoundingClientRect(),style=getComputedStyle(e);return [s,{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:style.display}];}));
  })()`);
  const overlap=(a,b)=>a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1;
  for(const [width,height] of sizes){
    await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(350);
    for(const details of [false,true]){
      const checked=await evaluate('document.querySelector(".diagnostic-toggles input").checked');
      if(checked!==details){await evaluate('document.querySelector(".diagnostic-toggles input").click()');await delay(250);}
      const boxes=await inspect(), status=boxes['.player-status'],map=boxes['.network-minimap'],camera=boxes['.hud-camera'];
      for(const [name,b] of Object.entries(boxes))assert.ok(b&&b.display!=='none'&&b.width>0&&b.height>0,`${width}x${height} ${name}: ${JSON.stringify(b)}`);
      for(const [name,b] of [['target',boxes['.hud-target']],['map',map],['camera',camera],['speed',boxes['.hud-speed']],['radio',boxes['.radio-trigger']],['pause',boxes['.game-top>button']]]){
        assert.ok(b.x>=-1&&b.y>=-1&&b.right<=width+1&&b.bottom<=height+1,`${width}x${height} ${name} outside: ${JSON.stringify(b)}`);
      }
      for(const [a,b] of [[boxes['.hud-target'],map],[map,camera],[map,boxes['.hud-speed']],[map,boxes['.radio-trigger']],[map,boxes['.game-top>button']],[status,map]])assert.equal(overlap(a,b),false,`${width}x${height} details=${details}: ${JSON.stringify(boxes)}`);
      assert.ok(boxes['.network-minimap svg'].height>=20,`${width}x${height} map too small: ${JSON.stringify(boxes)}`);
      await capture(`hud-${width}x${height}-${details?'details':'normal'}`);
    }
  }
  await evaluate('document.querySelector(".network-minimap button").click()');await delay(100);
  assert.equal(await evaluate('!!document.querySelector(".network-minimap svg")'),false);
  await evaluate('document.querySelector(".network-minimap button").click()');await delay(100);
  assert.equal(await evaluate('!!document.querySelector(".network-minimap svg")'),true);
  // Controlled damage changes the real runtime status; it is not a collision test.
  await evaluate(`Object.assign(window.__pitInspect().runtime.playerDamage,{engine:0,steering:0,alignment:0})`);
  await delay(600);
  const damaged=await inspect();
  assert.equal(await evaluate('document.querySelector(".player-status").textContent.includes("引擎失能")'),true);
  assert.equal(overlap(damaged['.player-status'],damaged['.network-minimap']),false);
  assert.equal(overlap(damaged['.hud-target'],damaged['.network-minimap']),false);
  await capture('hud-disabled-controlled-damage');
  console.log('HUD layout passed: five viewports, normal and expanded diagnostics, map collapse and expand, controlled disabled vehicle');
}
