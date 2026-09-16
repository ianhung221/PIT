// Local-only preview of the same /PIT/ static artifact served by GitHub Pages.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve("dist/client");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".glb": "model/gltf-binary" };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (!pathname.startsWith("/PIT/")) { res.writeHead(404).end(); return; }
    const path = resolve(root, pathname.slice(5) || "index.html");
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": mime[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(4174, "127.0.0.1", () => console.log("PIT preview: http://127.0.0.1:4174/PIT/"));
