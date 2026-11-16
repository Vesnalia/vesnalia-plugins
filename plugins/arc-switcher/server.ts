import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

const recentThreadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  providerId: z.string(),
  status: z.enum(["active", "starting", "stopping", "idle", "error"]),
  updatedAt: z.number(),
});

export const rpcContract = defineRpcContract({
  clientEvent: {
    input: z.object({
      kind: z.enum(["mounted", "shortcut"]),
      generation: z.number().int().nonnegative(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  recentThreads: {
    input: z.null(),
    // Wider than the 7 shown: the frontend re-orders by the user's own
    // most-recently-opened history, which is not the same as updatedAt.
    output: z.object({ threads: z.array(recentThreadSchema).max(25) }),
  },
});

export default function plugin(alia: AliaPluginApi) {
  alia.rpc.register(rpcContract, {
    clientEvent({ kind, generation }) {
      alia.log.info(`frontend ${kind} (generation ${generation})`);
      return { ok: true as const };
    },
    async recentThreads() {
      const threads = await alia.sdk.threads.list({
        archived: false,
        includeHidden: false,
      });

      return {
        threads: threads
          .filter(
            (thread) =>
              thread.visibility === "visible" &&
              thread.archivedAt === null &&
              thread.deletedAt === null,
          )
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, 25)
          .map((thread) => ({
            id: thread.id,
            projectId: thread.projectId,
            title: thread.title ?? thread.titleFallback ?? "Untitled chat",
            providerId: thread.providerId,
            status: thread.status,
            updatedAt: thread.updatedAt,
          })),
      };
    },
  });
}
