// alia-plugin-quick-thread — backend entry.
//
// One job: take the NewThreadRequest that the frontend's NewThreadComposer
// produces and create the thread with it. The composer resolves every
// selection (project, environment, provider/model, permission mode, prompt
// input); this handler just forwards it to alia.sdk.threads.spawn, which fills
// in `origin: "plugin"` / `originPluginId` so quick-created threads stay
// attributed to this plugin.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

// The composer's NewThreadRequest. Fields we forward verbatim; `.passthrough()`
// keeps any additive fields a newer VesnALIA adds. spawn does the real validation.
const newThreadRequestSchema = z
  .object({
    projectId: z.string(),
    providerId: z.string(),
    model: z.string(),
    reasoningLevel: z.string().nullish(),
    permissionMode: z.string().nullish(),
    serviceTier: z.string().nullish(),
    executionInputSources: z.unknown(),
    environment: z.unknown(),
    input: z.unknown(),
  })
  .passthrough();

export const rpcContract = defineRpcContract({
  create_thread: {
    input: z.object({ request: newThreadRequestSchema }),
    output: z.object({ threadId: z.string() }),
  },
});

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  alia.rpc.register(rpcContract, {
    create_thread: async ({ request }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const thread = await alia.sdk.threads.spawn({ ...(request as any) });
      alia.log.info(`created thread ${thread.id}`);
      return { threadId: thread.id };
    },
  });

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
