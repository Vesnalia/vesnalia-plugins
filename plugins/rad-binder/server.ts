// alia-plugin-rad-binder — backend entry.
//
// The theme is declarative: `alia.themes` in package.json points VesnALIA at
// theme.css, which VesnALIA reads straight from the plugin directory. `alia.server`
// is a required manifest field, so this factory only satisfies the loader.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded — contributes the Rad Binder theme");
}
