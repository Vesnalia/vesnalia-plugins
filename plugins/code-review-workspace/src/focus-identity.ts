import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { FocusThread } from "./focus-model";
import type { AsyncStore } from "./store-queue";
import { assistantReview } from "./draft-comments";

type Identity = Pick<FocusThread, "targetKey" | "runId" | "focusId" | "label">;
const focusSpawning = new WeakMap<AliaPluginApi, Set<Identity & { title: string }>>();

/** Keep identity from session start until the row commits; never enter the assistant/writer spawn set. */
export async function focusSpawningFor<T>(alia: AliaPluginApi, title: string, identity: Identity, run: () => Promise<T>): Promise<T> {
  const entries = focusSpawning.get(alia) ?? new Set();
  focusSpawning.set(alia, entries);
  const entry = { ...identity, title };
  entries.add(entry);
  try { return await run(); } finally { entries.delete(entry); }
}
export function focusSpawnTitled(alia: AliaPluginApi, title: string | null): Identity | null {
  return [...focusSpawning.get(alia) ?? []].find((entry) => entry.title === title) ?? null;
}
export async function focusInFlightTitle(alia: AliaPluginApi, threadId: string): Promise<string | null> {
  if (!focusSpawning.get(alia)?.size) return null;
  return alia.sdk.threads.get({ threadId }).then((thread) => thread.title ?? null, () => null);
}
export async function focusThread(alia: AliaPluginApi, store: AsyncStore, threadId: string): Promise<Identity | null> {
  const recorded = (await store.listFocusThreads()).find((thread) => thread.threadId === threadId);
  if (recorded) return recorded;
  const title = await focusInFlightTitle(alia, threadId);
  if (!focusSpawnTitled(alia, title)) return null;
  return store.exclusive(async (tx) => {
    const committed = (await tx.listFocusThreads()).find((thread) => thread.threadId === threadId);
    if (committed) return committed;
    if (await assistantReview(tx, threadId) || await tx.generationOf(threadId)) return null;
    return focusSpawnTitled(alia, title);
  });
}
