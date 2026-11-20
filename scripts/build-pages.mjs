import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "PIT";
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "ianhung221";
const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
const revision = process.env.GITHUB_ACTIONS === "true"
  ? process.env.GITHUB_SHA ?? ""
  : git("rev-parse", "HEAD").stdout?.trim() ?? "";
const status = process.env.GITHUB_ACTIONS === "true" ? null : git("status", "--porcelain");
const validRevision = /^[a-f0-9]{40,64}$/i.test(revision);
const version = !validRevision ? "版本未知／本機開發"
  : process.env.GITHUB_ACTIONS === "true" ? `版本 ${revision.slice(0, 7)}`
  : status?.status !== 0 ? "版本未知／本機開發"
  : `版本 ${revision.slice(0, 7)}${status.stdout.trim() ? " · 本機修改" : " · 本機建置"}`;
const env = {
  ...process.env,
  GITHUB_PAGES: "true",
  NEXT_PUBLIC_BASE_PATH: `/${repository}`,
  NEXT_PUBLIC_SITE_URL: `https://${owner}.github.io/${repository}/`,
  NEXT_PUBLIC_BUILD_VERSION: version,
};
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable; run this script through npm.");

const build = spawnSync(process.execPath, [npmCli, "run", "build"], {
  env,
  stdio: "inherit",
  shell: false,
});

if (build.error) throw build.error;
if (build.status !== 0 && process.platform !== "win32") process.exit(build.status ?? 1);
if (build.status !== 0) {
  console.warn("Vinext returned a Windows shutdown error; validating the newly generated output before accepting it.");
}

const verify = spawnSync(process.execPath, ["scripts/verify-static-export.mjs"], {
  env,
  stdio: "inherit",
  shell: false,
});
if (verify.error) throw verify.error;
process.exit(verify.status ?? 1);
