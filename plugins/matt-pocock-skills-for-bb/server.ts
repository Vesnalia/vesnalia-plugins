import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { startBackend, type BackendOptions } from "./server/backend.ts";

export { rpcContract } from "./shared/rpc.ts";

/** Options are injectable for isolated tests; VesnALIA calls the factory with only VesnALIA. */
export default async function plugin(alia: AliaPluginApi, options: BackendOptions = {}) {
  await startBackend(alia, options);
}
