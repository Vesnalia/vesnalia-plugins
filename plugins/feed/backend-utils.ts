import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

type PluginSdk = AliaPluginApi["sdk"];
export type ThreadResponse = Awaited<ReturnType<PluginSdk["threads"]["get"]>>;

export const STALE_MANAGER_MESSAGE =
  "The configured manager thread is archived, deleted, or missing.";

export function isMissingThreadError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("status" in cause)) {
    return false;
  }
  const status = (cause as { status?: unknown }).status;
  return status === 404 || status === 410;
}

export function boundedErrorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.length <= 240 ? message : `${message.slice(0, 239)}…`;
}

/** A thread may receive a cleared context and a new message only when quiet. */
export async function isQuiet(
  sdk: PluginSdk,
  thread: ThreadResponse,
): Promise<boolean> {
  return (
    thread.status === "idle" &&
    thread.queuedMessageCount === 0 &&
    (await sdk.threads.interactions.list({ threadId: thread.id })).length === 0
  );
}
