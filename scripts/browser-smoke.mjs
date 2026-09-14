import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.env.PIT_TEST_URL ?? "http://127.0.0.1:4174/PIT/";
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
  await writeFile(`work/browser-smoke/${name}.png`, Buffer.from(result.data, "base64"));
}

try {
  await Promise.all([command("Runtime.enable"), command("Page.enable"), command("Network.enable")]);
  console.log("browser: protocols enabled");
  await delay(5000);
  const briefing = await evaluate(`({
    title: document.title,
    deploy: Boolean(document.querySelector(".deploy-button")),
    text: document.body.innerText
  })`);
  if (!briefing.deploy || !briefing.text.includes("部署攔截單位")) {
    throw new Error(`Mission briefing did not hydrate: ${JSON.stringify(briefing)}`);
  }

  await evaluate(`document.querySelector(".deploy-button").click()`);
  console.log("browser: mission started");
  await delay(8000);
  const game = await evaluate(`({
    canvas: Boolean(document.querySelector("canvas")),
    camera: document.querySelector(".hud-camera strong")?.textContent ?? "",
    logo: document.querySelector(".game-logo")?.textContent ?? ""
  })`);
  if (!game.canvas || !game.logo.includes("PIT") || !game.camera) {
    throw new Error(`Game canvas or HUD did not load: ${JSON.stringify({ game, runtimeErrors, failedRequests })}`);
  }
  console.log("browser: game loaded");

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
