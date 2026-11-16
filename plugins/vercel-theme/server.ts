import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Theme-only plugin. The palette and code themes are declared in package.json;
 * BB requires this load-safe backend entry to activate the contribution.
 */
export default function plugin(bb: BbPluginApi) {
  bb.log.info("Vercel theme registered");
}
