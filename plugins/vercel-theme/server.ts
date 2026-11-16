import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

/**
 * Theme-only plugin. The palette and code themes are declared in package.json;
 * VesnALIA requires this load-safe backend entry to activate the contribution.
 */
export default function plugin(alia: AliaPluginApi) {
  alia.log.info("Vercel theme registered");
}
