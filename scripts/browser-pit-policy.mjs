// No runtime policy flags or positions are injected: Q1 and natural AI driving.
export async function verifyPitPolicy({ evaluate, delay }) {
  await evaluate(`document.querySelector('.radio-trigger').click()`);
  await evaluate(`document.querySelectorAll('.radio-wheel>button')[0].click()`);
  const seen = new Set(); let safeAt = null;
  for (let i = 0; i < 180; i++) {
    await delay(500);
    const s = await evaluate(`(() => {const s=window.__pitInspect().runtime;return {elapsed:s.elapsed,state:s.authorization,reason:s.authorizationReason,expires:s.authorizationExpires,requested:s.authorizationRequested,result:s.result}})()`);
    seen.add(s.state);
    if (!s.requested || s.expires < s.elapsed) throw new Error("Continuous Q1 expired during active simulation");
    if (s.state === "authorized") {
      if (s.reason.includes("速度過高")) throw new Error("Authorized HUD contradicts speed rule");
      safeAt = s.elapsed; break;
    }
    if (s.result !== "playing") break;
  }
  console.log("policy: natural Q1 window", {seen:[...seen],safeAt});
  if (safeAt === null || safeAt >= 90) throw new Error("No natural authorization opportunity within mission");
}
