/**
 * What the panel lists: VesnALIA decides *who* is waiting, Herald explains *why*.
 *
 * Two sources, joined by thread id. VesnALIA's own state — the sidebar's unread dot
 * and its "waiting for input" — decides who is listed, live, without a round
 * trip; Herald's entries add the reason and the sentence. A thread VesnALIA flags
 * that Herald has no entry for (an event from before the plugin was watching,
 * say) is still listed, with what VesnALIA knows.
 */
import type { PluginSidebarThreadIndicator } from "@vesnalia/plugin-sdk/app";

import type { AttentionEntry, AttentionReason } from "../shared/herald";

/** The fields of VesnALIA's sidebar thread this join reads. */
export interface ThreadState {
  id: string;
  projectId: string;
  displayTitle: string;
  status: string;
  isHidden: boolean;
  isArchived: boolean;
  isUnread: boolean;
  hasPendingInteraction: boolean;
  indicator: PluginSidebarThreadIndicator;
  latestAttentionAt: number;
}

/** A row's reason: one of Herald's, or what VesnALIA alone says. */
export type RowReason = AttentionReason | "input" | "attention";

export interface Row {
  threadId: string;
  projectId: string;
  title: string;
  reason: RowReason;
  /** Epoch ms the row sorts by: the event, or when VesnALIA last flagged the thread. */
  at: number;
  entry: AttentionEntry | null;
  /** VesnALIA's status for the thread, drawn with VesnALIA's own glyph; null while VesnALIA's list is loading. */
  indicator: PluginSidebarThreadIndicator | null;
}

/**
 * How long a fresh entry is listed even once its thread reads as seen: the
 * user may be looking at the thread as it finishes, and the sentence should
 * still reach the panel. The same grace the server's liveness uses.
 */
export const FRESH_ENTRY_MS = 15_000;

function isWorking(thread: ThreadState): boolean {
  return (thread.status === "active" || thread.status === "starting") && !thread.hasPendingInteraction;
}

function isFlagged(thread: ThreadState): boolean {
  return !thread.isHidden && !thread.isArchived && (thread.isUnread || thread.hasPendingInteraction);
}

/**
 * Whether an entry still describes its thread. An entry for an interaction
 * lasts while VesnALIA says the thread waits for input — answering it fires nothing
 * Herald hears, so this is what takes it off the panel at once. A finish on a
 * thread that is working again is hidden: some providers report a turn as
 * finished and carry on.
 */
function isCurrentEntry(entry: AttentionEntry, thread: ThreadState, now: number): boolean {
  if (thread.isArchived) return false;
  if (entry.requestId !== null) return thread.hasPendingInteraction;
  if (entry.reason === "finished" && isWorking(thread)) return false;
  if (isFlagged(thread)) return true;
  return now - Date.parse(entry.createdAt) < FRESH_ENTRY_MS;
}

function reasonFromAlia(thread: ThreadState): RowReason {
  if (thread.hasPendingInteraction) return "input";
  if (thread.indicator === "unread-error") return "error";
  if (thread.indicator === "unread-success") return "finished";
  return "attention";
}

/**
 * The panel's rows, newest first. `threads` is null while VesnALIA's thread list is
 * still loading, and then Herald's entries are shown as they are.
 */
export function joinRows(entries: readonly AttentionEntry[], threads: readonly ThreadState[] | null, now: number): Row[] {
  const byId = new Map((threads ?? []).map((thread) => [thread.id, thread]));
  const rows = new Map<string, Row>();
  for (const entry of entries) {
    const thread = byId.get(entry.threadId);
    if (threads !== null && (thread === undefined || !isCurrentEntry(entry, thread, now))) continue;
    rows.set(entry.threadId, {
      threadId: entry.threadId,
      projectId: entry.projectId,
      title: thread?.displayTitle ?? entry.threadTitle ?? entry.projectName ?? "A thread",
      reason: entry.reason,
      at: Date.parse(entry.createdAt),
      entry,
      indicator: thread?.indicator ?? null,
    });
  }
  for (const thread of threads ?? []) {
    if (rows.has(thread.id) || !isFlagged(thread) || isWorking(thread)) continue;
    rows.set(thread.id, {
      threadId: thread.id,
      projectId: thread.projectId,
      title: thread.displayTitle,
      reason: reasonFromAlia(thread),
      at: thread.latestAttentionAt,
      entry: null,
      indicator: thread.indicator,
    });
  }
  return [...rows.values()].sort((a, b) => b.at - a.at);
}
