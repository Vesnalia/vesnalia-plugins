import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

/**
 * All of the behaviour lives in the frontend content script; a plugin still
 * needs a backend entry, so this one only announces itself.
 */
export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("color-swatches ready");
}
