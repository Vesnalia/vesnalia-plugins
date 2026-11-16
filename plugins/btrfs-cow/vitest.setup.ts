// The published @vesnalia/plugin-sdk host bundle calls a global `require` that
// the VesnALIA daemon provides at runtime. Supply one so tests can load it natively.
import { createRequire } from "node:module";

if (typeof (globalThis as { require?: unknown }).require === "undefined") {
  (globalThis as { require?: unknown }).require = createRequire(import.meta.url);
}
