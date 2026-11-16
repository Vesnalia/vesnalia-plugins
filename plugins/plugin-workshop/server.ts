// Plugin Workshop — the plugin entry point. Wiring is in server/wiring.ts, the logic in server/*.ts.
// The bb server machine (where the plugin working copies live) is `system.config().primaryHostId` — the server row in
// `bb machine list`. `sdkPorts.serverHostId` takes it from there; it is not a setting.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { wire } from "./server/wiring";

export default async function plugin(bb: BbPluginApi) {
  await wire(bb);
}
