import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Prefer an explicit CLI, then the installed macOS desktop CLI, then PATH.
const desktop = "/Applications/alia.app/Contents";
const bundled = `${desktop}/Resources/app.asar/node_modules/alia-app/dist/alia.js`;
const useDesktop =
  !process.env.ALIA_CLI &&
  process.platform === "darwin" &&
  existsSync(`${desktop}/MacOS/alia`);
const result = spawnSync(
  process.env.ALIA_CLI || (useDesktop ? `${desktop}/MacOS/alia` : "alia"),
  [...(useDesktop ? [bundled] : []), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(useDesktop ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
  },
);
if (result.error)
  console.error(
    "Install VesnALIA, put its CLI on PATH, or set ALIA_CLI to an executable:",
    result.error.message,
  );
process.exitCode = result.status ?? 1;
