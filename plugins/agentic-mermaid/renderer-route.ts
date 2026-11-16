// Shared by server.ts (serves the files) and mermaid-renderer.ts (imports them).
//
// VesnALIA's app bundler emits one file and inlines dynamic imports, which would put
// agentic-mermaid's ~2.5 MB of per-family renderers and layout engine into every
// VesnALIA page load. Instead the server serves the package's code-split browser build
// (`dist/browser-lazy`) and the frontend imports it by URL, so the browser fetches
// only the families a conversation actually draws. The version segment makes the
// URLs immutable, so they cache for good and change with every package upgrade.
import { version as agenticVersion } from "agentic-mermaid/package.json";

/** Plugin HTTP path of `dist/browser-lazy/`; files mount beneath it. */
export const RENDERER_ROUTE = `/agentic-mermaid/${agenticVersion}`;
