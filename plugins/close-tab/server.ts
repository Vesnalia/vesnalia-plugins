// alia-plugin-close-tab — backend entry.
//
// The plugin lives in the app shell (see app.tsx). VesnALIA requires a server
// entry, so this one only records its lifecycle in the plugin log.

import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");
  return () => {
    alia.log.info("disposed");
  };
}
