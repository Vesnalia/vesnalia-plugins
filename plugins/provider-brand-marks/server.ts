// The whole plugin is a frontend content script; VesnALIA requires a server entry,
// so this one just announces itself.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("Provider brand marks registered");
}
