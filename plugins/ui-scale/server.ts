// alia-plugin-ui-scale — backend entry.
//
// The scale is a per-device setting. The frontend keeps it in localStorage,
// so the server has no state. VesnALIA requires a server entry.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");
}
