import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.env.PIT_TEST_URL ?? "http://127.0.0.1:4174/PIT/";
const worldCheck = process.env.PIT_TEST_WORLD === "true";
const weather = process.env.PIT_TEST_WEATHER ?? "rain";
const scene = process.env.PIT_TEST_SCENE ?? "highway";
const quality = process.env.PIT_TEST_QUALITY ?? "high";
const edge = process.env.EDGE_PATH
  ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const profile = join(tmpdir(), `pit-edge-smoke-${Date.now()}`);
const browser = spawn(edge, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  url,
], { stdio: "ignore" });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page" && item.url.startsWith(url));
      if (page) return page;
    } catch {
      // Edge may need a moment to expose its DevTools endpoint.
    }
    await delay(250);
  }
  throw new Error("Could not connect to the headless Edge page.");
}

const page = await findPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const runtimeErrors = [];
const failedRequests = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params.exceptionDetails.text);
  } else if (message.method === "Network.loadingFailed" && !message.params.canceled) {
    failedRequests.push(message.params.errorText);
  }
});

function command(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function capture(name) {
  const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await mkdir("work/browser-smoke", { recursive: true });
  const prefix = worldCheck ? `${scene}-${weather}-${quality}-` : "";
  await writeFile(`work/browser-smoke/${prefix}${name}.png`, Buffer.from(result.data, "base64"));
}

async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (await evaluate(expression)) return;
    await delay(500);
  }
  await capture("failed-" + description);
  const text = await evaluate("document.body.innerText");
  throw new Error(`Timed out waiting for ${description}: ${text.slice(0, 1200)}`);
}

try {
  await Promise.all([command("Runtime.enable"), command("Page.enable"), command("Network.enable")]);
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (worldCheck) {
    await command("Page.addScriptToEvaluateOnNewDocument", { source: `window.__pitRoots = new Set(); window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject: () => 1, onCommitFiberRoot: (_, root) => window.__pitRoots.add(root), onCommitFiberUnmount: () => {} };` });
    await command("Page.reload", { ignoreCache: true });
  }
  console.log("browser: protocols enabled");
  await waitFor('Boolean(document.querySelector(".deploy-button"))', "briefing");
  await delay(1000);
  const briefing = await evaluate(`({
    title: document.title,
    deploy: Boolean(document.querySelector(".deploy-button")),
    text: document.body.innerText
  })`);
  if (!briefing.deploy || !briefing.text.includes("部署攔截單位")) {
    throw new Error(`Mission briefing did not hydrate: ${JSON.stringify(briefing)}`);
  }

  if (worldCheck) await evaluate(`(() => {
    const sceneLabels = { city: "城市街區", country: "鄉間公路", highway: "州際高速" };
    [...document.querySelectorAll("button")].find(b => b.textContent.includes(sceneLabels[${JSON.stringify(scene)}])).click();
    [...document.querySelectorAll("button")].find(b => b.textContent === "白天").click();
    const q = { low: "低", medium: "中", high: "高" };
    [...document.querySelectorAll(".quality-field button")].find(b => b.textContent === q[${JSON.stringify(quality)}]).click();
    const select = document.querySelector('select[aria-label="選擇天候"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(weather)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector('.seed-field input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "BATCH3-${scene}");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await delay(300);
  await evaluate(`document.querySelector(".deploy-button").click()`);
  console.log("browser: mission started");
  await waitFor('Boolean(document.querySelector("canvas") && document.querySelector(".hud-camera strong"))', "game");
  await delay(5000);
  const game = await evaluate(`({
    canvas: Boolean(document.querySelector("canvas")),
    camera: document.querySelector(".hud-camera strong")?.textContent ?? "",
    logo: document.querySelector(".game-logo")?.textContent ?? ""
  })`);
  if (!game.canvas || !game.logo.includes("PIT") || !game.camera) {
    throw new Error(`Game canvas or HUD did not load: ${JSON.stringify({ game, runtimeErrors, failedRequests })}`);
  }
  console.log("browser: game loaded");
  if (worldCheck) {
    await evaluate(`window.__pitInspect = () => {
      const result = { runtime: null, world: null, particles: null, bodies: [] };
      const visited = new Set();
      function walk(f) {
        if (!f || visited.has(f)) return;
        visited.add(f);
        if (f.memoizedProps?.runtime?.current?.road) result.runtime = f.memoizedProps.runtime.current;
        const object = f.stateNode?.object;
        if (object?.name === "procedural-world") result.world = object;
        if (object?.name === "weather-particles") result.particles = object;
        if (f.ref?.current?.setTranslation && !result.bodies.includes(f.ref.current)) result.bodies.push(f.ref.current);
        walk(f.child); walk(f.sibling);
      }
      for (const root of window.__pitRoots) walk(root.current);
      return result;
    }`);
    console.log("world: inspection", await evaluate(`(() => { const s = window.__pitInspect(); return { runtime: !!s.runtime, world: !!s.world, particles: !!s.particles, bodies: s.bodies.length, roads: s.world?.children.length }; })()`));
  }

  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC" });
  await delay(500);
  const nextCamera = await evaluate(`document.querySelector(".hud-camera strong")?.textContent ?? ""`);
  if (!nextCamera || nextCamera === game.camera) throw new Error("C camera control did not change mode.");
  if (!nextCamera.includes("駕駛")) throw new Error("The first camera switch did not enter driver view.");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp" });
  await delay(1400);
  console.log("browser: driver acceleration sampled");
  await capture("driver-accelerating");
  console.log("browser: driver screenshot captured");
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp" });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "r", code: "KeyR" });
  await delay(500);
  await capture("driver-rear-view");
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "r", code: "KeyR" });
  await delay(350);

  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC" });
  await delay(4500);
  console.log("browser: helicopter sampled");
  const helicopter = await evaluate(`({
    camera: document.querySelector(".hud-camera strong")?.textContent ?? "",
    distance: document.querySelector(".hud-target strong")?.textContent ?? "",
    targetDirection: Boolean(document.querySelector(".target-direction"))
  })`);
  if (!helicopter.camera.includes("直升機")) throw new Error("The second camera switch did not enter helicopter view.");
  if (!helicopter.targetDirection) throw new Error("The off-screen suspect direction indicator did not appear at long range.");
  await capture("helicopter-long-range");
  console.log("browser: helicopter screenshot captured");
  if (worldCheck) {
    for (let i = 0; i < (process.env.PIT_TEST_LONG === "false" ? 0 : 5); i++) {
      await delay(8000);
      console.log("world: long run", await evaluate(`(() => { const s = window.__pitInspect(); const r = s.runtime; const heights = s.particles ? Array.from(s.particles.geometry.attributes.position.array).filter((_, i) => i % 3 === 1) : []; return { elapsed: r?.elapsed, cars: r ? [r.playerRoadIndex, r.suspectRoadIndex, ...r.supportRoadIndices] : [], loaded: s.world?.children.map(o => Number(o.name.replace("road-segment-", ""))), heightBands: new Set(heights.map(Math.floor)).size }; })()`));
    }
    const check = await evaluate(`(() => { const s = window.__pitInspect(); const r = s.runtime; if (!r || !s.world) return { ok: false }; const loaded = new Set(s.world.children.map(o => Number(o.name.replace("road-segment-", "")))); const cars = [r.playerRoadIndex, r.suspectRoadIndex, ...r.supportRoadIndices]; const heights = s.particles ? Array.from(s.particles.geometry.attributes.position.array).filter((_, i) => i % 3 === 1) : []; return { ok: cars.every(i => loaded.has(i)) && loaded.size <= 60, heightBands: new Set(heights.map(Math.floor)).size, elapsed: r.elapsed }; })()`);
    if (!check.ok || (weather !== "clear" && check.heightBands < 16)) throw new Error("World/weather long-run failed: " + JSON.stringify(check));
    await capture("world-" + scene + "-" + weather + "-" + quality);
    console.log("world: verified", JSON.stringify({ scene, weather, quality, ...check }));
    // Controlled in-browser fixtures exercise both ends of both transitions without
    // changing the shipped game, AI, or 90-second mission duration.
    const transitions = await evaluate(`window.__pitInspect().runtime.road.segments.filter(s => s.kind === "transition").flatMap(s => [s.index, s.index + 1])`);
    const key = async (value, type) => command("Input.dispatchKeyEvent", { type, key: value, code: value === "p" ? "KeyP" : value });
    for (const index of transitions) {
      await key("p", "keyDown"); await key("p", "keyUp");
      await delay(150);
      await evaluate(`(() => {
        const s = window.__pitInspect(), r = s.runtime, seg = r.road.segments[${index}];
        const cars = [r.player, r.suspect, ...r.supports];
        const remaining = [...s.bodies];
        const bodies = cars.map(car => { remaining.sort((a,b) => Math.hypot(a.translation().x-car.x,a.translation().z-car.z)-Math.hypot(b.translation().x-car.x,b.translation().z-car.z)); return remaining.shift(); });
        const fx = -Math.sin(seg.yaw), fz = -Math.cos(seg.yaw);
        for (let i=0;i<4;i++) {
          const offset = [-12, 18, -26, -40][i];
          const x = seg.x + fx * (-36 + offset), z = seg.z + fz * (-36 + offset);
          bodies[i].setTranslation({x,y:.02,z},true);
          bodies[i].setRotation({x:0,y:Math.sin(seg.yaw/2),z:0,w:Math.cos(seg.yaw/2)},true);
          bodies[i].setLinvel({x:fx*30,y:0,z:fz*30},true);
          bodies[i].setAngvel({x:0,y:0,z:0},true);
          Object.assign(cars[i], {x,z,yaw:seg.yaw,speed:30,lateralSpeed:0});
        }
        r.playerRoadIndex = ${index}-1; r.suspectRoadIndex = ${index}; r.supportRoadIndices = [${index}-1,${index}-1]; r.elapsed=0;
      })()`);
      await delay(400);
      await key("p", "keyDown"); await key("p", "keyUp");
      await key("ArrowUp", "keyDown"); await delay(1600); await key("ArrowUp", "keyUp");
      const crossing = await evaluate(`(() => { const s=window.__pitInspect(),r=s.runtime; return { index:r.playerRoadIndex,speed:r.player.speed,loaded:s.world.children.map(o=>o.name),elapsed:r.elapsed }; })()`);
      if (crossing.index < index || crossing.speed < 10) throw new Error("Transition crossing failed: " + JSON.stringify({ index, crossing }));
      await capture("transition-" + index);
      console.log("world: transition crossed", JSON.stringify({ expected: index, actual: crossing.index, speed: crossing.speed }));
    }
    await key("c", "keyDown"); await key("c", "keyUp");
    await key("c", "keyDown"); await key("c", "keyUp");
    await key("p", "keyDown"); await key("p", "keyUp");
    await delay(150);
    await evaluate(`(() => {
      const s=window.__pitInspect(),r=s.runtime,cars=[r.player,r.suspect,...r.supports],remaining=[...s.bodies];
      const bodies=cars.map(car=>{ remaining.sort((a,b)=>Math.hypot(a.translation().x-car.x,a.translation().z-car.z)-Math.hypot(b.translation().x-car.x,b.translation().z-car.z)); return remaining.shift(); });
      const indices=[2,20,10,11];
      for(let i=0;i<4;i++) {
        const seg=r.road.segments[indices[i]];
        bodies[i].setTranslation({x:seg.x,y:.02,z:seg.z},true);
        bodies[i].setRotation({x:0,y:Math.sin(seg.yaw/2),z:0,w:Math.cos(seg.yaw/2)},true);
        bodies[i].setLinvel({x:0,y:0,z:0},true); bodies[i].setAngvel({x:0,y:0,z:0},true);
        Object.assign(cars[i],{x:seg.x,z:seg.z,yaw:seg.yaw,speed:0,lateralSpeed:0});
      }
      r.playerRoadIndex=2;r.suspectRoadIndex=20;r.supportRoadIndices=[10,11];r.elapsed=0;
    })()`);
    await delay(400);
    await key("p", "keyDown"); await key("p", "keyUp");
    await key("ArrowDown", "keyDown"); await delay(3500); await key("ArrowDown", "keyUp");
    const reverse = await evaluate(`window.__pitInspect().runtime.player.speed`);
    if (reverse >= -1) throw new Error("Reverse did not engage: " + reverse);
    await capture("driver-reversing");
    console.log("world: reverse sampled", reverse);
  }

  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "q", code: "KeyQ" });
  await delay(300);
  const radioOpen = await evaluate(`Boolean(document.querySelector(".radio-wheel"))`);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "q", code: "KeyQ" });
  if (!radioOpen) throw new Error("Q radio control did not open the command wheel.");

  if (runtimeErrors.length || failedRequests.length) {
    throw new Error(`Browser errors: ${[...runtimeErrors, ...failedRequests].join("; ")}`);
  }
  console.log(JSON.stringify({ url, title: briefing.title, gameLoaded: true, cameraBefore: game.camera, cameraAfter: nextCamera, helicopter, radioOpen }));
} finally {
  socket.close();
  browser.kill();
}
