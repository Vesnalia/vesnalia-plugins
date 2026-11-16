// Per-thread percentage handoff, queued after the active turn.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const STAGES = ["watching", "preparing", "handed-off"] as const;
export type Stage = (typeof STAGES)[number];

export interface ThreadState {
  enabled: boolean;
  /** `handed-off` exactly when `nextThreadId` is set (readState enforces it). */
  stage: Stage;
  /** Usage when the notes were requested; a stalled request is re-sent. */
  preparingAtTokens: number | null;
  /** When the notes were requested (ms); notes older than this are stale. */
  preparingAt: number | null;
  /** Id of the first thread in the chain; names the notes folder. */
  chainId: string;
  /** 1 for the first thread, 2 for its continuation, and so on. */
  part: number;
  previousThreadId: string | null;
  nextThreadId: string | null;
  /**
   * Names one notes request. HANDOFF.md must quote it, and the next thread
   * proves it read those notes by passing it to `resume`.
   */
  checkpointId: string | null;
  /**
   * A start attempt, saved before the next thread is created so that a lost
   * reply, a failed save or a reload finds that thread instead of making another.
   */
  handoffOp: string | null;
  handoffOpAt: number | null;
  /** The next thread has confirmed it read this thread's checkpoint. */
  nextConfirmed: boolean;
  /** On a continuation: the start attempt that created it (null before 0.3). */
  createdByOp: string | null;
  /**
   * On a continuation: the checkpoint it was started for, so it can still
   * confirm if the earlier thread (and its metadata) is deleted meanwhile.
   */
  parentCheckpointId: string | null;
  /** On a continuation: it has confirmed its checkpoint, or predates confirmation. */
  confirmed: boolean;
  /** On a continuation: cancelled (archived, deleted or superseded) before confirming. */
  abandoned: boolean;
  /** Start attempts made for the current notes request. */
  handoffAttempts: number;
  /** A notes request saved by a version without checkpoint ids; it is sent again. */
  legacyRequest: boolean;
  /**
   * The user switched this thread on: hand off at the next safe stopping
   * point after enabling at or above 20%. Kept while the request runs (for its wording);
   * only ever true while the switch is on.
   */
  requested: boolean;
}

/** Usage growth after a notes request that counts as the request stalling. */
const STALL_TOKENS = 20_000;
/** Seconds a switch-on check keeps retrying while another step holds the thread. */
const SWITCH_ON_RETRIES = 30;
/** Start attempts per notes request before `ready` asks the agent to tell the user. */
export const MAX_START_ATTEMPTS = 3;
/** Timings; tests shorten them. */
export const timing = {
  /**
   * How long an unanswered or failed start attempt holds off another one. BB's
   * spawn has no idempotency key, so a second attempt is made only after this
   * wait and a search that finds no thread from the first.
   */
  startHoldMs: 60_000,
  /** How long `ready` waits for a new thread to leave pending/starting. */
  startWaitMs: 15_000,
  pollMs: 1_000,
  /** BB lets an archive be undone for this long (its ARCHIVE_UNDO_GRACE_MS). */
  archiveGraceMs: 30_000,
  /**
   * How long a new thread's failed first turn is watched for an automatic
   * retry (BB's provider-retry queues one a few seconds after the failure).
   */
  errorGraceMs: 8_000,
  /**
   * How often a switch-on request that has not gone out yet (the thread was
   * busy, failed, or the send failed) is tried again while its banner polls.
   */
  requestRetryMs: 5_000,
};

/** Plugin storage keys of pending "run ready again" reminders, by thread. */
const REMINDER_PREFIX = "reminder/";
const SWITCHED_OFF_MESSAGE = "Not handed off: automatic handoff was switched off while the next part was starting, so that part was cancelled. Continue in this thread.";

/** Queued-message states that mean BB will run the thread again by itself. */
const RETRY_STATES = ["queued", "scheduled", "waiting", "failed_retrying"];

/** The HTTP status of a BB SDK error (BbHttpError), or null for no reply. */
export function httpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * BB answered a spawn with a client error, which it sends before creating a
 * thread (or after removing one whose first dispatch failed): nothing exists.
 * Timeouts and server errors stay uncertain.
 */
function definitelyRefused(error: unknown): boolean {
  const status = httpStatus(error);
  return status !== null && status >= 400 && status < 500 && status !== 408;
}

/** Printed by `ready` on success; agents look for this, not the exit code. */
export const SUCCESS_MARKER = "HANDOFF_OK";
/** Printed by `resume` once the next thread has confirmed its checkpoint. */
export const RESUME_MARKER = "RESUME_OK";

export function newCheckpointId(): string {
  return `ck_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Accepts `ck_…`, a pasted `Checkpoint: ck_…` line, or a quoted id. */
export function cleanCheckpointArg(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return /ck_[0-9a-f]{12}/i.exec(value)?.[0]?.toLowerCase() ?? value;
}

/** "150k" -> 150000, "1.5m" -> 1500000, "150000" -> 150000; null if invalid. */
export function parseTokenLimit(raw: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(raw);
  if (!match) return null;
  const unit = match[2]!.toLowerCase();
  const value = Math.round(
    Number(match[1]) * (unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1),
  );
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A safe notes folder: relative and inside the workspace, else ".handoff". */
export function cleanDocsDir(raw: string): string {
  const value = raw.trim().replace(/[\\/]+$/, "");
  const unsafe =
    value === "" ||
    isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.split(/[\\/]/).includes("..");
  return unsafe ? ".handoff" : value;
}

/** 160562 -> "161k". */
export function formatTokens(value: number): string {
  return `${Math.round(value / 1_000)}k`;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 200) || "Unknown error.";
}

/** Reads this plugin's state out of a thread's (untrusted) metadata. */
export function readState(
  threadId: string,
  raw: Readonly<Record<string, unknown>>,
): ThreadState {
  const id = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)
      ? value
      : null;
  const tokens = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null;
  const nextThreadId = id(raw.nextThreadId);
  let stage: Stage = STAGES.includes(raw.stage as Stage)
    ? (raw.stage as Stage)
    : "watching";
  // A recorded next thread means the handoff happened, whatever stage says.
  if (nextThreadId !== null) stage = "handed-off";
  else if (stage === "handed-off") stage = "watching";
  // Old planning checkpoints must be refreshed in the unified format.
  if (stage === "preparing" && raw.preparingMode === "planning" && typeof raw.enabled !== "boolean") stage = "watching";
  const checkpointId = id(raw.checkpointId);
  // A request from before checkpoint ids is sent again in the current format.
  const legacyRequest = stage === "preparing" && checkpointId === null;
  if (legacyRequest) stage = "watching";
  const part =
    typeof raw.part === "number" && Number.isInteger(raw.part) && raw.part > 0
      ? raw.part
      : 1;
  const handoffOp = id(raw.handoffOp);
  const createdByOp = id(raw.createdByOp);
  const abandoned = raw.abandoned === true;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : raw.mode === "build" || raw.mode === "planning";
  return {
    enabled,
    stage,
    preparingAtTokens: tokens(raw.preparingAtTokens),
    preparingAt: tokens(raw.preparingAt),
    chainId: id(raw.chainId) ?? threadId,
    part,
    previousThreadId: id(raw.previousThreadId),
    nextThreadId,
    checkpointId,
    handoffOp,
    handoffOpAt: tokens(raw.handoffOpAt),
    // Links recorded before start attempts existed were never asked to confirm.
    // Every start attempt saves nextConfirmed, so only those lack the key.
    nextConfirmed: nextThreadId !== null && (raw.nextConfirmed === true || (!("nextConfirmed" in raw) && handoffOp === null)),
    createdByOp,
    parentCheckpointId: id(raw.parentCheckpointId),
    // So were continuations created before then.
    confirmed: !abandoned && (raw.confirmed === true || createdByOp === null),
    abandoned,
    handoffAttempts:
      typeof raw.handoffAttempts === "number" && Number.isInteger(raw.handoffAttempts) && raw.handoffAttempts > 0
        ? raw.handoffAttempts
        : 0,
    legacyRequest,
    requested: enabled && raw.requested === true,
  };
}

/** The notes folder for a chain: absolute when the workspace path is known. */
export function notesDir(
  docsDir: string,
  chainId: string,
  workspacePath: string | null,
): string {
  const relative = `${docsDir}/${chainId}`;
  return workspacePath === null
    ? relative
    : join(workspacePath, relative).replace(/\\/g, "/");
}

const REQUIRED_FILES = ["PLAN.md", "HANDOFF.md"];

/** Allowance for coarse file-system timestamps. */
const MTIME_SLACK_MS = 2_000;

function excludeStep(docsDir: string): string {
  return `If this folder is a git repository, keep the notes out of git: add a \`${docsDir}/\` line to the file that \`git rev-parse --git-path info/exclude\` prints (unless it is already ignored). Do this before any commit.`;
}

function readyStep(): string {
  return `Run \`bb context-handoff ready\`. Trust the line it prints, not the exit code (BB's CLI on Windows can exit with an error after printing it). A line starting with ${SUCCESS_MARKER} means the next thread has started: give the user its link in one line and stop working in this thread. "Not handed off" says what to fix, whether to wait and run it again, or whether to stop and tell the user; do exactly that. Never start another thread yourself.`;
}

export function prepareMessage(args: {
  dir: string; docsDir: string; used: string | null; limit: string; reminder: boolean; checkpointId: string;
  /** The user switched handoff on, rather than usage reaching the target. */
  requested?: boolean;
}): string {
  const { dir, docsDir, used, limit, reminder, checkpointId, requested = false } = args;
  const why = requested
    ? `The user switched on handoff for this thread${used === null ? "" : ` (about ${used} tokens used)`}.`
    : `This thread is at about ${used ?? "an unknown number of"} tokens (handoff target ${limit}).`;
  return [
    `[Context Handoff] ${reminder ? "Reminder: " : ""}${why} Continue in a fresh session after a safe stopping point.`,
    "Finish the current turn and any important step in progress, including its verification, before preparing a handoff. Wait for running tools and dependent operations to finish; do not interrupt them, discard work, or abandon a step midway. Then save a consistent checkpoint before starting another unit of work. This applies equally to planning, research, and implementation.",
    `1. Make sure '${dir}/PLAN.md' contains the user's original request word for word, all later requirements and corrections, and the current plan. Preserve the original wording. Reference existing project plans. If upgrading from PLANNING-NOTES.md, bring its decisions and unanswered questions forward.`,
    `2. Write a fresh '${dir}/HANDOFF.md'. Its first line must be exactly \`Checkpoint: ${checkpointId}\` (the next thread uses it to prove it read these notes). Then: what is done, the exact next action, decisions and reasons, approaches ruled out, unanswered questions, relevant file paths, verification results, and running background work. Preserve enough detail to resume accurately. Describe the task, not the handoff commands. If the task is complete, say so explicitly.`,
    `3. ${excludeStep(docsDir)}`,
    "4. Save the work itself. Follow the project's commit rules; a handoff does not authorize a merge, deployment, or any other new action.",
    `5. ${readyStep()}`,
    "If handoff was switched off, stop preparing and continue the user's work in this thread. Do not turn it back on yourself.",
  ].join("\n\n");
}

function resumeStep(): string {
  return `Once, at the start of this thread and before any other work, confirm the checkpoint (skip this if this thread already printed ${RESUME_MARKER}). HANDOFF.md begins with a line \`Checkpoint: <id>\`; run \`bb context-handoff resume <id>\` with that id. Trust the line it prints, not the exit code. Continue only after it prints ${RESUME_MARKER}. If either file is missing or empty, the Checkpoint line is missing, or it prints "Not resumed", do what that line says; if it says to stop, tell the user in one line and stop. Do not rebuild the work from memory or from the earlier thread.`;
}

export function continuationPrompt(args: {
  dir: string; previousThreadId: string; part: number;
}): string {
  const { dir, previousThreadId, part } = args;
  return [
    `Continuing @thread:${previousThreadId} (part ${part}) in a fresh session.`,
    `First read '${dir}/PLAN.md' for the original goal and requirements, then '${dir}/HANDOFF.md' for the current state and exact next step. Preserve the user's instructions, decisions, and scope. Read the earlier thread only if the notes leave a specific gap.`,
    resumeStep(),
    "Continue from the recorded next step. If an unanswered user question blocks it, wait for the answer. If the task is already complete, report that and stop. Do not invent additional work or repeat finished work.",
    "Apart from `resume`, do not run any `bb context-handoff` command unless a [Context Handoff] message asks you to. Never enable handoff or initiate it yourself.",
  ].join("\n\n");
}

export function continuationInstructions(dir: string, needsResume = false): string {
  return [
    `Context Handoff: this thread continues earlier work. Read '${dir}/PLAN.md' and '${dir}/HANDOFF.md' before continuing. For an older planning continuation, also read PLANNING-NOTES.md if present. Preserve the goal, decisions and open questions.`,
    ...(needsResume ? [resumeStep()] : []),
    `${needsResume ? "Apart from `resume`, do" : "Do"} not run any bb context-handoff command unless a [Context Handoff] message asks you to.`,
  ].join(" ");
}

/**
 * The next thread, seen from the thread that handed off: `starting` until it
 * confirms its checkpoint, `failed` while BB reports its turn failed with no
 * retry queued, `stalled` when it went idle without confirming.
 */
export const NEXT_STATES = ["starting", "confirmed", "failed", "stalled"] as const;
export type NextState = (typeof NEXT_STATES)[number];

export const viewSchema = z.object({
  threadId: z.string(),
  autoHandoff: z.boolean(),
  stage: z.enum(STAGES),
  part: z.number().int().positive(),
  nextThreadId: z.string().nullable(),
  /** Set exactly when nextThreadId is. */
  next: z.enum(NEXT_STATES).nullable(),
  /** A start attempt is in progress, or its outcome is still being checked. */
  creating: z.boolean(),
  /** A start attempt's outcome was never settled; the agent should run ready again. */
  stuck: z.boolean(),
  /** Switched on by the user: a handoff at the next safe stopping point is pending or running. */
  requested: z.boolean(),
  usedTokens: z.number().nullable(),
  limit: z.number().nullable(),
  contextWindow: z.number().nullable(),
  enabled: z.boolean(),
  eligible: z.boolean(),
});
export type HandoffView = z.infer<typeof viewSchema>;

export const rpcContract = defineRpcContract({
  state: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: viewSchema,
  },
  set_enabled: {
    input: z.object({ threadId: z.string().min(1), enabled: z.boolean() }).strict(),
    output: z.object({ ok: z.boolean(), result: z.string(), view: viewSchema }),
  },
});

/** Realtime channel the composer banner listens on (app.tsx repeats it). */
export const STATE_CHANGED = "state-changed";

/** Sub-agent, hidden and archived threads are left alone. */
export function isEligible(thread: {
  parentThreadId: string | null;
  visibility: string;
  archivedAt: number | null;
  originPluginId?: string | null;
}): boolean {
  return (
    (thread.parentThreadId === null || thread.originPluginId === "context-handoff") &&
    thread.visibility === "visible" &&
    thread.archivedAt === null
  );
}

interface StepResult {
  ok: boolean;
  message: string;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Hand off long threads",
      description:
        "Allow safe handoffs at 30% of the context window. Enabling at or above 20% requests the next safe stopping point after the current turn.",
      default: true,
    },
    docsDir: {
      type: "string",
      label: "Notes folder",
      description:
        "Folder, relative to the workspace, for each chain's PLAN.md and HANDOFF.md.",
      default: ".handoff",
    },
  });
  let cached = await settings.get();
  const warnSettings = () => {
    const requested = cached.docsDir.trim().replace(/[\\/]+$/, "");
    if (cleanDocsDir(cached.docsDir) !== requested) {
      bb.log.warn(
        `Context handoff: notes folder "${cached.docsDir}" is not a safe relative path; using .handoff.`,
      );
    }
  };
  warnSettings();
  settings.onChange((next) => {
    cached = next;
    warnSettings();
  });

  const docsDir = () => cleanDocsDir(cached.docsDir);

  /** Threads with a handoff step in progress. */
  const inFlight = new Set<string>();
  const lastChecked = new Map<string, number>();
  /** When a pending switch-on request was last tried, by thread. */
  const lastNudged = new Map<string, number>();
  let disposed = false;
  /**
   * Continuations started by this process, kept even if recording them in
   * metadata failed, so nothing here starts a second one.
   */
  const spawned = new Map<string, string>();
  /** Pending timers (archive grace checks, ready reminders), cleared on dispose. */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function later(delayMs: number, run: () => void): void {
    if (disposed) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) run();
    }, delayMs);
    timers.add(timer);
  }

  async function loadStateKnown(threadId: string): Promise<ThreadState> {
    const state = await loadState(threadId);
    const nextId = spawned.get(threadId);
    return nextId !== undefined && state.nextThreadId === null
      ? { ...state, stage: "handed-off", nextThreadId: nextId }
      : state;
  }

  async function loadState(threadId: string): Promise<ThreadState> {
    const raw = await bb.sdk.threads.getPluginMetadata({
      threadId,
      pluginId: bb.pluginId,
    });
    return readState(threadId, raw ?? {});
  }

  async function saveState(
    threadId: string,
    patch: Partial<ThreadState>,
  ): Promise<void> {
    const set: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) set[key] = value;
    }
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      pluginId: bb.pluginId,
      set,
      remove: ["preparingMode", "snoozeUntilTokens"],
    });
  }

  async function readUsage(threadId: string): Promise<{ used: number | null; window: number | null }> {
    try {
      const context = await bb.sdk.threads.context({ threadId });
      const used = context.usage?.usedTokens;
      const window = context.usage?.modelContextWindow;
      return {
        used: typeof used === "number" && Number.isFinite(used) && used >= 0 ? used : null,
        window: typeof window === "number" && Number.isFinite(window) && window > 0 ? window : null,
      };
    } catch (error) {
      bb.log.warn(
        `Context handoff: could not read usage for ${threadId}: ${errorMessage(error)}`,
      );
      return { used: null, window: null };
    }
  }

  async function workspacePath(
    environmentId: string | null,
  ): Promise<string | null> {
    if (environmentId === null) return null;
    try {
      const environment = await bb.sdk.environments.get({ environmentId });
      return environment.path ?? null;
    } catch (error) {
      bb.log.warn(
        `Context handoff: could not read environment ${environmentId}: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /** `retry`: try a pending switch-on request again (not for a step's own publish). */
  async function view(threadId: string, retry = true): Promise<HandoffView> {
    const [thread, loaded, usage] = await Promise.all([
      bb.sdk.threads.get({ threadId }),
      loadStateKnown(threadId),
      readUsage(threadId),
    ]);
    let state = loaded;
    let next: NextState | null = null;
    if (state.nextThreadId !== null) {
      const health = state.nextConfirmed ? "confirmed" : await nextHealth(state.nextThreadId);
      // A missed archive/delete event: cancel here so the banner is not stuck.
      if (health === "gone" && !inFlight.has(threadId)) {
        try {
          await abandon(threadId, state.nextThreadId);
          state = await loadStateKnown(threadId);
        } catch (error) {
          bb.log.warn(`Context handoff: could not cancel ${threadId}'s removed continuation: ${errorMessage(error)}`);
        }
      }
      if (state.nextThreadId !== null) next = health === "gone" ? "failed" : health;
    }
    // A switch-on request that has not gone out yet is tried again while the
    // banner polls, so a skipped or failed first try, a reload or the global
    // setting coming back on does not leave an idle thread waiting.
    if (retry && state.enabled && state.stage === "watching" && isEligible(thread)) nudge(threadId);
    return {
      threadId,
      autoHandoff: state.enabled,
      stage: state.stage,
      part: state.part,
      nextThreadId: state.nextThreadId,
      next,
      creating: state.stage === "preparing" && state.handoffOp !== null && (attemptIsRecent(state) || inFlight.has(threadId)),
      stuck: state.stage === "preparing" && state.handoffOp !== null && !attemptIsRecent(state) && !inFlight.has(threadId),
      requested: state.requested && state.stage !== "handed-off",
      usedTokens: usage.used,
      contextWindow: usage.window,
      limit: usage.window === null ? null : usage.window * 0.3,
      enabled: cached.enabled,
      eligible: isEligible(thread),
    };
  }

  function attemptIsRecent(state: ThreadState): boolean {
    return Date.now() - (state.handoffOpAt ?? 0) < timing.startHoldMs;
  }

  /**
   * How an unconfirmed next thread is doing. `gone` means deleted, or archived
   * for longer than BB's undo window; an unreadable thread counts as starting.
   */
  async function nextHealth(nextId: string): Promise<Exclude<NextState, "confirmed"> | "gone"> {
    let next: Awaited<ReturnType<typeof bb.sdk.threads.get>>;
    try {
      next = await bb.sdk.threads.get({ threadId: nextId });
    } catch (error) {
      // BB answers 404 for a deleted thread.
      if (httpStatus(error) === 404) return "gone";
      bb.log.warn(`Context handoff: could not read continuation ${nextId}: ${errorMessage(error)}`);
      return "starting";
    }
    if ((next.deletedAt ?? null) !== null) return "gone";
    if (next.archivedAt !== null && Date.now() - next.archivedAt >= timing.archiveGraceMs) return "gone";
    if (readState(nextId, (await readMetadataAny(nextId)) ?? {}).abandoned) return "gone";
    // A failed turn with a pending retry (e.g. BB's provider-retry) is still starting.
    if (next.status === "error") return (await retryPending(nextId, next.queuedMessageCount)) ? "starting" : "failed";
    // A new thread is pending/starting/active until its first turn ends.
    if (next.status === "idle") return "stalled";
    return "starting";
  }

  /** BB will run this thread again by itself: a queued, scheduled or retrying message. */
  async function retryPending(threadId: string, queuedCount: number | undefined): Promise<boolean> {
    if (queuedCount === 0) return false;
    try {
      const rows = await bb.sdk.threads.queuedMessages.list({ threadId });
      return rows.some((row) => RETRY_STATES.includes(row.state));
    } catch (error) {
      bb.log.warn(`Context handoff: could not read ${threadId}'s queue: ${errorMessage(error)}`);
      return (queuedCount ?? 0) > 0;
    }
  }

  /**
   * A thread's metadata, also for a recently deleted thread (whose own route
   * answers 404). Null when there is none: BB purges a deleted thread's row,
   * and its metadata with it, once its storage is gone.
   */
  async function readMetadataAny(threadId: string): Promise<Record<string, unknown> | null> {
    const rows = await bb.sdk.threads.experimental_listPluginMetadata({ threadIds: [threadId] });
    return rows.threads.find((row) => row.threadId === threadId)?.metadata ?? null;
  }

  type ThreadRow = Awaited<ReturnType<typeof bb.sdk.threads.list>>[number];

  /**
   * Unarchived, uncancelled threads that start attempt `op` created for
   * `source`, oldest first. A thread's plugin metadata is seeded when BB creates
   * it, so this finds one whose spawn reply was lost or never recorded. Threads
   * from other attempts or older versions never match.
   */
  async function findContinuations(source: { id: string; projectId: string }, op: string): Promise<ThreadRow[]> {
    const page = 100;
    const matches: ThreadRow[] = [];
    for (let offset = 0; ; offset += page) {
      if (offset >= 10_000) throw new Error("too many threads to check for an existing continuation");
      const listed = await bb.sdk.threads.list({
        projectId: source.projectId, originPluginId: bb.pluginId,
        includeHidden: true, archived: false, limit: page, offset,
      });
      const rows = listed.filter((row) => row.id !== source.id && row.archivedAt === null && (row.deletedAt ?? null) === null);
      if (rows.length > 0) {
        const metadata = await bb.sdk.threads.experimental_listPluginMetadata({ threadIds: rows.map((row) => row.id) });
        for (const row of rows) {
          const candidate = readState(row.id, metadata.threads.find((m) => m.threadId === row.id)?.metadata ?? {});
          if (candidate.previousThreadId === source.id && candidate.createdByOp === op && !candidate.abandoned) matches.push(row);
        }
      }
      // Page on what BB returned, not on what survived the filter.
      if (listed.length < page) break;
    }
    matches.sort((a, b) => a.createdAt - b.createdAt);
    if (matches.length > 1) {
      bb.log.warn(`Context handoff: start attempt ${op} for ${source.id} created ${matches.length} threads (${matches.map((m) => m.id).join(", ")}); using the first.`);
    }
    return matches;
  }

  async function findContinuation(source: { id: string; projectId: string }, op: string): Promise<ThreadRow | null> {
    return (await findContinuations(source, op))[0] ?? null;
  }

  /** A continuation that must no longer claim or continue the handoff. */
  async function cancelContinuation(threadId: string): Promise<void> {
    try {
      await saveState(threadId, { abandoned: true, enabled: false });
    } catch (error) {
      // A deleted thread refuses; it cannot run anyway.
      bb.log.warn(`Context handoff: could not mark ${threadId} as cancelled: ${errorMessage(error)}`);
    }
  }

  /**
   * Retire an unresolved start attempt before this thread is told to carry on,
   * so no thread from it can take over later: the attempt is cleared first
   * (a late thread then fails `resume`), then any thread it made is cancelled.
   */
  async function cancelAttempt(threadId: string, state: ThreadState, projectId: string): Promise<ThreadState> {
    if (state.handoffOp === null || state.nextThreadId !== null) return state;
    await saveState(threadId, { handoffOp: null, handoffOpAt: null, handoffAttempts: 0 });
    for (const row of await findContinuations({ id: threadId, projectId }, state.handoffOp)) {
      // One that already confirmed has taken over; the caller sees the link below.
      if (readState(row.id, (await readMetadataAny(row.id)) ?? {}).confirmed) continue;
      await cancelContinuation(row.id);
      bb.log.info(`Context handoff: cancelled ${row.id}, started for ${threadId} by an abandoned attempt.`);
    }
    return loadStateKnown(threadId);
  }

  /**
   * An unconfirmed next thread is cancelled and, if it was this thread's
   * recorded continuation, this thread is usable again with a fresh request
   * needed. After an archive or delete of the part its switch is turned off,
   * so a failing start is not repeated automatically; `keepSwitch` is for a
   * cancellation caused by the switches themselves.
   */
  async function abandon(sourceId: string, nextId: string, keepSwitch = false): Promise<StepResult> {
    await cancelContinuation(nextId);
    const source = await loadStateKnown(sourceId);
    if (source.nextThreadId !== nextId || source.nextConfirmed) {
      return { ok: true, message: `cancelled ${nextId}; ${sourceId} was not waiting for it` };
    }
    spawned.delete(sourceId);
    await saveState(sourceId, {
      ...(keepSwitch ? {} : { enabled: false }), stage: "watching", nextThreadId: null, nextConfirmed: false,
      handoffOp: null, handoffOpAt: null, handoffAttempts: 0, checkpointId: null,
      // A cancelled handoff is not requested again by itself.
      preparingAt: null, preparingAtTokens: null, requested: false,
    });
    bb.log.info(`Context handoff: ${nextId} was removed before confirming; ${sourceId} is no longer handed off and its switch is off.`);
    return { ok: true, message: `cancelled the handoff to ${nextId}` };
  }

  /**
   * End this thread's notes request (the agent is told to carry on here): a
   * later handoff needs a fresh request, checkpoint id and notes. A switch-on
   * request ends with it, so it is not made again by itself (for example when
   * the global setting comes back on), unless `keepRequest` says the request
   * only has to wait.
   */
  async function retireRequest(threadId: string, keepRequest = false): Promise<void> {
    await saveState(threadId, {
      stage: "watching", preparingAt: null, preparingAtTokens: null, checkpointId: null,
      handoffOp: null, handoffOpAt: null, handoffAttempts: 0,
      ...(keepRequest ? {} : { requested: false }),
    });
  }

  async function publish(threadId: string): Promise<void> {
    if (disposed) return;
    try {
      // A step's own update never starts the next try, so retries cannot chain.
      bb.realtime.publish(STATE_CHANGED, await view(threadId, false));
    } catch (error) {
      bb.log.warn(
        `Context handoff: could not publish state for ${threadId}: ${errorMessage(error)}`,
      );
    }
  }

  async function sendToThread(threadId: string, text: string): Promise<void> {
    await bb.sdk.threads.send({
      threadId,
      mode: "queue-if-active",
      input: [{ type: "text", text, mentions: [] }],
    });
  }

  /** Ask the thread's agent to write its notes and run `ready`. */
  async function prepare(threadId: string): Promise<StepResult> {
    const thread = await bb.sdk.threads.get({ threadId });
    const state = await loadStateKnown(threadId);
    const skip = (message: string) => ({ ok: true, message: `skipped: ${message}` });
    if (state.createdByOp !== null && !state.confirmed && !state.abandoned) return skip("continuation has not confirmed its checkpoint");
    if (state.stage === "handed-off") return skip(`already handed off to ${state.nextThreadId}`);
    if (!cached.enabled || !state.enabled) return skip("automatic handoff is off");
    // A saved switch-on request asks for a safe handoff after this turn. It
    // also reaches a thread whose last turn failed: the request starts a turn.
    const requestedNow = state.stage !== "preparing" && state.requested;
    const statuses = requestedNow ? ["idle", "active", "error"] : ["idle", "active"];
    if (!isEligible(thread) || !statuses.includes(thread.status)) {
      return skip("thread is not ready for an automatic checkpoint");
    }
    // A start attempt for this request may have created the next thread
    // without recording it. Find it rather than asking for notes again.
    if (state.stage === "preparing" && state.handoffOp !== null) {
      const existing = await findContinuation(thread, state.handoffOp);
      if (existing !== null) {
        const after = await loadStateKnown(threadId);
        if (after.nextThreadId === null && (after.handoffOp !== state.handoffOp || !cached.enabled || !after.enabled || after.stage !== "preparing")) {
          // Switched off during the lookup: the part is cancelled, not linked.
          await cancelContinuation(existing.id);
          if (after.handoffOp === state.handoffOp) await saveState(threadId, { handoffOp: null, handoffOpAt: null });
          return skip("switched off while finding the next part; cancelled it");
        }
        if (after.nextThreadId === null) await record(threadId, existing.id);
        return skip(`already continued in ${after.nextThreadId ?? existing.id}`);
      }
      if (attemptIsRecent(state)) return skip("a start attempt may still be finishing");
    }
    const usage = await readUsage(threadId);
    const used = usage.used;
    const limit = usage.window === null ? null : usage.window * 0.3;
    const reminder = state.stage === "preparing";
    if (reminder && thread.status === "active") return skip("waiting for the current turn and queued checkpoint request");
    if (used === null && !requestedNow) return skip("usage unavailable");
    if (limit === null && !requestedNow && !reminder) return skip("context window unavailable");
    if (reminder && used !== null && state.preparingAtTokens === null) {
      // Requested while usage was unknown: measure the stall from now on.
      await saveState(threadId, { preparingAtTokens: used });
      return skip("waiting for checkpoint notes");
    }
    if (reminder && used !== null && used < (state.preparingAtTokens ?? limit ?? used) + STALL_TOKENS) return skip("waiting for checkpoint notes");
    if (!reminder && !requestedNow && used !== null && limit !== null && used < limit) return skip("below the handoff target");
    if ((await bb.sdk.threads.interactions.list({ threadId })).length > 0) return skip("waiting for user input");
    const dir = notesDir(
      docsDir(),
      state.chainId,
      await workspacePath(thread.environmentId),
    );
    const beforePrepare = await loadStateKnown(threadId);
    if (!cached.enabled || !beforePrepare.enabled) return skip("automatic handoff was switched off");
    // A new request must not inherit a start attempt from an earlier one.
    if (!reminder && (await cancelAttempt(threadId, state, thread.projectId)).nextThreadId !== null) {
      return skip("an earlier attempt's thread confirmed meanwhile");
    }
    // A reminder keeps the request's checkpoint; a new request gets its own.
    const checkpointId = reminder && state.checkpointId !== null ? state.checkpointId : newCheckpointId();
    await saveState(threadId, {
      stage: "preparing",
      preparingAtTokens: used,
      preparingAt: Date.now(),
      chainId: state.chainId,
      checkpointId,
      ...(reminder ? {} : { handoffAttempts: 0 }),
    });
    // The switch is independent of the long-running check. Never dispatch from
    // an earlier On snapshot after a cancellation was saved.
    const beforeSend = await loadStateKnown(threadId);
    if (!cached.enabled || !beforeSend.enabled) {
      await saveState(threadId, { stage: "watching", preparingAtTokens: null, preparingAt: null });
      return skip("automatic handoff was switched off");
    }
    try {
      await sendToThread(
        threadId,
        prepareMessage({
          dir,
          docsDir: docsDir(),
          used: used === null ? null : formatTokens(used),
          limit: limit === null ? "30% of the context window" : formatTokens(limit),
          reminder,
          checkpointId,
          requested: state.requested,
        }),
      );
    } catch (error) {
      bb.log.error(
        `Context handoff: could not message ${threadId}: ${errorMessage(error)}`,
      );
      try {
        await saveState(threadId, {
          stage: state.stage,
          preparingAtTokens: state.preparingAtTokens,
          preparingAt: state.preparingAt,
          checkpointId: state.checkpointId,
        });
      } catch (rollback) {
        bb.log.error(
          `Context handoff: could not reset ${threadId} after a failed message: ${errorMessage(rollback)}`,
        );
      }
      throw error;
    }
    bb.log.info(
      `Context handoff: asked ${threadId} for checkpoint notes at ${used ?? "?"} tokens${state.requested ? " (switched on)" : ""}${reminder ? " (reminder)" : ""}.`,
    );
    return { ok: true, message: "asked the agent to write checkpoint notes" };
  }

  /**
   * Record the next thread on this one. It already exists, so a failed save
   * never fails the step: the seeded metadata lets the next check find it.
   */
  async function record(threadId: string, nextId: string): Promise<boolean> {
    spawned.set(threadId, nextId);
    // Leaves nextConfirmed alone: the next thread may already have confirmed.
    const save = () => saveState(threadId, { stage: "handed-off", nextThreadId: nextId });
    try {
      await save();
      return true;
    } catch (first) {
      bb.log.warn(`Context handoff: recording ${nextId} on ${threadId} failed once: ${errorMessage(first)}`);
      try {
        await save();
        return true;
      } catch (error) {
        bb.log.error(`Context handoff: ${threadId} continued in ${nextId}, but recording it failed: ${errorMessage(error)}`);
        return false;
      }
    }
  }

  function nextProblemMessage(nextId: string, part: number, problem: "failed" | "stalled"): string {
    const what = problem === "failed"
      ? `was created but failed to start. Tell the user in one line: open @thread:${nextId} and retry it there (BB may also retry it automatically)`
      : `stopped before confirming your notes. Tell the user in one line: open @thread:${nextId} to see why`;
    return `Not handed off: part ${part} (@thread:${nextId}) ${what}, or archive it to cancel the handoff and continue here. Do not run ready again and do not continue the work here until then.`;
  }

  function waitMessage(part: number, reason: string): string {
    return `Not handed off yet: ${reason} Do not continue the work in this thread meanwhile. Wait at least a minute, then run \`bb context-handoff ready\` again (a reminder follows if you end your turn); it reuses the new thread if one was created and starts one only if not.`;
  }

  /**
   * What `ready` reports once the next thread exists. BB's spawn answers while
   * the thread is still pending, so wait briefly for its first turn to start or
   * fail before telling this thread's agent to stop.
   */
  async function awaitStart(
    threadId: string,
    next: { id: string; status: string },
    part: number,
    notes: string[],
    recorded: boolean,
  ): Promise<StepResult> {
    if (!recorded) notes.push("this thread could not be marked as handed off yet; the plugin finds the new thread again, so never start another");
    // Judge only from the thread itself: spawn answers "pending", and list
    // rows carry no queue count.
    let status = next.status;
    let retrying = false;
    let archived = false;
    let firstError: number | null = null;
    const deadline = Date.now() + timing.startWaitMs;
    for (let poll = 0; !disposed; poll++) {
      if (poll > 0) await new Promise((resolve) => setTimeout(resolve, timing.pollMs));
      try {
        const row = await bb.sdk.threads.get({ threadId: next.id });
        // An archive only counts once BB's undo window has passed.
        archived = row.archivedAt !== null;
        status = (row.deletedAt ?? null) !== null || (row.archivedAt !== null && Date.now() - row.archivedAt >= timing.archiveGraceMs)
          ? "gone" : row.status;
        retrying = status === "error" && (await retryPending(next.id, row.queuedMessageCount));
      } catch (error) {
        if (httpStatus(error) === 404) status = "gone";
        else bb.log.warn(`Context handoff: could not read ${next.id} while it starts: ${errorMessage(error)}`);
        break;
      }
      if (status === "error" && !retrying) {
        // BB's provider-retry queues its retry a few seconds after a failure.
        firstError ??= Date.now();
        if (Date.now() - firstError >= timing.errorGraceMs) break;
        continue;
      }
      firstError = null;
      if ((status !== "pending" && status !== "starting") || Date.now() >= deadline) break;
    }
    // Off is not blocked while this step runs; it is settled here instead.
    const latest = await loadStateKnown(threadId);
    if (status !== "gone" && latest.nextThreadId === next.id && !latest.nextConfirmed && (!cached.enabled || !latest.enabled)) {
      await abandon(threadId, next.id, true);
      return { ok: false, message: SWITCHED_OFF_MESSAGE };
    }
    if (status === "gone") {
      // BB removes a thread whose first dispatch failed.
      await abandon(threadId, next.id);
      return {
        ok: false,
        message: `Not handed off: part ${part} (@thread:${next.id}) could not start and was removed, so automatic handoff is now off for this thread. Tell the user in one line, then carry on with the work here.`,
      };
    }
    if (archived && !latest.nextConfirmed) {
      // BB may still undo it; its grace check cancels the handoff if it sticks.
      return {
        ok: false,
        message: `Not handed off: part ${part} (@thread:${next.id}) was archived while it was starting. Do not continue the work here yet. Tell the user in one line: unarchive it within half a minute to keep the handoff, or leave it archived to cancel it and continue here.`,
      };
    }
    if (status === "error" && !retrying) {
      bb.log.warn(`Context handoff: ${threadId}'s part ${part} (${next.id}) failed to start.`);
      return { ok: false, message: nextProblemMessage(next.id, part, "failed") };
    }
    if (status === "idle" && !(await loadStateKnown(threadId)).nextConfirmed) {
      return { ok: false, message: nextProblemMessage(next.id, part, "stalled") };
    }
    bb.log.info(`Context handoff: ${threadId} continued in ${next.id}.`);
    const noteText = notes.length > 0 ? ` Note: ${notes.join("; ")}.` : "";
    return {
      ok: true,
      message: `${SUCCESS_MARKER} Part ${part} started in @thread:${next.id}; it confirms once it has read your notes.${noteText} Give the user this link in one line and stop working in this thread.`,
    };
  }

  /**
   * Remind an agent told to wait to run `ready` again once the hold is over.
   * Kept in plugin storage so a reload or restart does not lose it.
   */
  async function scheduleRetryReminder(threadId: string, op: string, at: number): Promise<void> {
    const key = `${REMINDER_PREFIX}${threadId}`;
    const saved = await bb.storage.kv.get<{ op?: unknown; at?: unknown }>(key).catch(() => undefined);
    // Repeated waits for the same attempt share one reminder.
    if (saved?.op === op && saved.at === at) return;
    try {
      await bb.storage.kv.set(key, { op, at });
    } catch (error) {
      bb.log.warn(`Context handoff: could not save the ready reminder for ${threadId}: ${errorMessage(error)}`);
      return;
    }
    armReminder(threadId, op, at);
  }

  function armReminder(threadId: string, op: string, at: number, delayMs?: number): void {
    later(delayMs ?? Math.max(0, at + timing.startHoldMs - Date.now()) + 1_000, () => {
      void guarded(threadId, () => remind(threadId, op, at).catch((error: unknown) => {
        // A transient failure (not a refusal) is retried later.
        const status = httpStatus(error);
        if (status !== null && status >= 400 && status < 500) {
          void bb.storage.kv.delete(`${REMINDER_PREFIX}${threadId}`).catch(() => undefined);
          return { ok: true, message: `dropped: ${errorMessage(error)}` };
        }
        throw error;
      })).then((result) => {
        // A busy thread is tried again shortly rather than forgotten.
        if (!result.ok) armReminder(threadId, op, at, 30_000);
      }).catch((error: unknown) => {
        if (disposed) return;
        bb.log.warn(`Context handoff: could not remind ${threadId} to run ready: ${errorMessage(error)}`);
        armReminder(threadId, op, at, 60_000);
      });
    });
  }

  async function remind(threadId: string, op: string, at: number): Promise<StepResult> {
    const key = `${REMINDER_PREFIX}${threadId}`;
    const saved = await bb.storage.kv.get<{ op?: unknown; at?: unknown }>(key);
    // Already sent, or replaced by a newer wait whose own timer reminds.
    if (saved === undefined || saved.op !== op || saved.at !== at) return { ok: true, message: "skipped: handled or superseded" };
    const done = async (message: string): Promise<StepResult> => {
      await bb.storage.kv.delete(key);
      return { ok: true, message };
    };
    let thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>;
    try {
      thread = await bb.sdk.threads.get({ threadId });
    } catch (error) {
      if (httpStatus(error) === 404) return done("skipped: the thread was deleted");
      throw error;
    }
    // An archived thread cannot take messages; it starts a fresh request if it comes back.
    if (!isEligible(thread)) return done("skipped: the thread is archived or hidden");
    const state = await loadStateKnown(threadId);
    if (state.stage === "handed-off" || (state.handoffOp !== null && state.handoffOp !== op)) {
      return done("skipped: the start attempt was resolved");
    }
    if ((await bb.sdk.threads.interactions.list({ threadId })).length > 0) {
      armReminder(threadId, op, at, 30_000);
      return { ok: true, message: "waiting for user input; reminding later" };
    }
    if (!cached.enabled || !state.enabled || state.stage !== "preparing") {
      // The agent was told to wait; release it, and end the request so a later
      // handoff starts from fresh notes. With the global setting still on, a
      // per-thread Off already withdrew the switch-on request, so one that is
      // set now came from a later On and stands.
      await retireRequest(threadId, cached.enabled);
      await sendToThread(threadId, "[Context Handoff] Automatic handoff was switched off, so no new part is starting. Carry on with the user's work in this thread.");
      return done("told the agent to carry on");
    }
    if (state.handoffOp === null) return done("skipped: the start attempt was resolved");
    await sendToThread(threadId, `[Context Handoff] Run \`bb context-handoff ready\` again now to finish starting part ${state.part + 1}. It reuses the new thread if one was created and starts one only if not. Do what it prints.`);
    return done("reminded the agent to run ready again");
  }

  /** Start the continuation thread once the notes exist. */
  async function startNext(threadId: string): Promise<StepResult> {
    const thread = await bb.sdk.threads.get({ threadId });
    const state = await loadStateKnown(threadId);
    const part = state.part + 1;
    if (state.stage === "handed-off") {
      const nextId = state.nextThreadId!;
      const health = state.nextConfirmed ? "confirmed" : await nextHealth(nextId);
      if (health === "gone") {
        await abandon(threadId, nextId);
        return {
          ok: false,
          message: `Not handed off: part ${part} (@thread:${nextId}) was archived or deleted before it confirmed, so the handoff is cancelled and automatic handoff is off for this thread. Continue the user's work here.`,
        };
      }
      if (health === "failed" || health === "stalled") return { ok: false, message: nextProblemMessage(nextId, part, health) };
      return {
        ok: true,
        message: `${SUCCESS_MARKER} Already handed off to @thread:${nextId}.`,
      };
    }
    // Settle an earlier start attempt first: this thread must never be told to
    // carry on while a thread from that attempt could still take over.
    if (state.stage === "preparing" && state.handoffOp !== null) {
      const existing = await findContinuation(thread, state.handoffOp);
      if (existing !== null) return claim(threadId, state.handoffOp, existing, part, []);
      if (attemptIsRecent(state)) {
        await scheduleRetryReminder(threadId, state.handoffOp, state.handoffOpAt ?? Date.now());
        return { ok: false, message: waitMessage(part, `an earlier attempt to start part ${part} may still be finishing.`) };
      }
    }
    if (state.stage !== "preparing") {
      if ((await cancelAttempt(threadId, state, thread.projectId)).nextThreadId !== null) return startNext(threadId);
      if (state.legacyRequest) {
        return {
          ok: false,
          message: "Not handed off: this request came from an older version of Context Handoff. End this turn now; a new [Context Handoff] message with a checkpoint id follows. If none arrives, carry on with the work.",
        };
      }
      if (state.checkpointId !== null) {
        // A request was made, then withdrawn by switching off before ready.
        await saveState(threadId, { checkpointId: null });
        return {
          ok: false,
          message: "Not handed off: handoff was switched off for this thread, so its request was withdrawn. Stop preparing and carry on with the user's work in this thread.",
        };
      }
      return {
        ok: false,
        message:
          "Not handed off: no handoff was requested for this thread. Only run `bb context-handoff ready` after a [Context Handoff] message asks for it. Do not start a handoff yourself; carry on with the work.",
      };
    }
    const off = !cached.enabled || !state.enabled || !isEligible(thread);
    if (off || (await bb.sdk.threads.interactions.list({ threadId })).length > 0) {
      if ((await cancelAttempt(threadId, state, thread.projectId)).nextThreadId !== null) return startNext(threadId);
      // Only waiting for the user: a switch-on request is made again afterwards.
      await retireRequest(threadId, !off);
      return { ok: false, message: "Not handed off: automatic handoff is off or the thread is waiting for input. Continue in this thread." };
    }
    if (state.handoffAttempts >= MAX_START_ATTEMPTS) {
      if ((await cancelAttempt(threadId, state, thread.projectId)).nextThreadId !== null) return startNext(threadId);
      // As promised below: the next ready makes a fresh round of attempts.
      await saveState(threadId, { handoffAttempts: 0 });
      return {
        ok: false,
        message: `Not handed off: starting part ${part} failed ${state.handoffAttempts} times. Tell the user in one line and wait for them; running ready again tries once more.`,
      };
    }
    const path = await workspacePath(thread.environmentId);
    const dir = notesDir(docsDir(), state.chainId, path);
    // The server can only check files when it shares the thread's machine.
    const canCheck = path !== null && existsSync(path);
    if (canCheck) {
      const missing = REQUIRED_FILES.filter((name) => {
        const file = join(dir, name);
        return !existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0;
      });
      if (missing.length > 0) {
        return {
          ok: false,
          message: `Not handed off: ${missing.map((name) => `${dir}/${name}`).join(", ")} missing or empty. Write ${missing.length === 1 ? "it" : "them"}, then run \`bb context-handoff ready\` again.`,
        };
      }
      const requestedAt = state.preparingAt;
      if (requestedAt !== null) {
        const stale = ["HANDOFF.md"].filter(
          (name) =>
            statSync(join(dir, name)).mtimeMs < requestedAt - MTIME_SLACK_MS,
        );
        if (stale.length > 0) {
          return {
            ok: false,
            message: `Not handed off: ${stale.map((name) => `${dir}/${name}`).join(", ")} ${stale.length === 1 ? "is" : "are"} left from an earlier part. Rewrite ${stale.length === 1 ? "it" : "them"} for where things stand now, then run \`bb context-handoff ready\` again.`,
          };
        }
      }
      const checkpointId = state.checkpointId;
      if (checkpointId !== null && !readFileSync(join(dir, "HANDOFF.md"), "utf8").includes(checkpointId)) {
        return {
          ok: false,
          message: `Not handed off: ${dir}/HANDOFF.md does not contain this request's line \`Checkpoint: ${checkpointId}\`, so it may be from an earlier part. Rewrite it for where things stand now, starting with that line, then run \`bb context-handoff ready\` again.`,
        };
      }
    }
    const notes: string[] = [];
    if (!canCheck) {
      notes.push("notes not checked here: the BB server cannot see this workspace, so the next thread checks them");
    }
    let execution: Awaited<
      ReturnType<typeof bb.sdk.threads.defaultExecutionOptions>
    > = null;
    try {
      execution = await bb.sdk.threads.defaultExecutionOptions({ threadId });
    } catch (error) {
      bb.log.warn(
        `Context handoff: could not read model settings for ${threadId}: ${errorMessage(error)}`,
      );
    }
    if (execution === null) {
      notes.push(
        "model and permission settings not copied, so BB's defaults apply",
      );
    }
    const baseTitle = (thread.title ?? thread.titleFallback ?? "Handoff")
      .replace(/\s*\(part \d+\)$/, "")
      .slice(0, 120);
    const current = await loadStateKnown(threadId);
    // A thread from an earlier attempt may have confirmed in the meantime.
    if (current.stage === "handed-off") return startNext(threadId);
    if (!cached.enabled || !current.enabled || current.stage !== "preparing") {
      if ((await cancelAttempt(threadId, current, thread.projectId)).nextThreadId !== null) return startNext(threadId);
      // Still preparing means the global setting went off: end the request
      // here too, so it is not made again when the setting comes back on.
      if (current.stage === "preparing") await retireRequest(threadId);
      return { ok: false, message: "Not handed off: automatic handoff was switched off. Continue in this thread." };
    }
    // Saved before creating, so an interrupted or unanswered spawn is looked
    // up by the next attempt instead of repeated blindly.
    const op = randomUUID();
    const at = Date.now();
    await saveState(threadId, { handoffOp: op, handoffOpAt: at, nextConfirmed: false, handoffAttempts: state.handoffAttempts + 1 });
    let next: ThreadRow | Awaited<ReturnType<typeof bb.sdk.threads.spawn>>;
    try {
      next = await bb.sdk.threads.spawn({
        projectId: thread.projectId,
        parentThreadId: state.chainId,
        environment:
          thread.environmentId === null
            ? { type: "project-default" }
            : { type: "reuse", environmentId: thread.environmentId },
        providerId: thread.providerId,
        ...(execution === null
          ? {}
          : {
              model: execution.model,
              reasoningLevel: execution.reasoningLevel,
              permissionMode: execution.permissionMode,
              serviceTier: execution.serviceTier,
            }),
        sectionId: thread.sectionId,
        title: `${baseTitle} (part ${part})`,
        prompt: continuationPrompt({
          dir,
          previousThreadId: threadId,
          part,
        }),
        // Seeded atomically with the thread, so it can always be found again.
        pluginMetadata: {
          enabled: true,
          stage: "watching",
          chainId: state.chainId,
          part,
          previousThreadId: threadId,
          createdByOp: op,
          ...(state.checkpointId === null ? {} : { parentCheckpointId: state.checkpointId }),
        },
      });
    } catch (error) {
      bb.log.warn(`Context handoff: starting part ${part} for ${threadId} failed: ${errorMessage(error)}`);
      if (definitelyRefused(error)) {
        // BB answered without creating a thread, so there is nothing to find.
        await saveState(threadId, { handoffOp: null, handoffOpAt: null });
        return {
          ok: false,
          message: `Not handed off: BB refused to start part ${part} (${errorMessage(error)}). Tell the user in one line and wait: they can fix the cause and ask you to run ready again, or turn Auto handoff off for this thread to continue here.`,
        };
      }
      let existing: ThreadRow | null = null;
      try {
        existing = await findContinuation(thread, op);
      } catch (lookup) {
        bb.log.warn(`Context handoff: could not look for ${threadId}'s continuation: ${errorMessage(lookup)}`);
      }
      if (existing !== null) return claim(threadId, op, existing, part, notes);
      const afterFailure = await loadStateKnown(threadId);
      // The part confirmed before the reply failed: the handoff happened.
      if (afterFailure.nextThreadId !== null) return startNext(threadId);
      if (!cached.enabled || !afterFailure.enabled || afterFailure.stage !== "preparing") {
        // Switched off meanwhile: retire the request (a late thread cannot
        // confirm). A switch-on request set again by a later On stands.
        await retireRequest(threadId, cached.enabled);
        return { ok: false, message: SWITCHED_OFF_MESSAGE };
      }
      // The request may have run for longer than the hold; count from now.
      const failedAt = Date.now();
      await saveState(threadId, { handoffOpAt: failedAt });
      await scheduleRetryReminder(threadId, op, failedAt);
      return { ok: false, message: waitMessage(part, `starting part ${part} failed (${errorMessage(error)}), and it is not yet certain whether the thread was created.`) };
    }
    return claim(threadId, op, next, part, notes);
  }

  /**
   * Record a thread this attempt created, unless the attempt was cancelled
   * while BB was creating it (Off is not blocked by a running ready).
   */
  async function claim(threadId: string, op: string, next: { id: string; status: string }, part: number, notes: string[]): Promise<StepResult> {
    const after = await loadStateKnown(threadId);
    // A part from an earlier attempt took over meanwhile: it stands.
    if (after.nextThreadId !== null && after.nextThreadId !== next.id) {
      await cancelContinuation(next.id);
      return startNext(threadId);
    }
    const off = !cached.enabled || !after.enabled || after.stage !== "preparing";
    if (after.nextThreadId !== next.id && (after.handoffOp !== op || off)) {
      await cancelContinuation(next.id);
      // A switch-on request set again by a later On stands.
      if (after.handoffOp === op) await retireRequest(threadId, cached.enabled);
      bb.log.info(`Context handoff: ${next.id} was created after ${threadId}'s start attempt was switched off; cancelled it too.`);
      return { ok: false, message: SWITCHED_OFF_MESSAGE };
    }
    return awaitStart(threadId, next, part, notes, await record(threadId, next.id));
  }

  /** The next thread proves it read the checkpoint it was started from. */
  async function resume(threadId: string, checkpoint: string): Promise<StepResult> {
    const own = await loadState(threadId);
    const no = (message: string) => ({ ok: false, message: `Not resumed: ${message}` });
    if (own.previousThreadId === null) {
      return no("this thread does not continue an earlier one, so there is nothing to confirm. Carry on with the user's work.");
    }
    const sourceId = own.previousThreadId;
    if (own.nextThreadId !== null) {
      return no(`this thread has already handed off to @thread:${own.nextThreadId}. Do not continue the work here.`);
    }
    if (own.abandoned) {
      return no(`this thread's handoff from @thread:${sourceId} was cancelled before it confirmed, so it is now an ordinary thread. Tell the user in one line, and do not continue the earlier work unless they ask you to.`);
    }
    // An archived part may still be running out BB's undo window; not yet.
    const self = await bb.sdk.threads.get({ threadId });
    if (self.archivedAt !== null) {
      return no("this thread is archived, so it must not take over the work. Stop; if the user unarchives it, run resume again.");
    }
    const sourceRaw = await readMetadataAny(sourceId);
    if (own.confirmed) {
      // It took over already; never send it back to the notes' old next step.
      const source = readState(sourceId, sourceRaw ?? {});
      if (sourceRaw !== null && source.nextThreadId === threadId && !source.nextConfirmed) await confirmOnSource(sourceId, threadId);
      return { ok: true, message: `${RESUME_MARKER} Already confirmed as part ${own.part}. Carry on with your current work; do not restart from HANDOFF.md.` };
    }
    if (sourceRaw === null && (await sourceDeleted(sourceId))) {
      // Only one part may take over a deleted thread.
      if (await anotherPartConfirmed(sourceId, self.projectId, threadId)) {
        await cancelContinuation(threadId);
        return no(`another part already took over from the deleted thread @thread:${sourceId}, so this thread is cancelled. Tell the user in one line; do not work in this thread.`);
      }
      // Its metadata is gone with it: check against what this thread was started for.
      if (own.parentCheckpointId !== null && checkpoint !== own.parentCheckpointId) {
        return no(`"${checkpoint || "(none)"}" is not this handoff's checkpoint id. Read HANDOFF.md again and run \`bb context-handoff resume <id>\` with the id from its first line, \`Checkpoint: <id>\`. If that line is missing or the command says the same again, stop and tell the user in one line that the notes are not from the latest checkpoint.`);
      }
      await saveState(threadId, { confirmed: true });
      bb.log.info(`Context handoff: ${threadId} confirmed its checkpoint; ${sourceId} was deleted.`);
      return { ok: true, message: `${RESUME_MARKER} Confirmed as part ${own.part}; the earlier thread was deleted. Continue from the next step in HANDOFF.md.` };
    }
    const source = readState(sourceId, sourceRaw ?? {});
    const sourceNext = source.nextThreadId ?? spawned.get(sourceId) ?? null;
    if (sourceNext !== null && sourceNext !== threadId) {
      await cancelContinuation(threadId);
      return no(`@thread:${sourceId} continued in @thread:${sourceNext}, not here, so this thread is cancelled. Tell the user in one line; do not work in this thread.`);
    }
    // Not recorded on the earlier thread: only a thread from its current start
    // attempt may claim the handoff.
    if (sourceNext === null && (source.stage !== "preparing" || source.handoffOp === null || source.handoffOp !== own.createdByOp)) {
      await cancelContinuation(threadId);
      return no(`@thread:${sourceId} has no handoff in progress to this thread, so this thread is cancelled. Tell the user in one line; do not work in this thread.`);
    }
    if (source.checkpointId !== null && checkpoint !== source.checkpointId) {
      return no(`"${checkpoint || "(none)"}" is not this handoff's checkpoint id. Read HANDOFF.md again and run \`bb context-handoff resume <id>\` with the id from its first line, \`Checkpoint: <id>\`. If that line is missing or the command says the same again, stop and tell the user in one line that the notes are not from the latest checkpoint: they can have @thread:${sourceId} rewrite HANDOFF.md and then ask you to run resume again, or archive this thread to cancel the handoff.`);
    }
    // The earlier thread first, so a failure here is simply retried.
    await confirmOnSource(sourceId, threadId);
    spawned.set(sourceId, threadId);
    await saveState(threadId, { confirmed: true });
    bb.log.info(`Context handoff: ${threadId} confirmed checkpoint ${source.checkpointId ?? "(none)"} from ${sourceId}.`);
    await publish(sourceId);
    return { ok: true, message: `${RESUME_MARKER} Confirmed as part ${own.part} of @thread:${sourceId}. Continue from the next step in HANDOFF.md.` };
  }

  /** Whether a thread other than `selfId` already confirmed as the continuation of `sourceId`. */
  async function anotherPartConfirmed(sourceId: string, projectId: string, selfId: string): Promise<boolean> {
    const page = 100;
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += page) {
        // Too many to check: refuse rather than risk two parts.
        if (offset >= 10_000) return true;
        const rows = await bb.sdk.threads.list({ projectId, originPluginId: bb.pluginId, includeHidden: true, archived, limit: page, offset });
        const ids = rows.map((row) => row.id).filter((id) => id !== selfId);
        if (ids.length > 0) {
          const metadata = await bb.sdk.threads.experimental_listPluginMetadata({ threadIds: ids });
          for (const row of metadata.threads) {
            const other = readState(row.threadId, row.metadata);
            if (other.previousThreadId === sourceId && other.confirmed) return true;
          }
        }
        if (rows.length < page) break;
      }
    }
    return false;
  }

  async function sourceDeleted(sourceId: string): Promise<boolean> {
    try {
      await bb.sdk.threads.get({ threadId: sourceId });
      return false;
    } catch (error) {
      if (httpStatus(error) === 404) return true;
      throw error;
    }
  }

  async function confirmOnSource(sourceId: string, nextId: string): Promise<void> {
    try {
      await saveState(sourceId, { stage: "handed-off", nextThreadId: nextId, nextConfirmed: true });
    } catch (error) {
      // A deleted earlier thread cannot be updated; the continuation still counts.
      if (httpStatus(error) !== 404) throw error;
      bb.log.info(`Context handoff: ${sourceId} was deleted; ${nextId} confirms on its own.`);
    }
  }

  async function setEnabled(threadId: string, enabled: boolean): Promise<StepResult> {
    // Off is never blocked. While a handoff step runs, it only records the
    // switch: that step re-checks it before linking or reporting a new part.
    // Otherwise it takes the step lock and settles a pending start attempt.
    const settle = !enabled && !inFlight.has(threadId);
    if (settle) inFlight.add(threadId);
    let turningOn = false;
    try {
      const state = await loadStateKnown(threadId);
      // Switching on asks for a handoff at the next safe stopping point,
      // when usage is at least 20%. A repeated On leaves a running request alone. A
      // part that never confirmed its checkpoint (still starting, or
      // cancelled) only gets the switch back: its notes belong to the chain's
      // request, and a cancelled part must not be prompted into that work.
      const unconfirmedPart = state.abandoned || (state.createdByOp !== null && !state.confirmed);
      turningOn = enabled && !state.enabled && state.stage === "watching" && !unconfirmedPart;
      // A cancelled part that is switched on keeps its notes out of the chain's
      // folder, which the earlier thread still uses; it stays marked cancelled.
      const chainId = enabled && state.abandoned ? threadId : state.chainId;
      const usage = turningOn ? await readUsage(threadId) : null;
      const requested = usage !== null && usage.used !== null && usage.window !== null && usage.used >= usage.window * 0.2;
      await saveState(threadId, {
        enabled, chainId, stage: state.stage,
        ...(turningOn ? { requested } : {}),
        ...(!enabled ? { requested: false } : {}),
        ...(!enabled && state.stage === "preparing" ? {
          stage: "watching", preparingAtTokens: null, preparingAt: null,
        } : {}),
      });
      if (settle && state.handoffOp !== null && state.nextThreadId === null) {
        const thread = await bb.sdk.threads.get({ threadId });
        await cancelAttempt(threadId, await loadStateKnown(threadId), thread.projectId);
      }
    } finally {
      if (settle) inFlight.delete(threadId);
    }
    // Ask now rather than at the next turn, so an idle thread hands off too.
    if (turningOn) {
      lastNudged.set(threadId, Date.now());
      check(threadId, SWITCH_ON_RETRIES);
    }
    return {
      ok: true,
      message: turningOn
        ? "Handoff on: enabled below 20% waits for 30%; enabled at or above 20% requests the next safe stopping point."
        : `Automatic handoff ${enabled ? "on" : "off"} for this thread.`,
    };
  }

  /** One handoff step per thread at a time; refreshes the banner after. */
  async function guarded(
    threadId: string,
    run: () => Promise<StepResult>,
  ): Promise<StepResult> {
    if (inFlight.has(threadId)) {
      return {
        ok: false,
        message: "Busy: another handoff step is running for this thread. Wait a few seconds, then run the command again.",
      };
    }
    inFlight.add(threadId);
    try {
      return await run();
    } finally {
      inFlight.delete(threadId);
      await publish(threadId);
    }
  }

  /**
   * Run a check unless another step holds this thread; with `retries`, try
   * again a second later instead of waiting for the thread's next event.
   */
  function check(threadId: string, retries = 0) {
    if (disposed || !cached.enabled) return;
    if (inFlight.has(threadId)) {
      if (retries > 0) later(1_000, () => check(threadId, retries - 1));
      return;
    }
    void guarded(threadId, () => prepare(threadId)).catch((error: unknown) => {
      if (!disposed) bb.log.error(`Context handoff: check failed for ${threadId}: ${errorMessage(error)}`);
    });
  }

  /** Try a pending switch-on request again, at most every requestRetryMs. */
  function nudge(threadId: string): void {
    if (disposed || !cached.enabled || inFlight.has(threadId)) return;
    const now = Date.now();
    if (now - (lastNudged.get(threadId) ?? 0) < timing.requestRetryMs) return;
    lastNudged.set(threadId, now);
    check(threadId);
  }

  bb.events.on("thread.idle", ({ thread }) => {
    if (isEligible(thread)) check(thread.id);
  });
  // Context is sampled at most every 5s per active thread; idle is a backstop.
  bb.events.on("experimental_thread.events", ({ thread }) => {
    if (!cached.enabled || !isEligible(thread) || thread.status !== "active") return;
    const now = Date.now();
    if (now - (lastChecked.get(thread.id) ?? 0) < 5_000) return;
    lastChecked.set(thread.id, now);
    check(thread.id);
  });
  /** Archiving or deleting a next thread before it confirms cancels that handoff. */
  async function continuationRemoved(threadId: string, archived: boolean): Promise<void> {
    if (disposed) return;
    if (archived) {
      // Only an archive that outlasted BB's undo window counts, measured from
      // the current archive (an Undo and a new archive restart it).
      try {
        const archivedAt = (await bb.sdk.threads.get({ threadId })).archivedAt;
        if (archivedAt === null) return;
        const left = archivedAt + timing.archiveGraceMs - Date.now();
        if (left > 0) {
          later(left, () => onRemoved(threadId, true));
          return;
        }
      } catch (error) {
        if (httpStatus(error) !== 404) throw error;
      }
    }
    // Deleted threads answer 404 on their own route; this listing includes them.
    const state = readState(threadId, (await readMetadataAny(threadId)) ?? {});
    if (state.previousThreadId === null || state.confirmed || state.abandoned) return;
    const sourceId = state.previousThreadId;
    const result = await guarded(sourceId, () => abandon(sourceId, threadId));
    // A busy source is handled when its banner or next step looks again.
    if (!result.ok) bb.log.info(`Context handoff: ${threadId} was removed while ${sourceId} was busy; checking again later.`);
  }
  const onRemoved = (threadId: string, archived: boolean) => {
    void continuationRemoved(threadId, archived).catch((error: unknown) => {
      if (!disposed) bb.log.warn(`Context handoff: could not check removed thread ${threadId}: ${errorMessage(error)}`);
    });
  };
  bb.events.on("thread.archived", ({ thread }) => {
    later(timing.archiveGraceMs, () => onRemoved(thread.id, true));
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    void bb.storage.kv.delete(`${REMINDER_PREFIX}${thread.id}`).catch(() => undefined);
    lastChecked.delete(thread.id);
    lastNudged.delete(thread.id);
    spawned.delete(thread.id);
    onRemoved(thread.id, false);
  });

  bb.agents.configure((ctx) => {
    const state = readState(ctx.thread.id, ctx.pluginMetadata);
    // A cancelled part is an ordinary thread: never point it at the chain's notes.
    if (!cached.enabled || !state.enabled || state.part === 1 || state.abandoned) return { tools: [], skills: [] };
    return {
      tools: [], skills: [],
      instructions: continuationInstructions(
        notesDir(docsDir(), state.chainId, ctx.environment.path),
        !state.confirmed && !state.abandoned,
      ),
    };
  });

  bb.rpc.register(rpcContract, {
    state: ({ threadId }) => view(threadId),
    set_enabled: async ({ threadId, enabled }) => {
      // Off must remain available while preparation/ready awaits the SDK.
      const result = await setEnabled(threadId, enabled);
      await publish(threadId);
      return { ok: result.ok, result: result.message, view: await view(threadId) };
    },
  });

  const usage = [
    "Usage:",
    "  bb context-handoff status [thread-id] [--json]",
    "  bb context-handoff ready [thread-id] [--json]",
    "  bb context-handoff resume <checkpoint-id> [thread-id] [--json]",
    "",
    "Inside a thread, thread-id defaults to the current thread.",
  ].join("\n");
  bb.cli.register({
    name: "context-handoff",
    summary: "Move a long thread to a fresh one with its goal and notes intact",
    commands: [
      {
        name: "status",
        summary: "Show automatic handoff, stage and context usage",
        usage: "bb context-handoff status [thread-id] [--json]",
      },
      {
        name: "ready",
        summary: `After writing the notes: start the next thread and print ${SUCCESS_MARKER} with its link`,
        usage: "bb context-handoff ready [thread-id] [--json]",
      },
      {
        name: "resume",
        summary: `In a new part: confirm the Checkpoint id from HANDOFF.md and print ${RESUME_MARKER}`,
        usage: "bb context-handoff resume <checkpoint-id> [thread-id] [--json]",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const [command, ...rest] = argv.filter((arg) => arg !== "--json");
      const reply = (exitCode: number, value: unknown, text: string) => {
        const output = json ? JSON.stringify(value) : text;
        return exitCode === 0
          ? { exitCode, stdout: output }
          : { exitCode, stderr: output };
      };
      const step = (threadId: string, result: StepResult) =>
        reply(result.ok ? 0 : 1, { threadId, ...result }, result.message);
      const noThread = {
        exitCode: 1,
        stderr: ctx.threadId
          ? `Inside a thread these commands act only on that thread (${ctx.threadId}); leave out the thread id.`
          : `Could not tell which thread this is: pass the thread id.\n\n${usage}`,
      };
      // Inside a thread, an agent may only act on its own thread; a named
      // thread is for people running the command from a terminal.
      const threadArg = (args: string[]): string | null => {
        if (args.length > 1) return null;
        const named = args[0];
        if (ctx.threadId) {
          return named === undefined || named === ctx.threadId
            ? ctx.threadId
            : null;
        }
        return named ?? null;
      };
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "status": {
          const threadId = threadArg(rest);
          if (threadId === null) return noThread;
          const value = await view(threadId);
          const text = [
            `automatic handoff: ${value.autoHandoff ? "on" : "off"}`,
            `stage: ${value.stage}${value.nextThreadId ? ` (next: ${value.nextThreadId}, ${value.next})` : value.creating ? " (starting the next part)" : value.requested ? " (switched on: handing off at the next safe stopping point)" : ""}`,
            `part: ${value.part}`,
            `usage: ${value.usedTokens === null || value.contextWindow === null ? "unknown" : `${(100 * value.usedTokens / value.contextWindow).toFixed(1)}%`}; handoff target: 30%`,
            `enabled: ${value.enabled}${value.eligible ? "" : " (not watched: sub-agent, hidden or archived thread)"}`,
          ].join("\n");
          return reply(0, value, text);
        }
        case "ready": {
          const threadId = threadArg(rest);
          if (threadId === null) return noThread;
          return step(threadId, await guarded(threadId, () => startNext(threadId)));
        }
        case "resume": {
          const [checkpoint, ...others] = rest;
          const threadId = threadArg(others);
          if (threadId === null) return noThread;
          return step(threadId, await guarded(threadId, () => resume(threadId, cleanCheckpointArg(checkpoint))));
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  // Reminders promised before a reload or restart.
  try {
    for (const key of await bb.storage.kv.list(REMINDER_PREFIX)) {
      const saved = await bb.storage.kv.get<{ op?: unknown; at?: unknown }>(key);
      if (typeof saved?.op === "string" && typeof saved.at === "number") armReminder(key.slice(REMINDER_PREFIX.length), saved.op, saved.at);
      else await bb.storage.kv.delete(key);
    }
  } catch (error) {
    bb.log.warn(`Context handoff: could not restore ready reminders: ${errorMessage(error)}`);
  }

  bb.onDispose(() => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    lastChecked.clear();
    lastNudged.clear();
    spawned.clear();
    inFlight.clear();
  });
}
