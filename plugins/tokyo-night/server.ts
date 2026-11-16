// Theme-only plugin: the palettes ship via the bb.themes manifest entry.
// bb requires a server entry, so this one just announces itself.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("Tokyo Night palettes registered");
}
