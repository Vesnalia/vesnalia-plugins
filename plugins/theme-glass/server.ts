// alia-plugin-theme-glass — headless backend entry.
//
// The plugin contributes its palette through `alia.themes` in package.json, so
// this entry only needs to exist and load. Keep it free of state: the theme
// is served from themes/glass.css by VesnALIA itself, and re-read on every
// appearance change.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("glass theme available as plugin:theme-glass:glass");
}
