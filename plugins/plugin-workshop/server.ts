// Plugin Workshop — the plugin entry point. Wiring is in server/wiring.ts, the logic in server/*.ts.
// The VesnALIA server machine (where the plugin working copies live) is `system.config().primaryHostId` — the server row in
// `alia machine list`. `sdkPorts.serverHostId` takes it from there; it is not a setting.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { wire } from "./server/wiring";

export default async function plugin(alia: AliaPluginApi) {
  await wire(alia);
}
