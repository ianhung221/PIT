import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "PIT";
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "ianhung221";
const env = {
  ...process.env,
  GITHUB_PAGES: "true",
  NEXT_PUBLIC_BASE_PATH: `/${repository}`,
  NEXT_PUBLIC_SITE_URL: `https://${owner}.github.io/${repository}/`,
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
