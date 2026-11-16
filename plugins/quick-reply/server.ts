// alia-plugin-quick-reply — backend entry.
//
// What: an intentionally empty backend.
// Why: VesnALIA requires every plugin to declare `alia.server`, but Quick Reply is a
//   pure UI layer. Marks live in the browser's localStorage and replies go
//   out through the thread's own message box, so the server has nothing to do.
// Design notes: no CLI command, agent tool, or skill is registered here on
//   purpose. VesnALIA turns plugin CLI commands and skills into agent-facing
//   documentation, and the agent must never learn this plugin exists.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

/**
 * Plugin factory VesnALIA calls on load.
 *
 * @param VesnALIA - the plugin API; only logging is used.
 * Post-conditions: writes one "loaded" line to the plugin log. Registers
 *   nothing, so there is nothing to dispose.
 */
export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded (frontend-only plugin)");
}
