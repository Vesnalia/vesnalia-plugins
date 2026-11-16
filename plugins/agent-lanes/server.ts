import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { rpcContract } from "./shared/rpc";
import { registerCli } from "./server/cli";
import { LanesService } from "./server/service";

export { rpcContract } from "./shared/rpc";

export default function plugin(alia: AliaPluginApi) {
  const lanes = new LanesService(alia);
  alia.rpc.register(rpcContract, {
    lanes_window: async ({ since, threadIds }) => lanes.storage.window(since, lanes.indexing, threadIds),
    lanes_neighbors: async ({ threadIds, from, to }) => lanes.storage.neighbors(threadIds, from, to),
    lanes_block_detail: ({ threadId, blockId }) => lanes.detail(threadId, blockId),
    lanes_decide: ({ threadId, interactionId, decision }) => lanes.decide(threadId, interactionId, decision),
  });
  registerCli(alia, lanes);
  alia.onDispose(() => lanes.dispose());
  alia.background.service("lanes-indexer", { start: signal => lanes.start(signal) });
}
