// @smsunarto/alia-plugin-monokai — backend entry.
//
// The palette itself is declarative: `alia.themes` in package.json points VesnALIA at
// themes/alia-monokai.css, which VesnALIA reads straight from the plugin directory. No
// runtime surface is needed, but `alia.server` is a required manifest field, so
// this factory exists to satisfy the loader.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded — contributes the VesnALIA Monokai palette");
}
