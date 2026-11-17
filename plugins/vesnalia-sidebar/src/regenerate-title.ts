import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

/** A failure that retrying the same thread cannot fix; the message stays user-facing. */
export class PermanentTitleError extends Error {}

interface TitleGenerationOptions {
  onlyIfUntitled?: boolean;
}

/**
 * VesnALIA generates and saves the title with the AI service selected for thread
 * titles, so every service VesnALIA offers works here. VesnALIA's call has no conditional
 * update: a rename made while it runs can be replaced by VesnALIA's title.
 */
export function createTitleRegenerator(alia: AliaPluginApi) {
  const pending = new Map<string, Promise<{ title: string; changed: boolean }>>();
  const controller = new AbortController();

  alia.onDispose(async () => {
    controller.abort();
    await Promise.allSettled([...pending.values()]);
  });

  async function generate(threadId: string, options: TitleGenerationOptions) {
    const original = await alia.sdk.threads.get({ threadId, signal: controller.signal });
    if (options.onlyIfUntitled) {
      if (original.title !== null) throw new PermanentTitleError("The thread already has a title");
      if (original.visibility !== "visible" || original.archivedAt !== null || original.deletedAt !== null)
        throw new PermanentTitleError("The thread is no longer available for automatic naming");
    }
    controller.signal.throwIfAborted();
    const updated = await alia.sdk.threads.experimental_regenerateTitle({ threadId, signal: controller.signal });
    if (!updated.title) throw new Error("alia did not generate a title");
    return { title: updated.title, changed: updated.title !== original.title };
  }

  return (threadId: string, options: TitleGenerationOptions = {}) => {
    const existing = pending.get(threadId);
    if (existing) return existing;
    const task = generate(threadId, options).finally(() => pending.delete(threadId));
    pending.set(threadId, task);
    return task;
  };
}
