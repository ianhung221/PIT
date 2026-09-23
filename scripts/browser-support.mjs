export async function verifySupportUnits({ evaluate, command, delay, capture, waitFor }) {
  const key = async (key, repeat = false) => {
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, autoRepeat: repeat });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key });
    await delay(100);
  };
  const radio = async (n, mouse = false) => {
    if (mouse) {
      await evaluate(`document.querySelector('.radio-trigger').click()`); await delay(150);
      await evaluate(`document.querySelectorAll('.radio-wheel>button')[${n - 1}].click()`);
    } else {
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "q" }); await delay(150);
      await key(String(n));
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "q" });
    }
    await delay(1000);
    console.log("support: radio", n, await evaluate(`({ tactical:window.__pitInspect().runtime.tacticalCommand, message:document.querySelector('.radio-feedback').textContent, roles:document.querySelector('.hud-units').textContent })`));
  };
  await evaluate(`window.__placeSupportFixture = (kind) => {
    const { runtime:s, bodies } = window.__pitInspect();
    const place = (body, snapshot, index, side, longitudinal, yawOffset=0, speed=0) => {
      const seg=s.road.segments[index], yaw=seg.yaw+yawOffset;
      const x=seg.x+Math.cos(seg.yaw)*side-Math.sin(seg.yaw)*longitudinal;
      const z=seg.z-Math.sin(seg.yaw)*side-Math.cos(seg.yaw)*longitudinal;
      body.setTranslation({x,y:.02,z},true); body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
      body.setLinvel({x:-Math.sin(yaw)*speed,y:0,z:-Math.cos(yaw)*speed},true); body.setAngvel({x:0,y:0,z:0},true);
      Object.assign(snapshot,{x,z,yaw,speed,lateralSpeed:0});
    };
    s.elapsed=0; s.pitQualified=false; s.pitCandidate=null; s.containmentElapsed=0; s.tacticalCommand=null; s.radioFeedback=null;
    if(kind==='walls') {
      place(bodies[0],s.player,3,0,0); place(bodies[1],s.suspect,4,0,0,0,25);
      const width=s.road.segments[1].width;
      place(bodies[2],s.supports[0],1,width/2-2.6,-15,-Math.PI/2);
      place(bodies[3],s.supports[1],1,-width/2+2.6,15,Math.PI/2);
      s.playerRoadIndex=3; s.suspectRoadIndex=4; s.supportRoadIndices=[1,1];
    } else if(kind==='formation') {
      place(bodies[0],s.player,0,-3,0); place(bodies[1],s.suspect,2,0,0);
      place(bodies[2],s.supports[0],1,3,24); place(bodies[3],s.supports[1],1,-3,7);
      s.playerRoadIndex=0;s.suspectRoadIndex=2;s.supportRoadIndices=[1,1];
      s.suspectDamage.engine=.05;s.suspectDamage.steering=.05;
    } else if(kind==='slow') {
      place(bodies[0],s.player,1,-3,-28); place(bodies[1],s.suspect,1,0,0);
      place(bodies[2],s.supports[0],1,3,-18); place(bodies[3],s.supports[1],1,-2,-32);
      s.playerRoadIndex=1;s.suspectRoadIndex=1;s.supportRoadIndices=[1,1];
      s.suspectDamage.engine=.05;s.suspectDamage.steering=.05;
    } else {
      place(bodies[0],s.player,0,-3,0); place(bodies[1],s.suspect,4,0,0,0,30);
      place(bodies[2],s.supports[0],1,2,0,0,24); place(bodies[3],s.supports[1],1,-2,-18,0,24);
      s.playerRoadIndex=3;s.suspectRoadIndex=4;s.supportRoadIndices=[1,1];
    }
    s.supportAi.forEach((ai,i)=>Object.assign(ai,{mode:'driving',modeElapsed:0,stalledFor:0,lastX:s.supports[i].x,lastZ:s.supports[i].z}));
    s.supportArrivedFor=[0,0];
  }`);
  if (process.env.PIT_SUPPORT_COMMANDS_ONLY !== "true") {
  await key("p"); await evaluate(`window.__placeSupportFixture('walls')`); await key("p");
  const modes = [new Set(), new Set()];
  for (let i=0;i<18;i++) {
    await delay(1000);
    const sample = await evaluate(`window.__pitInspect().runtime.supportAi.map((ai,i)=>({mode:ai.mode,speed:window.__pitInspect().runtime.supports[i].speed,index:window.__pitInspect().runtime.supportRoadIndices[i]}))`);
    sample.forEach((s,i)=>modes[i].add(s.mode));
    if(i%5===0) console.log("support: recovery",sample);
  }
  const recovery = await evaluate(`window.__pitInspect().runtime.supports.map((c,i)=>({speed:c.speed,mode:window.__pitInspect().runtime.supportAi[i].mode,index:window.__pitInspect().runtime.supportRoadIndices[i]}))`);
  console.log("support: recovered", recovery, modes.map(m=>[...m]));
  if (recovery.some((s,i)=>!modes[i].has("reversing") || s.mode!=="driving" || s.speed<3)) throw new Error("Support wall recovery failed");
  await key("c"); await capture("support-driver-mirrors"); await key("c"); await capture("support-recovered");
  await key("p"); await evaluate(`window.__placeSupportFixture('catchup')`); await key("p");
  const initial = await evaluate(`window.__pitInspect().runtime.supports.map(c=>Math.hypot(c.x-window.__pitInspect().runtime.suspect.x,c.z-window.__pitInspect().runtime.suspect.z))`);
  for(let i=0;i<24;i++) await delay(1000);
  const closing = await evaluate(`window.__pitInspect().runtime.supports.map(c=>Math.hypot(c.x-window.__pitInspect().runtime.suspect.x,c.z-window.__pitInspect().runtime.suspect.z))`);
  console.log("support: catchup", {initial,closing}, await evaluate(`({cars:window.__pitInspect().runtime.supports,ai:window.__pitInspect().runtime.supportAi,player:window.__pitInspect().runtime.player})`));
  if(closing.some((d,i)=>d>=initial[i])) throw new Error("Supports did not close distance");
  }
  for (const n of [2,3,5,1]) await radio(n,n===3);
  if(await evaluate(`window.__pitInspect().runtime.tacticalCommand!=='take-primary'`)) throw new Error("Q1 canceled takeover");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "q" }); await delay(150);
  await key("2",true);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "q" });
  if(await evaluate(`window.__pitInspect().runtime.tacticalCommand!=='take-primary'`)) throw new Error("Repeated key sent command");
  await radio(2);
  await radio(4);
  if(await evaluate(`window.__pitInspect().runtime.radioFeedback.phase!=='unable'`)) throw new Error("Fast block command should wait");
  await capture("support-radio-waiting");
  await key("p"); await evaluate(`window.__placeSupportFixture('slow')`); await key("p");
  await radio(4,true);
  try {
    await waitFor(`window.__pitInspect().runtime.radioFeedback?.phase==='completed'`, "support-front-block");
  } catch (error) {
    console.log("support: blocked diagnostic", await evaluate(`({cars:window.__pitInspect().runtime.supports,ai:window.__pitInspect().runtime.supportAi,suspect:window.__pitInspect().runtime.suspect,arrived:window.__pitInspect().runtime.supportArrivedFor})`));
    throw error;
  }
  await capture("support-front-block");
  console.log("support: block completed",await evaluate(`window.__pitInspect().runtime.supportArrivedFor`));
  for (const n of [2,3,5]) {
    await key("p"); await evaluate(`window.__placeSupportFixture('formation')`); await key("p");
    await radio(n, true);
    await waitFor(`window.__pitInspect().runtime.radioFeedback?.phase==='completed'`, "support-formation-"+n);
    console.log("support: formation completed", n, await evaluate(`window.__pitInspect().runtime.supportArrivedFor`));
    await capture("support-formation-"+n);
  }
  await radio(6);
  if(await evaluate(`window.__pitInspect().runtime.result==='playing'`)) throw new Error("Terminate did not finish mission");
  await capture("support-debrief");
}
