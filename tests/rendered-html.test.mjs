import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the PIT Unit application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>PIT Unit/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /zh-Hant/);
  assert.match(html, /作戰區域/);
  assert.match(html, /任務地圖代碼/);
  assert.match(html, /畫面品質/);
  assert.match(html, /無線電/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Starter Project/);
});
