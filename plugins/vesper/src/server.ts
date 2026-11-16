import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

// VesnALIA's manifest schema requires alia.server, even for a plugin that registers nothing.
export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("vesper theme loaded — select it in Settings → Appearance or `alia theme set plugin:vesper:vesper`");
}
