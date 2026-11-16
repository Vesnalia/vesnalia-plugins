// Dev server for the timeline harness: `npx vite --config app/timeline/harness/vite.config.ts`.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");

// VesnALIA's own Inter, when VesnALIA is installed, so screenshots match the app.
const aliaAssets = "/Applications/alia.app/Contents/Resources/app.asar.unpacked/node_modules/alia-app/app/dist/assets";
const inter = existsSync(aliaAssets) ? readdirSync(aliaAssets).find((f) => f.startsWith("inter-latin-wght-normal")) : undefined;

export default defineConfig({
  root: here,
  resolve: { alias: { "@": repo } },
  define: { __HARNESS_INTER__: JSON.stringify(inter ? `/@fs${join(aliaAssets, inter)}` : "") },
  server: { port: 5199, strictPort: true, fs: { allow: [repo, aliaAssets] } },
  oxc: { jsx: { runtime: "automatic" } },
});
