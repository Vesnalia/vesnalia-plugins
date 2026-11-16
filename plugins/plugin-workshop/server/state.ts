import { BUSY, type ThreadStatus } from "./ports";
import type { AttemptKind, AttemptStatus, AttemptStep } from "./store";

export type CardState = "owner" | "agent" | "reviews" | "queued" | "machine" | "error" | "locking" | "installing" | "unknown" | "unexpected" | "done" | "canceled";

/**
 * The attempt error that closes a rollout, rollback or reinstall when the working copy is neither "before" nor "after" (step `moved`).
 * `cardState` recognises the unexpected state by it: this is `failed`, not `unknown` — reinstalling here is dangerous.
 */
export const UNEXPECTED_COPY = "the working copy is in an unexpected state";

/** Nothing on top of a running install (spec): the job list has a running job for the plugin folder. The same words for every action. */
export const INSTALL_RUNNING = "an install is running — wait or cancel it";
/** The install job list did not arrive: whether an install is running is unknown — the action does not start. */
export const JOBS_UNKNOWN = "the install job list did not arrive — the action does not start";

/** A rollout attempt among the card facts. `step` is what the attempt is doing now or where it stopped (the step is set before the action). */
export interface AttemptFact {
  kind: AttemptKind;
  status: AttemptStatus;
  step: AttemptStep;
  /** Error of a closed attempt (`closeAttempt`); null for a running one. */
  error: string | null;
  /** The owner has already decided on the closed failure (`resolved_at`): «Disable», «Roll back», «Install again», «Fix forward». */
  resolved?: boolean;
  /** A rollback without an install that only disables the plugin (rollback of a new plugin): no lock, no build. */
  disableOnly?: boolean;
}
export interface StateFacts {
  stage: number;
  outcome: "done" | "canceled" | null;
  queued: boolean;
  /** The latest stage thread of the current stage; null — there is none. */
  stageThread: ThreadStatus | null;
  reviewsPending: number;
  machineError: string | null;
  pluginError: string | null;
  /**
   * The rollout attempt the card has to tell about: running, unresolved (`failed`, `unknown`) or finished for this work;
   * null — nothing to tell. The engine decides which attempt counts: a rollback runs even when the work is already back in Implementation.
   */
  attempt: AttemptFact | null;
  /** The plugin came up in bb as `needs-configuration` (last confirmed state): at Rollout the card says "needs configuration". */
  needsConfiguration?: boolean;
  /** A review is about to start on its own: what is about to happen — instead of "the agent finished its turn"; null — nothing. */
  reviewsDue?: string | null;
}

const KIND: Record<AttemptKind, { noun: string; failed: string; advice: string }> = {
  enter: { noun: "rollout", failed: "rollout failed", advice: "roll back or disable the plugin" },
  rollback: { noun: "rollback", failed: "rollback failed", advice: "disable the plugin" },
  reinstall: { noun: "reinstall", failed: "reinstall failed", advice: "roll back or disable the plugin" },
};

/** What a running attempt is doing at the step. */
function doing(kind: AttemptKind, step: AttemptStep): string {
  switch (step) {
    case "recorded":
      return "attempt recorded, setting refs to the commits";
    case "moved":
      return kind === "rollback"
        ? "the working copy's main branch is going back to the previous commit"
        : kind === "reinstall"
          ? "checking the working copy against the rolled-out commit"
          : "the working copy's main branch is moving to the work commit";
    case "locking":
      return "waiting for the build lock — another build or install is running";
    case "locked":
      return "build lock taken, starting the install";
    case "installing":
      return "starting the install job";
    case "installed":
      return "the plugin is being installed";
    case "released":
      return "install finished, releasing the build lock";
    case "state-set":
      return "enabling or disabling the plugin";
    case "checked":
      return "reconciling the plugin state";
  }
}

/** What failed when the attempt stopped at a step after the merge (at `recorded` and `moved` the working copy is intact — see `attemptState`). */
function failedAt(step: AttemptStep): string {
  switch (step) {
    case "locking":
      return "build lock not taken";
    case "locked":
    case "installing":
      return "install not started";
    case "installed":
      return "install failed";
    case "released":
      return "build lock not released";
    case "state-set":
      return "could not enable or disable the plugin";
    case "checked":
      return "the plugin is not in the expected state";
    case "recorded":
    case "moved":
      return "";
  }
}

/** The name of an attempt of this kind: "rollout", "rollback", "reinstall". */
export const attemptNoun = (kind: AttemptKind): string => KIND[kind].noun;
/** What failed: "rollout failed", "rollback failed", "reinstall failed". */
export const attemptFailed = (kind: AttemptKind): string => KIND[kind].failed;

/** The merge could not be recognised (HEAD, files or index are neither "before" nor "after"): everything stops, retrying is not allowed. */
const unexpectedCopy = (a: AttemptFact) => a.status === "failed" && a.error?.startsWith(UNEXPECTED_COPY) === true;

/** Why a closed `failed` attempt failed — the same words for the work card and the stage 6 gate. */
export function failureText(a: AttemptFact): string {
  const k = KIND[a.kind];
  if (unexpectedCopy(a)) return `${UNEXPECTED_COPY} — the ${k.noun} is stopped, decide yourself`;
  // Before the merge and at it (refs, `reset --keep`) the working copy did not change: there is nothing to roll back.
  if (a.step === "recorded") return `${k.failed}: nothing was touched`;
  if (a.step === "moved") return `${k.failed}: the working copy is unchanged`;
  return `${k.failed}: ${failedAt(a.step)} — ${k.advice}`;
}

/**
 * A failure the owner resolved with «Disable» while the work stayed at Rollout: the plugin is disabled, next is sending it back to the implementer.
 * The same words for the work card and the stage 6 gate (the "roll back or disable" advice is gone).
 */
export function removedText(a: Pick<AttemptFact, "kind" | "status">): string {
  const what = a.status === "unknown" ? "install outcome unknown" : KIND[a.kind].failed;
  return `${what}, plugin disabled — send the work back to the implementer («Fix forward»)`;
}

/** What a rollout attempt says about the card; null — nothing (finished successfully or there is none). */
function attemptState(a: AttemptFact): { state: CardState; reason: string } | null {
  const k = KIND[a.kind];
  if (a.status === "running") {
    // No lock yet — "waiting for the lock"; with the lock and after — "installing".
    if (a.kind === "rollback" && a.disableOnly) return { state: "installing", reason: "rollback running: disabling the plugin" };
    const early = a.step === "recorded" || a.step === "moved" || a.step === "locking";
    return { state: early ? "locking" : "installing", reason: `${k.noun}: ${doing(a.kind, a.step)}` };
  }
  if (a.status === "unknown") return { state: "unknown", reason: "install outcome unknown — choose an action" };
  if (a.status === "failed") return { state: unexpectedCopy(a) ? "unexpected" : "error", reason: failureText(a) };
  return null;
}

/** The card label — from the facts, in the order of what matters most to the owner. */
export function cardState(f: StateFacts): { state: CardState; reason: string } {
  if (f.outcome === "canceled") return { state: "canceled", reason: "canceled" };
  if (f.outcome === "done") return { state: "done", reason: "done" };
  // The rollout attempt decides which buttons the owner has — before the card's own failures.
  const attempt = f.attempt ? attemptState(f.attempt) : null;
  if (attempt) return attempt;
  if (f.pluginError) return { state: "error", reason: f.pluginError };
  if (f.machineError) return { state: "machine", reason: f.machineError };
  if (f.queued) return { state: "queued", reason: "waiting for a free slot on the machine" };
  if (f.reviewsPending > 0) return { state: "reviews", reason: `reviewers at work: ${f.reviewsPending} left` };
  // Every stage has an agent (the stage thread).
  if (f.stageThread === null) return { state: "error", reason: "no stage thread — «Restart stage»" };
  if (f.stageThread === "error") return { state: "error", reason: "the stage thread crashed — «Restart stage»" };
  if (f.stageThread === "unknown") return { state: "error", reason: "the stage thread is gone — «Restart stage»" };
  if (BUSY.includes(f.stageThread)) return { state: "agent", reason: "agent at work" };
  if (f.reviewsDue) return { state: "reviews", reason: f.reviewsDue };
  if (f.stage === 6) {
    // `needs-configuration` after the install is a success: the owner sets the settings, the spec is not reopened.
    const what = f.needsConfiguration ? "plugin rolled out, needs configuration;" : "plugin rolled out,";
    return { state: "owner", reason: `${what} the agent checked it live: «Accept», «Roll back» or send it back to the implementer` };
  }
  return { state: "owner", reason: "the agent finished its turn — take a look, then hand it over or reply to it" };
}
