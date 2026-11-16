// alia-plugin-top-tabs — backend entry. The plugin is frontend-only: the tab
// strip lives in app.tsx and keeps its state in each window's localStorage.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");
}
