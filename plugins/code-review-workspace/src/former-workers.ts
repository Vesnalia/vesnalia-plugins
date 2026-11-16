import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

/**
 * Threads that were this plugin's agents and are no longer recorded as one: an assistant New conversation or an
 * archive replaced, a guide writer a new generation replaced, and the Suggest instructions worker. Kept in kv, apart
 * from any review's rows, so a record outlives its review's deletion. 0.7.0 ignores the key.
 */
const KEY = "former-workers";
/** The newest records kept. */
export const FORMER_WORKERS_KEPT = 500;
/** The review the Suggest instructions worker belongs to: no review key equals it, so every review is another's. */
export const NO_REVIEW = "(no review)";

export type FormerRole = "assistant" | "writer" | "suggester";
interface FormerWorker { threadId: string; review: string | null; role: FormerRole; at: number }

/** Each plugin load's writes, in order, so a lookup waits for the records started before it. */
const writes = new WeakMap<AliaPluginApi, Promise<void>>();

export function recordFormerWorker(alia: AliaPluginApi, threadId: string, review: string | null, role: FormerRole): Promise<void> {
  const write = (writes.get(alia) ?? Promise.resolve()).then(async () => {
    const kept = (await alia.storage.kv.get<FormerWorker[]>(KEY) ?? []).filter((worker) => worker.threadId !== threadId);
    kept.push({ threadId, review, role, at: Date.now() });
    await alia.storage.kv.set(KEY, kept.slice(-FORMER_WORKERS_KEPT));
  }).catch((error) => alia.log.warn(`Could not record former agent thread ${threadId}: ${String(error)}`));
  writes.set(alia, write);
  return write;
}

/** The review a former worker belonged to, NO_REVIEW for one that had none, or null for a thread that never was one. */
export async function formerWorkerReview(alia: AliaPluginApi, threadId: string): Promise<string | null> {
  await writes.get(alia);
  const worker = (await alia.storage.kv.get<FormerWorker[]>(KEY))?.find((entry) => entry.threadId === threadId);
  return worker ? worker.review ?? NO_REVIEW : null;
}

/** Every former worker's thread, for the thread pages, whose Review changes their pages never offer. */
export async function formerWorkers(alia: AliaPluginApi): Promise<string[]> {
  await writes.get(alia);
  return (await alia.storage.kv.get<FormerWorker[]>(KEY) ?? []).map((worker) => worker.threadId);
}
