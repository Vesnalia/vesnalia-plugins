import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

/**
 * Conductor theme plugin for VesnALIA.
 * The theme palette is declared in package.json manifest;
 * VesnALIA requires this load-safe backend entry to register the plugin.
 */
export default function plugin(alia: AliaPluginApi) {
  alia.log.info("Conductor theme registered");
}