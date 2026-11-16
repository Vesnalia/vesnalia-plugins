// Private temp folders for the files workers read: PR diffs and chat context.
// mkdtemp gives each one a random name that only this OS user can open.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

const PREFIX = "pr-xray-";

export function createWorkerDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), PREFIX));
}

/** Deletes a folder from createWorkerDir, and refuses any other path. */
export async function removeWorkerDir(dir: unknown): Promise<void> {
  if (typeof dir !== "string" || dirname(dir) !== tmpdir() || !basename(dir).startsWith(PREFIX)) return;
  // An agent that was just stopped can hold its files open for a moment on Windows.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Deletes the folder a worker thread recorded as `tempDir`. False when it may still be there, so a caller can retry. */
export async function removeThreadDir(alia: AliaPluginApi, threadId: string): Promise<boolean> {
  try {
    const metadata = await alia.sdk.threads.getPluginMetadata({ threadId });
    await removeWorkerDir(metadata.tempDir);
    return true;
  } catch (error) {
    alia.log.warn(`remove temp files of ${threadId}: ${String(error)}`);
    return false;
  }
}

/** shortcut: an archive during a plugin restart leaves its folder for the OS temp cleaner; sweep on load if these pile up. */
export function removeFilesWhenArchived(alia: AliaPluginApi) {
  // This fires for every thread in VesnALIA, so `tempDir` is what marks one as ours.
  alia.events.on("thread.archived", async ({ thread }) => {
    try {
      const { tempDir } = await alia.sdk.threads.getPluginMetadata({ threadId: thread.id });
      if (typeof tempDir !== "string") return;
      // Archiving leaves the agent running, and on Windows it keeps its working folder locked.
      await alia.sdk.threads.stop({ threadId: thread.id }).catch(() => undefined);
      await removeWorkerDir(tempDir);
      if (thread.environmentId === null) return;
      // VesnALIA keeps a record for every folder it is pointed at. A fallback worker's environment is shared, so check it's the copy.
      const environment = await alia.sdk.environments.get({ environmentId: thread.environmentId });
      if (environment.path && dirname(environment.path) === tempDir) await alia.sdk.environments.delete({ environmentId: thread.environmentId });
    } catch (error) {
      alia.log.warn(`clean up after ${thread.id}: ${String(error)}`);
    }
  });
}
