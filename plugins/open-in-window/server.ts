// alia-plugin-open-in-window — backend entry.
//
// Everything this plugin does happens in the browser (see app.ts). The
// manifest still needs a server entry, so this one only logs that it loaded.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function plugin(alia: AliaPluginApi) {
  alia.log.info("Open in Window loaded; the thread menu action lives in the app");
}
