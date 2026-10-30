// Controlled parking fixture, NOT autonomous AI evidence. Blockers are made
// translation/rotation locked with their controller writes suppressed, to isolate
// geometry/timing; suspect keeps the production driver and
// dynamic Rapier body. Never inject PIT qualification, timers or victory.
export async function stageControlParking(evaluate, sealed=true) {
  await evaluate(`(() => {
    const {runtime:r,bodies:available}=window.__pitInspect(),seg=r.road.segments[1];
    const remaining=[...available];
    const bodies=[r.player,r.suspect,...r.supports].map(c=>{remaining.sort((a,b)=>Math.hypot(a.translation().x-c.x,a.translation().z-c.z)-Math.hypot(b.translation().x-c.x,b.translation().z-c.z));return remaining.shift();});
    const edge=-seg.width/2;
    const positions=[[edge+2.55,-3.65,-Math.PI/2],[edge+1.35,-.25,0],[edge+2.55,3.65,-Math.PI/2],[edge+3.7,${sealed?0:12},0]];
    positions.forEach(([side,z,offset],i)=>{
      const yaw=seg.yaw+offset,x=seg.x+Math.cos(seg.yaw)*side+Math.sin(seg.yaw)*z,worldZ=seg.z-Math.sin(seg.yaw)*side+Math.cos(seg.yaw)*z;
      const body=bodies[i];body.setTranslation({x,y:-.325,z:worldZ},true);body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
      body.setLinvel({x:0,y:0,z:0},true);body.setAngvel({x:0,y:0,z:0},true);
      if(i!==1) {
        body.lockTranslations(true,true);body.lockRotations(true,true);
        // Direct velocity writes bypass Rapier's force/rotation locks. Suppress
        // ONLY these parked fixture cars' inputs, never the suspect's controller.
        body.setAngvel=()=>{};body.applyImpulse=()=>{};body.setLinvel=()=>{};
      }
      Object.assign(i===0?r.player:i===1?r.suspect:r.supports[i-2],{x,z:worldZ,yaw,speed:0,lateralSpeed:0});
    });
    r.playerRoadIndex=1;r.suspectRoadIndex=1;r.supportRoadIndices=[1,1];
  })()`);
}
export async function verifyControl({evaluate,delay,capture}) {
  const read=()=>evaluate(`(() => {const r=window.__pitInspect().runtime;return {result:r.result,outcome:r.outcome,heldFor:r.heldFor,disabledFor:r.disabledFor,control:r.control,contacts:r.successfulContacts,elapsed:r.elapsed,suspect:r.suspect}})()`);
  await evaluate(`document.querySelector('.game-top button').click()`);await delay(200);
  await stageControlParking(evaluate,false);
  const paused=await read();await delay(300);
  if((await read()).heldFor!==paused.heldFor) throw new Error("Paused timer advanced");
  await evaluate(`document.querySelector('.debrief-actions button').click()`);
  await delay(2500);
  const open=await read();console.log("control: open-side counterexample",open);
  if(open.result!=="playing"||open.heldFor>0) throw new Error("Open side counted as full control");
  await capture("control-open-side");
  await evaluate(`document.querySelector('.game-top button').click()`);await delay(200);
  await stageControlParking(evaluate,true);
  await evaluate(`document.querySelector('.debrief-actions button').click()`);
  let closed;
  for(let i=0;i<60;i++){await delay(250);closed=await read();if(i%8===0)console.log("control: settling",closed);if(closed.result!=="playing")break;}
  console.log("control: parked cage (not autonomous support)",closed);
  await capture("control-cage-diagnostic");
  if(closed.result!=="success"||closed.outcome!=="contained"||closed.heldFor<1.2||closed.contacts!==0) throw new Error("Physical cage without PIT was not recognized: "+JSON.stringify(closed));
  const text=await evaluate(`document.querySelector('.pit-grade')?.textContent`);
  if(!text?.includes("未完成合格 PIT")) throw new Error("Mission victory incorrectly credited PIT");
  await capture("control-contained-no-pit");
  await evaluate(`document.querySelector('.debrief-actions button').click()`);await delay(500);
  const reset=await read();if(reset.heldFor!==0||reset.disabledFor!==0||reset.contacts!==0||reset.result!=="playing") throw new Error("Restart retained control data");
  // Isolate damage completion without qualifying a PIT or injecting a timer.
  await evaluate(`window.__pitInspect().runtime.suspectDamage.engine=0`);
  let disabled;
  for(let i=0;i<60;i++){await delay(250);disabled=await read();if(disabled.result!=="playing")break;}
  console.log("control: disabled without PIT (injected engine damage only)",disabled);
  if(disabled.result!=="success"||disabled.outcome!=="disabled"||disabled.disabledFor<1.2||disabled.contacts!==0)throw new Error("Independent disabled-stop gate failed");
  await evaluate(`document.querySelector('.debrief-actions button.secondary').click()`);await delay(200);
  if(!await evaluate(`Boolean(document.querySelector('.deploy-button'))`)) throw new Error("Return to settings failed");
}
