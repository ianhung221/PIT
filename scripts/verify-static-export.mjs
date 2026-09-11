import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const output = path.resolve("dist/client");
const required = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "favicon.svg",
  "og.png",
  "assets/kenney-car-kit/police.glb",
  "assets/kenney-car-kit/race.glb",
  "assets/kenney-car-kit/suv.glb",
  "assets/kenney-car-kit/sedan-sports.glb",
];

await Promise.all(required.map((file) => access(path.join(output, file), constants.R_OK)));

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "PIT";
const expectedPrefix = `/${repository}/`;
const html = await readFile(path.join(output, "index.html"), "utf8");

for (const marker of [
  `${expectedPrefix}manifest.webmanifest`,
  `${expectedPrefix}favicon.svg`,
  `${expectedPrefix}_next/`,
]) {
  if (!html.includes(marker)) {
    throw new Error(`Static export is missing expected project path: ${marker}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(output, "manifest.webmanifest"), "utf8"));
if (manifest.start_url !== "./" || manifest.scope !== "./") {
  throw new Error("Web app manifest must remain scoped to the GitHub Pages project.");
}

console.log(`Verified GitHub Pages export in ${output} for ${expectedPrefix}`);
