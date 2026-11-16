// Theme-only plugin: the palettes ship via the alia.themes manifest entry.
// VesnALIA requires a server entry, so this one just announces itself.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("Tokyo Night palettes registered");
}
