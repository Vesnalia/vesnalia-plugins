// bb-plugin-ui-scale — backend entry.
//
// The scale is a per-device setting. The frontend keeps it in localStorage,
// so the server has no state. BB requires a server entry.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
