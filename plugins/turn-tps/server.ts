import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { createState, ingest, turnStats, type IngestState } from "./stats";

const turnStatSchema = z.object({
  turnId: z.string(), threadId: z.string(), durationMs: z.number(),
  durationFormatted: z.string(), tokens: z.number(), tps: z.number(),
  label: z.string(), badgeText: z.string(), tooltip: z.string(),
});
export type TurnStat = z.infer<typeof turnStatSchema>;
export const rpcContract = defineRpcContract({
  turnStats: {
    input: z.object({ threadIds: z.array(z.string().min(1)).min(1).max(10) }),
    output: z.object({ turns: z.array(turnStatSchema) }),
  },
});

export default async function plugin(alia: AliaPluginApi) {
  const cache = new Map<string, IngestState>();
  const pending = new Map<string, Promise<TurnStat[]>>();
  // VesnALIA caps `threads.events.list` at 100 events per request, so page until the
  // history is drained. Keep the same total budget the old 20x1000 loop had.
  const MAX_EVENTS_PER_REFRESH = 20_000;
  const PAGE_SIZE = 100;
  async function collect(threadId: string): Promise<TurnStat[]> {
    const state = cache.get(threadId) ?? createState();
    cache.delete(threadId);
    cache.set(threadId, state);
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    // Bound each request; subsequent refreshes continue from the cursor.
    for (let page = 0; page * PAGE_SIZE < MAX_EVENTS_PER_REFRESH; page++) {
      const events = await alia.sdk.threads.events.list({
        threadId, afterSeq: String(state.afterSeq), limit: String(PAGE_SIZE), order: "asc",
        types: ["thread/identity", "turn/started", "turn/completed", "thread/tokenUsage/updated"],
      });
      const previous = state.afterSeq;
      ingest(state, events);
      if (events.length < PAGE_SIZE || state.afterSeq === previous) return turnStats(state, threadId);
    }
    return []; // Do not display partial-history accounting.
  }
  alia.rpc.register(rpcContract, {
    async turnStats({ threadIds }) {
      const results = await Promise.all([...new Set(threadIds)].map((threadId) => {
        let request = pending.get(threadId);
        if (!request) {
          request = collect(threadId).catch((error: unknown) => {
            alia.log.warn(`Failed to collect turn stats for ${threadId}: ${String(error)}`);
            return [];
          }).finally(() => pending.delete(threadId));
          pending.set(threadId, request);
        }
        return request;
      }));
      return { turns: results.flat() };
    },
  });
}
