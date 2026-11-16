import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { rpcContract } from "./src/contract";
import { snapshotForThread } from "./src/snapshot";

export default function plugin(alia: AliaPluginApi) {
  alia.settings.define({
    expandOnEnter: {
      type: "boolean",
      label: "Expand list when opening a thread",
      description:
        "When on, the to-do card starts expanded. When off, only the N/M complete header shows until you open it.",
      default: true,
    },
  });

  alia.rpc.register(rpcContract, {
    getTodos({ threadId }) {
      return snapshotForThread(alia, threadId);
    },
  });

  const publish = (threadId: string) => {
    alia.realtime.publish("todos", { threadId });
  };
  alia.events.on("thread.active", ({ thread }) => {
    publish(thread.id);
  });
  alia.events.on("thread.idle", ({ thread }) => {
    publish(thread.id);
  });
  alia.log.info("loaded");
}
