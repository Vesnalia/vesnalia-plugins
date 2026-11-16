import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { WorkerSpawnArgs } from "./workers-types.js";

export type WorkerThread = Awaited<ReturnType<AliaPluginApi["sdk"]["threads"]["spawn"]>>;
type SpawnArgs = Parameters<AliaPluginApi["sdk"]["threads"]["spawn"]>[0];

/**
 * The single SDK spawn site. Every thread — worker or disposable — is born
 * here, so a seventh spawn path fails the spawn-freshness pin before it
 * ships silently.
 */
export async function spawnThread(
  alia: AliaPluginApi,
  args: SpawnArgs,
): Promise<WorkerThread> {
  return alia.sdk.threads.spawn(args);
}

export async function spawnCardWorker(
  alia: AliaPluginApi,
  args: WorkerSpawnArgs,
): Promise<WorkerThread> {
  // delegation-site: worker-spawn
  return spawnThread(alia, args as SpawnArgs);
}

export async function replaceCardWorker(
  alia: AliaPluginApi,
  args: WorkerSpawnArgs,
  previousThreadId: string | null,
): Promise<WorkerThread> {
  const replacement = await spawnCardWorker(alia, args);
  await stopThread(alia, previousThreadId);
  return replacement;
}

export async function stopThread(alia: AliaPluginApi, threadId: string | null): Promise<void> {
  if (!threadId) return;
  try { await alia.sdk.threads.archive({ threadId }); } catch { /* already gone */ }
  try { await alia.sdk.threads.stop({ threadId }); } catch { /* already gone */ }
}
