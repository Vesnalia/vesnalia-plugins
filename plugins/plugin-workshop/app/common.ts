// Shared by the board, the plugin summary, the «New plugin» form and the work page: labels, classes, small helpers.
import type { AttemptView } from "../contract";
import { STAGES } from "../server/stages";

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The Content Security Policy of the mockup preview: only the mockup's own inline scripts and styles and embedded (`data:`, `blob:`) images,
 * fonts and media. No network requests (fetch, remote images, fonts, styles or scripts), no nested frames, workers or plugins, no form
 * submissions, no base-URL change.
 */
export const MOCKUP_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * The mockup HTML for the preview frame. A standards-mode doctype and the CSP `<meta>` come before anything of the mockup, so the HTML
 * parser makes that meta the first element of the document's head whatever the file contains: a `<head>` hidden in a comment or a script
 * cannot move it out of the head (where a CSP meta would be ignored). The mockup's own leading doctype is dropped (a legacy one would mean
 * quirks mode); its `<html>` attributes are kept by the parser, its own `<head>` tag is ignored and the head content stays in this head.
 */
export function withMockupCsp(html: string): string {
  const rest = html.replace(/^﻿?\s*<!doctype[^>]*>/i, "");
  return `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${MOCKUP_CSP}">${rest}`;
}
export const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const short = (sha: string | null) => (sha ? sha.slice(0, 7) : "—");
export const uniq = (xs: string[]) => [...new Set(xs)];

export const btn = "rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50";
export const primary = "rounded-md border border-border bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50";
export const field = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";
export const input = "rounded-md border border-border bg-background px-2 py-1.5 text-xs";
/** The contract limit for a cancel or rollback reason (`cancel`, `rollback`): the server accepts nothing longer. */
export const REASON_MAX = 2000;
export const errCls = "text-xs text-red-600 dark:text-red-400";

/** The label of a work's progress (`state` of the work card). Reason texts come from the server (`reason`). */
export const STATE: Record<string, { text: string; cls: string }> = {
  new: { text: "new", cls: "text-muted-foreground" },
  owner: { text: "waiting for you", cls: "text-amber-600 dark:text-amber-400" },
  agent: { text: "agent at work", cls: "text-sky-600 dark:text-sky-400" },
  reviews: { text: "waiting for reviews", cls: "text-violet-600 dark:text-violet-400" },
  queued: { text: "queued", cls: "text-muted-foreground" },
  machine: { text: "machine unavailable", cls: "text-muted-foreground" },
  error: { text: "failed", cls: "text-red-600 dark:text-red-400" },
  locking: { text: "waiting for the build lock", cls: "text-sky-600 dark:text-sky-400" },
  installing: { text: "installing", cls: "text-sky-600 dark:text-sky-400" },
  unknown: { text: "install outcome unknown", cls: "text-red-600 dark:text-red-400" },
  unexpected: { text: "working copy in an unexpected state", cls: "text-red-600 dark:text-red-400" },
  done: { text: "done", cls: "text-emerald-600 dark:text-emerald-400" },
  canceled: { text: "canceled", cls: "text-muted-foreground" },
};
/** States where the server's reason matters more than the label: it says what to do. */
export const SHOW_REASON = new Set(["error", "locking", "installing", "unknown", "unexpected"]);

/** The plugin's state in VesnALIA (SDK statuses and «not installed»). `alert` — a red frame around the card. */
export const ALIA_STATE: Record<string, { text: string; cls: string; alert: boolean }> = {
  running: { text: "running", cls: "text-emerald-600 dark:text-emerald-400", alert: false },
  "needs-configuration": { text: "needs configuration", cls: "text-amber-600 dark:text-amber-400", alert: false },
  degraded: { text: "degraded", cls: "text-amber-600 dark:text-amber-400", alert: false },
  starting: { text: "starting", cls: "text-sky-600 dark:text-sky-400", alert: false },
  error: { text: "error", cls: "text-red-600 dark:text-red-400", alert: true },
  incompatible: { text: "incompatible", cls: "text-red-600 dark:text-red-400", alert: true },
  missing: { text: "folder missing", cls: "text-red-600 dark:text-red-400", alert: true },
  disabled: { text: "disabled", cls: "text-muted-foreground", alert: false },
  "not-installed": { text: "not installed", cls: "text-muted-foreground", alert: false },
};
export const aliaState = (s: string) => ALIA_STATE[s] ?? { text: s, cls: "text-muted-foreground", alert: false };

/** Stage titles — the server's own (stages.ts). */
export const STAGE_TITLE: Record<number, string> = Object.fromEntries(STAGES.map((s) => [s.no, s.title]));

const KIND_TEXT: Record<AttemptView["kind"], string> = { enter: "rollout", rollback: "rollback", reinstall: "reinstall" };
const STATUS_TEXT: Record<AttemptView["status"], string> = { running: "running", done: "finished", failed: "failed", unknown: "outcome unknown" };
const STEP_TEXT: Record<string, string> = {
  recorded: "recorded",
  moved: "main branch moved",
  locking: "waiting for the build lock",
  locked: "lock taken",
  installing: "starting the install",
  installed: "installing",
  released: "lock released",
  "state-set": "enabling or disabling",
  checked: "reconciling the state",
};
/** A line about a rollout attempt: «rollout · failed · step: installing». */
export const attemptText = (a: AttemptView) => `${KIND_TEXT[a.kind]} · ${STATUS_TEXT[a.status]} · step: ${STEP_TEXT[a.step] ?? a.step}`;

// --- creating a plugin and a work ---

/** The answer of `newPlugin` / `rework`: the work is recorded (`workId`); `error` — a creation step failed, the work opens with that reason. */
export interface Created {
  workId: string;
  error: string | null;
}
/** How long the form waits for the creation answer before handing the wait to the board (the scaffold takes a while, the call may time out). */
export const CREATE_SLOW_MS = 4000;

export type CreationRace = { kind: "result"; value: Created } | { kind: "fail"; message: string } | { kind: "slow" };
/**
 * Waits for the creation answer no longer than `ms`. A fast answer (including a form refusal: a taken id) is handled by the caller;
 * a slow one is `slow`: the wait stays with the caller in `call`, which hands it to the board.
 */
export function raceCreation(call: Promise<Created>, ms: number): Promise<CreationRace> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "slow" }), ms);
    call.then(
      (value) => {
        clearTimeout(timer);
        resolve({ kind: "result", value });
      },
      (e: unknown) => {
        clearTimeout(timer);
        resolve({ kind: "fail", message: errText(e) });
      },
    );
  });
}
