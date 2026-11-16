import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export interface QueuedRetry {
  id: string;
  threadId: string;
  sendAt: number | null;
}

export async function listQueuedRetries(
  alia: AliaPluginApi,
  threadId?: string,
): Promise<QueuedRetry[]> {
  const rows = await alia.sdk.threads.queue.list(
    threadId === undefined ? {} : { threadId },
  );
  return rows
    .filter((row) => row.payload.kind === "retry")
    .map((row) => ({
      id: row.id,
      threadId: row.threadId,
      sendAt: row.sendAt,
    }));
}

export async function findQueuedRetry(
  alia: AliaPluginApi,
  threadId: string,
): Promise<QueuedRetry | null> {
  const rows = await listQueuedRetries(alia, threadId);
  return rows[0] ?? null;
}
