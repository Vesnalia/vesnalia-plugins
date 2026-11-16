// src/signals.ts — §7.3. Every successful mutation publishes the directories
// whose contents changed on the `fs` realtime channel.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

import { FS_CHANNEL, type FsSignal } from "../contract";

export type FsReason = FsSignal["reason"];

/**
 * Publish an `fs` signal. Deduplicates and drops empty payloads (§7.3 asks for
 * small payloads); publishing is best-effort and never fails the mutation that
 * triggered it.
 */
export function publishFs(alia: AliaPluginApi, paths: readonly string[], reason: FsReason): void {
  const unique = [...new Set(paths.filter((entry) => typeof entry === "string" && entry !== ""))];
  if (unique.length === 0) return;
  const payload: FsSignal = { paths: unique, reason };
  try {
    alia.realtime.publish(FS_CHANNEL, payload);
  } catch (error) {
    alia.log.warn(`fs signal (${reason}) not published: ${String(error)}`);
  }
}
