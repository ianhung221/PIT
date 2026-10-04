// Start from a reproducible moving formation, then let actual Rapier contact and
// the production PIT evaluator decide the outcome. Never inject pitQualified.
export async function verifyPitSupport({ evaluate, command, delay, capture }) {
  const radio = async n => {
    await evaluate(`document.querySelector('.radio-trigger').click()`);
    await delay(100);
    await evaluate(`document.querySelectorAll('.radio-wheel>button')[${n - 1}].click()`);
    await delay(150);
  };
  await radio(4); await radio(1);
  const authorization = await evaluate(`window.__pitInspect().runtime.authorization`);
  if (authorization !== "authorized") throw new Error("PIT fixture requires authorized rural clear conditions: " + authorization);
  await evaluate(`document.querySelector('.game-top button').click()`);
  await delay(150);
  await evaluate(`(() => {
    const {runtime:s,bodies}=window.__pitInspect(); const seg=s.road.segments[1];
    const place=(i,side,forward,speed,offset=0)=>{
      const yaw=seg.yaw+offset, x=seg.x+Math.cos(seg.yaw)*side-Math.sin(seg.yaw)*forward, z=seg.z-Math.sin(seg.yaw)*side-Math.cos(seg.yaw)*forward;
      bodies[i].setTranslation({x,y:.02,z},true); bodies[i].setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
      bodies[i].setLinvel({x:-Math.sin(yaw)*speed,y:0,z:-Math.cos(yaw)*speed},true); bodies[i].setAngvel({x:0,y:0,z:0},true);
      const snapshot=i===0?s.player:i===1?s.suspect:s.supports[i-2]; Object.assign(snapshot,{x,z,yaw,speed,lateralSpeed:0});
    };
    place(0,2.15,-3.4,16);place(1,0,0,12);place(2,-3,-18,12);place(3,2.8,-30,10);
    bodies[0].setLinvel({x:-Math.sin(seg.yaw)*16-Math.cos(seg.yaw)*4,y:0,z:-Math.cos(seg.yaw)*16+Math.sin(seg.yaw)*4},true);
    s.playerRoadIndex=1;s.suspectRoadIndex=1;s.supportRoadIndices=[1,1];
    s.elapsed=0;s.commandAt=0;s.collisionCooldown=0;
  })()`);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft" });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp" });
  await evaluate(`document.querySelector('.debrief-actions button').click()`);
  await delay(700);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp" });
  const stages = new Set(); let contact = false, qualified = false, final;
  for (let i = 0; i < 160; i++) {
    await delay(250);
    final = await evaluate(`(() => {const s=window.__pitInspect().runtime;return {attempts:s.attempts,qualified:s.pitQualified,contacts:s.successfulContacts,candidate:!!s.pitCandidate,pit:s.pit,phase:s.blockade.phase,command:s.tacticalCommand,result:s.result,suspect:s.suspect,events:s.eventLog.slice(0,6)}})()`);
    contact ||= final.candidate || final.attempts > 0; qualified ||= final.qualified || final.contacts > 0; stages.add(final.phase);
    if (i % 8 === 0) console.log("pit-support: sample", final);
    if (final.result !== "playing" || (qualified && (final.phase === "holding" || final.phase === "missed"))) break;
  }
  await capture("pit-support-contact");
  console.log("pit-support: outcome", {contact,qualified,stages:[...stages],final});
  if (!contact) throw new Error("Physical contact did not trigger a PIT attempt");
  if (!qualified) throw new Error("Physical PIT did not reach the existing spin/slowdown threshold");
  if (!stages.has("approaching") && !stages.has("missed") && !stages.has("holding")) throw new Error("Armed Q4 never reacted to PIT slowdown");
}
