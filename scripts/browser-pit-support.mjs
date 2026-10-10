// Start from a reproducible moving formation, then let actual Rapier contact and
// the production PIT evaluator decide the outcome. Never inject pitQualified.
export async function verifyPitSupport({ evaluate, command, delay, capture }) {
  const mode = process.env.PIT_TEST_CONTACT ?? "effective";
  const radio = async n => {
    await evaluate(`document.querySelector('.radio-trigger').click()`);
    await delay(100);
    await evaluate(`document.querySelectorAll('.radio-wheel>button')[${n - 1}].click()`);
    await delay(150);
  };
  if (process.env.PIT_TEST_AUTO !== "true") await radio(4);
  if (mode !== "unauthorized") await radio(1);
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
    place(0,2.05,${mode === "center" ? 0 : -3.9},16);place(1,0,0,12);place(2,-3,-18,12);place(3,2.8,-30,10);
    bodies[0].setLinvel({x:-Math.sin(seg.yaw)*16-Math.cos(seg.yaw)*7,y:0,z:-Math.cos(seg.yaw)*16+Math.sin(seg.yaw)*7},true);
    s.playerRoadIndex=1;s.suspectRoadIndex=1;s.supportRoadIndices=[1,1];
    s.elapsed=0;s.commandAt=0;s.collisionCooldown=0;
  })()`);
  if (mode !== "unauthorized" && !await evaluate(`window.__pitInspect().runtime.authorizationRequested`)) throw new Error("Q1 did not register continuous authorization request");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft" });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp" });
  await evaluate(`document.querySelector('.debrief-actions button').click()`);
  await delay(1800);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp" });
  const stages = new Set(); let contact = false, qualified = false, final;
  for (let i = 0; i < 160; i++) {
    await delay(250);
    final = await evaluate(`(() => {const s=window.__pitInspect().runtime;return {attempts:s.attempts,qualified:s.pitQualified,contacts:s.successfulContacts,candidate:!!s.pitCandidate,pit:s.pit,phase:s.blockade.phase,heldFor:s.heldFor,outcome:s.outcome,command:s.tacticalCommand,result:s.result,suspect:s.suspect,supports:s.supports,feedback:s.contactFeedback,events:s.eventLog.slice(0,6)}})()`);
    contact ||= final.candidate || final.attempts > 0; qualified ||= final.qualified || final.contacts > 0; stages.add(final.phase);
    if (i % 8 === 0) console.log("pit-support: sample", {attempts:final.attempts,qualified:final.qualified,pit:final.pit,phase:final.phase,result:final.result,feedback:final.feedback});
    if (mode !== "effective" && i >= 12) break;
    if (!qualified && i >= 16 && !final.candidate) break;
    if (qualified && process.env.PIT_TEST_DISABLED === "true") {
      // Isolate the damage gate only after physical PIT qualification.
      await evaluate(`window.__pitInspect().runtime.suspectDamage.engine=0`);
      await delay(2500);
      const disabled = await evaluate(`(() => {const s=window.__pitInspect().runtime;return {result:s.result,outcome:s.outcome,speed:Math.hypot(s.suspect.speed,s.suspect.lateralSpeed),contacts:s.successfulContacts}})()`);
      console.log("pit-support: staged disabled engine after natural PIT",disabled);
      if (disabled.result !== "success" || disabled.outcome !== "disabled" || disabled.speed >= 1.2 || !disabled.contacts) throw new Error("Disabled outcome preceded actual stop");
      await capture("pit-disabled");return;
    }
    if (qualified && process.env.PIT_TEST_HOLD === "true") {
      // Qualification was produced above by real contact. Only stage a
      // parking geometry now, to isolate the victory timer (not autonomous AI).
      await evaluate(`document.querySelector('.game-top button').click()`);
      await evaluate(`(() => {
        const {runtime:s,bodies}=window.__pitInspect();const index=s.suspectRoadIndex,seg=s.road.segments[index],yaw=seg.yaw;
        const place=(i,forward,side=0)=>{const x=seg.x-Math.sin(yaw)*forward+Math.cos(yaw)*side,z=seg.z-Math.cos(yaw)*forward-Math.sin(yaw)*side;
          bodies[i].setTranslation({x,y:.02,z},true);bodies[i].setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);bodies[i].setLinvel({x:0,y:0,z:0},true);bodies[i].setAngvel({x:0,y:0,z:0},true);
          Object.assign(i===0?s.player:i===1?s.suspect:s.supports[i-2],{x,z,yaw,speed:0,lateralSpeed:0});};
        place(0,-22,-3);place(1,0);place(2,4.95);place(3,-4.89);
        Object.assign(s.blockade,{phase:'approaching',anchor:{x:seg.x,z:seg.z,yaw,index,side:3,front:4.95,rear:4.89},stages:[3,3],settled:[0,0],blockedFor:[0,0]});
      })()`);
      await evaluate(`document.querySelector('.debrief-actions button').click()`);
      await delay(1500);
      const held = await evaluate(`(() => {const s=window.__pitInspect().runtime;return {result:s.result,outcome:s.outcome,heldFor:s.heldFor,contacts:s.successfulContacts}})()`);
      console.log("pit-support: staged physical hold after natural PIT",held);
      if (held.result !== "success" || held.outcome !== "contained" || held.heldFor <= .8 || held.contacts < 1) throw new Error("Physical holding victory did not use stable time");
      await capture("pit-stable-hold");return;
    }
    if (final.outcome === "escaped-containment") break;
    if (final.result !== "playing" || (qualified && (final.phase === "holding" || (final.phase === "missed" && process.env.PIT_TEST_ESCAPE !== "true")))) break;
  }
  await capture("pit-support-contact");
  console.log("pit-support: outcome", {contact,qualified,stages:[...stages],final});
  if (mode !== "effective") {
    const expected = mode === "center" ? "scrape" : "unsafe";
    if (qualified || final.contacts || final.result === "success" || !final.events.some(e => expected === "scrape" ? e.includes("一般碰撞") : e.includes("未授權"))) throw new Error("Invalid physical contact was accepted or never classified: " + mode);
    return;
  }
  if (!contact) throw new Error("Physical contact did not trigger a PIT attempt");
  if (!qualified) throw new Error("Physical PIT did not reach the existing spin/slowdown threshold");
  if (process.env.PIT_TEST_ESCAPE === "true" && final.outcome !== "escaped-containment") throw new Error("Driveable suspect did not resume escape after missed blockade");
  if (!stages.has("approaching") && !stages.has("missed") && !stages.has("holding")) throw new Error("Armed Q4 never reacted to PIT slowdown");
  if (final.result === "success" && final.outcome === "contained" && final.heldFor <= .8) throw new Error("Victory preceded stable front/rear hold");
}
