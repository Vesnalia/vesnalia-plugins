// The Plugin Workshop work engine: the stages, hand-overs 1→2→3→4→5, send-backs, reviews at Spec and Verification, the queue
// for Building, "main branch moved ahead", cancel with a snapshot, reconcile against facts. The 5→6 transition («Roll out»),
// acceptance and rollback are run by Rollout (rollout.ts) — through guard, finishWork, liveCheckEntry, sendBackInTx and stopThreads from here.
// Works whose creation is not finished (`created = 0`) are run by Creation (create.ts): the engine does not touch them.
import { createHash } from "node:crypto";
import type { AttemptView, Card, FileView, StageView, WorkViewCore } from "../contract";
import { gate, MAIN_BRANCH, type GateFacts, type ReviewFact } from "./gates";
import { agentOf, labelFor, modelsOf, reviewersOf } from "./models";
import { ledgerDone, migrationsFlag, navLines, normalizePlan, ownerItems, placeAfter, planTaskCount, reviewVerdict, techVerdict, verifyVerdict } from "./parse";
import { BUSY, MachineUnavailable, runningJobsOf, SymlinkRefused, WorktreeGone, type Ports, type RawFile, type Snapshot, type TaskStatus, type ThreadStatus, type Withheld } from "./ports";
import { checkDestination, prUrlOf, publicationGate, publish, scanPublication, type PublishPolicy, type PublishResult, type Refusal } from "./publish";
import { identity, inputsChanged, kickoff, liveCheckPrompt, regulationOf, returnPacket, reviewerPrompt, reviewsForVerifier, reviewsReady, threadTitle } from "./regulations";
import { redact, secretFileName } from "./secrets";
import { cancelSnapshot } from "./snapshot";
import { attemptFailed, cardState, INSTALL_RUNNING, JOBS_UNKNOWN, removedText, type AttemptFact } from "./state";
import { AUTO_REVIEW_ROUNDS, PLUGINS_ROOT, STAGES, STAGE_ORDER, atOrAfter, before, docPaths, docsDir, isCodeStage, isDocStage, isIterationPath, ledgerPath, livePath, mockupDir, nextStage, ownerPath, pluginDir, reviewPath, stageOf, verifyPath, workDir, type StageNo, type Who } from "./stages";
import type { CreationEngine } from "./create";
import type { AttemptRow, Entry, HandoverRow, Role, Store, WorkRow } from "./store";
import { parseVersion, resultHolds, sameVersion, staleStages, type Version } from "./versions";

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const MOCKUP_OFF = "the «Mockup» stage is off — the work cannot be sent back to it";
/** The mockup's text files — its fingerprint is computed from them. */
const MOCKUP_TEXT = /\.(html?|css|js|md|json|svg)$/i;

/** A freshly created thread can be idle before its turn starts. */
export const SETTLE_MS = 30_000;
/** Reasons a review round is invalid: the reviewer finished without a file (the round repeats by itself) and stopped by the owner. */
const NO_REVIEW_FILE = "the reviewer finished without a review file";
const STOPPED_BY_OWNER = "stopped by the owner";
/** An intent to create a thread whose thread never turned up counts as failed. */
const SPAWN_GIVE_UP_MS = 5 * 60_000;

export interface Limits {
  /** Works in Building (stages 4–5) on one machine; beyond that — the queue. */
  maxBuilding: number;
  /** How many GB must be free on disk to start a rollout. */
  minFreeDiskGb: number;
  /** Reviews start by themselves; false — only via the «Send to review» button. No value — by themselves. */
  autoReview?: boolean;
  /** The «Mockup» stage between Spec and Implementation; false — Implementation right after Spec. No value — the stage is on. */
  mockup?: boolean;
  /** Owner (user or organization) of the plugin repositories on GitHub; no value — GitHub is off. */
  githubOwner?: string;
  /** Publication also to a public repository or one of another owner; no value — only private repositories of `githubOwner`. */
  allowPublicRepos?: boolean;
}
/** Default owner of the repositories on GitHub: none — GitHub is off until an owner is set in the settings. */
export const GITHUB_OWNER = "";
/** Retry a push to GitHub after a failure no sooner than this (or sooner if the work branch has a new commit). */
export const GITHUB_RETRY_MS = 10 * 60_000;
export interface HandOverResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}
export interface SpawnPayload {
  stage: StageNo;
  role: Role;
  who: Who;
  round: number;
  /** The version the thread starts from: its result is tied to it. */
  input: Version;
}

/** Body of the work branch PR: where the work comes from and where its documents are. */
const prBody = (w: WorkRow) =>
  [
    `Plugin Workshop work ${w.task_key ?? ""} — ${w.title}.`,
    "",
    `Work documents: \`${docsDir(w.task_key ?? "")}/\` (context, feasibility, spec, mockup, verification reports).`,
    "Merged into main on «Accept» at the «Rollout» stage: the Workshop pushes the rolled-out main to GitHub.",
  ].join("\n");

/** «a.md (sk-); keys.env (key file by name)» — what was withheld, labels only. */
export const withheldText = (list: Withheld[]) => list.map((x) => `${x.path} (${x.labels.join(", ")})`).join("; ");

/**
 * Where a work branch commit stands for publication: `clean` — the check passed; `findings` — something like a key in the commits the
 * destination does not have; `failed` — the check did not complete (the scan, the destination, the first push of main, a request);
 * `unscanned` — no verdict for exactly this commit, destination and policy.
 */
export type ScanState = "clean" | "findings" | "failed" | "unscanned";
export interface PublicationFact {
  state: ScanState;
  /** Why (labels only, never values); "" for a clean commit. */
  text: string;
}
/**
 * The last verdict of the publication check on a work branch commit (`works.gh_scan`), tied to what it was computed for: the commit, the
 * destination (`origin`'s push URLs at the time) and the policy (`policyKey`). Another commit, destination or policy — `unscanned`.
 */
export interface ScanVerdict {
  sha: string;
  state: Exclude<ScanState, "unscanned">;
  text: string;
  dest: string;
  policy: string;
}
const SCAN_STATES: readonly string[] = ["clean", "findings", "failed"];
/** The stored verdict; a record in any other shape (an older one included) is no verdict. */
export function scanVerdictOf(w: WorkRow): ScanVerdict | null {
  if (!w.gh_scan) return null;
  try {
    const v = JSON.parse(w.gh_scan) as Partial<ScanVerdict>;
    const ok = typeof v.sha === "string" && SCAN_STATES.includes(String(v.state)) && typeof v.text === "string" && typeof v.dest === "string" && typeof v.policy === "string";
    return ok ? { sha: v.sha!, state: v.state!, text: v.text!, dest: v.dest!, policy: v.policy! } : null;
  } catch {
    return null;
  }
}
/** The verdict of a check result: clean, a finding, or anything else that did not let it through. */
const verdictOf = (r: { ok: true; commits: number } | Refusal): Pick<ScanVerdict, "state" | "text"> =>
  r.ok ? { state: "clean", text: `${r.commits} new ${r.commits === 1 ? "commit" : "commits"} checked` } : { state: r.kind === "secrets" ? "findings" : "failed", text: r.reason };

/** A work whose creation is finished: the tracker task and the execution project exist. */
type Ready = WorkRow & { task_id: string; task_key: string; project_id: string };
const isReady = (w: WorkRow): w is Ready => w.created === 1 && w.task_id !== null && w.task_key !== null && w.project_id !== null;
const blankVersion = (w: WorkRow): Version => ({ iteration: w.iteration, headSha: null, dirty: false, contextSha: null, techSha: null, tzSha: null });
const attemptFact = (a: AttemptRow): AttemptFact => ({
  kind: a.kind, status: a.status, step: a.step, error: a.error, resolved: a.resolved_at !== null,
  // A rollback without an install (before = target) that only disables: the rollback of a new plugin.
  disableOnly: a.kind === "rollback" && a.before_sha === a.target_sha && a.want_enabled === 0,
});
/** A rollout attempt as the UI sees it. */
export const attemptView = (a: AttemptRow): AttemptView => ({ id: a.id, kind: a.kind, step: a.step, status: a.status, error: a.error, beforeSha: a.before_sha, targetSha: a.target_sha, note: a.note });
/** The Building stages: entered through the queue; inside them — "main branch moved ahead". */
const building = (stage: number) => stage === 4 || stage === 5;
const BASE_AHEAD = "the working copy's main branch has moved ahead — the implementer is pulling it in";

export class Engine implements CreationEngine {
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    protected readonly store: Store,
    protected readonly ports: Ports,
    protected readonly limits: () => Limits,
  ) {}

  /** One action on a work at a time: hand-over, send-back, cancel, Rollout actions and reconcile do not interleave. */
  protected serial<T>(workId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(workId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(workId, next.catch(() => undefined));
    return next;
  }

  /** A created work; null — there is no such work or its creation is not finished. */
  protected row(workId: string): Ready | null {
    const w = this.store.work(workId);
    return w && isReady(w) ? w : null;
  }
  protected ready(w: WorkRow): Ready {
    if (!isReady(w)) throw new Error("the work is still being created");
    return w;
  }
  protected must(workId: string): Ready {
    const w = this.store.work(workId);
    if (!w) throw new Error("work not found");
    return this.ready(w);
  }
  protected open(workId: string): Ready {
    const w = this.must(workId);
    if (w.outcome) throw new Error(w.outcome === "done" ? "the work is already done" : "the work is canceled");
    return w;
  }

  /** The result's version now: HEAD, tree cleanliness and the hashes of context.md, tech.md and tz.md (the spec without step checkmarks). */
  async version(w: WorkRow): Promise<Version> {
    const r = this.ready(w);
    if (!r.environment_id) return blankVersion(r);
    const docs = docPaths(r.task_key);
    // All requests at once; but the worktree's own error (removed, machine not responding) comes first, not a file read failure.
    const files = Promise.all([this.ports.read(r.environment_id, docs.context), this.ports.read(r.environment_id, docs.tech), this.ports.read(r.environment_id, docs.tz)]);
    files.catch(() => undefined);
    const head = await this.ports.head(r.environment_id);
    const [context, tech, tz] = await files;
    return {
      iteration: r.iteration,
      headSha: head.sha,
      dirty: head.dirty,
      contextSha: context === null ? null : sha(context),
      techSha: tech === null ? null : sha(tech),
      tzSha: tz === null ? null : sha(normalizePlan(tz)),
      mockupSha: await this.mockupShaAt(r, head),
    };
  }

  /** Mockup fingerprints per clean commit: the mockup is in git, a clean tree at the same HEAD means the same mockup; no need to read it on every reconcile. */
  private mockupCache = new Map<string, string | null>();
  protected async mockupShaAt(w: Ready, head: { sha: string | null; dirty: boolean }): Promise<string | null> {
    const key = head.sha && !head.dirty ? `${w.id}:${w.outcome ?? ""}:${head.sha}` : null;
    if (key && this.mockupCache.has(key)) return this.mockupCache.get(key)!;
    const value = await this.mockupSha(w);
    // A folder read failure can be temporary: it is not cached, otherwise a broken fingerprint would live until the next commit.
    if (key && !value?.startsWith("unreadable:")) {
      if (this.mockupCache.size > 200) this.mockupCache.clear();
      this.mockupCache.set(key, value);
    }
    return value;
  }

  /**
   * The mockup's fingerprint: paths and texts of its text files (`.html`, `.css`, `.js`, `.md`, `.json`, `.svg`); screenshots are derived
   * and are not part of the fingerprint. null — there is no mockup.
   */
  protected async mockupSha(w: Ready): Promise<string | null> {
    const dir = `${mockupDir(w.task_key)}/`;
    let all: string[];
    try {
      all = await this.mockupFiles(w);
    } catch (e) {
      if (e instanceof MachineUnavailable || e instanceof WorktreeGone) throw e;
      // The mockup folder cannot be read (for example, it has too many files): the fingerprint is the error itself; the «Mockup» gate will say it in words.
      return `unreadable:${sha(errText(e))}`;
    }
    // Top-level files only: nested folders (icon exports and the like) are not the mockup but its materials.
    const files = all.filter((p) => p.startsWith(dir) && !p.slice(dir.length).includes("/") && MOCKUP_TEXT.test(p)).sort();
    if (files.length === 0) return null;
    const parts = await Promise.all(files.map(async (p) => `${p}\n${(await this.readText(w, p)) ?? ""}`));
    return sha(parts.join("\n\u0000\n"));
  }

  /** The work's mockup files: from the worktree while the work is in progress; from the snapshot once it is finished. */
  protected async mockupFiles(w: Ready): Promise<string[]> {
    const dir = mockupDir(w.task_key);
    if (!w.outcome && w.environment_id) return await this.ports.list(w.environment_id, dir);
    return await this.ports.listSaved(w.id, dir);
  }

  // --- guarded action ---

  /**
   * A guarded action on a work — shared by Engine and Rollout: one at a time per work; the work is open and created; the stage is
   * as expected; the plugin has no open attempt and no attempt holding the lock (except `duringAttempt` — that is for Rollout);
   * no thread of the work is busy; the version matches the on-screen one, if given.
   */
  guard<T>(workId: string, expect: { stage: number; version?: Version | null; duringAttempt?: boolean }, fn: (w: WorkRow, v: Version) => Promise<T>): Promise<T> {
    return this.serial(workId, () => this.guarded(workId, expect, fn));
  }

  /** The guard checks without the queue — for actions that already run inside the work's `serial`. */
  protected async guarded<T>(workId: string, expect: { stage: number; version?: Version | null; duringAttempt?: boolean }, fn: (w: Ready, v: Version) => Promise<T>): Promise<T> {
    const w = this.open(workId);
    if (w.stage !== expect.stage) throw new Error("the stage has already changed — refresh the page");
    if (!expect.duringAttempt) this.refuseDuringAttempt(w);
    if (this.liveSpawns(w) > 0) throw new Error("the start of a work thread is not confirmed yet — wait up to 5 minutes, reconcile will check");
    if (await this.anyActive(w, ["stage"])) throw new Error("the work's agent is still working — wait until it finishes its turn");
    if (await this.anyActive(w, ["review"])) throw new Error("reviewers are still working — wait or press «Stop reviewers»");
    let v: Version;
    if (expect.version !== undefined) {
      v = await this.version(w);
      if (!sameVersion(v, expect.version)) throw new Error("the version has changed — refresh the page and look again");
    } else {
      // Without an on-screen version a removed worktree does not block the action (cancel, send-back): the version is blank.
      v = await this.version(w).catch((e: unknown) => {
        if (e instanceof WorktreeGone) return blankVersion(w);
        throw e;
      });
    }
    return fn(w, v);
  }

  /** Nothing on top of a running install: the plugin has an open attempt, or its holder may still be holding the lock. */
  protected refuseDuringAttempt(w: WorkRow): void {
    if (this.attemptBusy(w)) throw new Error("a rollout is running — wait");
  }
  protected attemptBusy(w: WorkRow): boolean {
    return this.store.openAttemptOf(w.plugin_id) !== null || this.store.lockedAttempts().some((a) => a.plugin_id === w.plugin_id);
  }
  /** The work's reviewers: slots by the number chosen at start (0–2). */
  protected reviewers(w: WorkRow): Who[] {
    return reviewersOf(modelsOf(w.models));
  }

  /** The thread agent's label from the work's choice: model and level. */
  protected whoLabel(w: WorkRow, role: "stage" | "review", stage: StageNo, who: Who): string {
    return labelFor(modelsOf(w.models), role, stage, who);
  }

  /** Whether the «Mockup» stage is on for new hand-overs (the `mockupStage` setting). */
  mockupStageOn(): boolean {
    return this.limits().mockup !== false;
  }

  /** This work has the «Mockup» stage: it is on in the settings — or the work has already been on it (then it stays the work's stage). */
  protected mockupOn(w: WorkRow): boolean {
    return this.limits().mockup !== false || w.stage === 7 || this.store.runs(w.id).some((r) => r.stage === 7);
  }

  /**
   * This work's attempt. Attempts without a work («Adopt as rolled out» and its rollback) happen only when there is no work on
   * the plugin — they do not belong to the next work: its gates, buttons and rollback do not see them.
   */
  protected belongs(a: AttemptRow, w: WorkRow): boolean {
    return a.work_id === w.id;
  }
  /** The plugin's current attempt, if it belongs to this work (`belongs`). */
  protected ownAttempt(w: WorkRow): AttemptRow | null {
    const a = this.store.currentAttempt(w.plugin_id);
    return a && this.belongs(a, w) ? a : null;
  }

  // --- stage entry intents ---

  /** Entry into Context from outside; Creation writes it in the `markCreated` transaction, reconcile creates the thread. */
  firstStageEntry(w: WorkRow, now: number): Entry {
    return { key: `${w.id}:enter:s1:i${w.iteration}:t${now}`, stage: 1, from: 0, packet: null, error: null };
  }

  /** Entry into stage 6 after a finished attempt: the live check thread for that attempt. Rollout writes it in the attempt outcome transaction. */
  liveCheckEntry(w: WorkRow, attempt: AttemptRow, now: number): Entry {
    return { key: `${w.id}:enter:s6:i${w.iteration}:${attempt.id}:t${now}`, stage: 6, from: 5, packet: null, error: null, attemptId: attempt.id };
  }

  /**
   * The synchronous part of a send-back — for someone else's transaction (the caller's `store.tx`): stage CAS, iteration + 1, the
   * send-back record, the entry intent with a packet. If the stage has already changed — an exception, the caller's transaction rolls back.
   */
  sendBackInTx(w: WorkRow, toStage: StageNo, reason: string, now: number): void {
    const r = this.ready(w);
    if (!(STAGE_ORDER.includes(toStage) && before(toStage, r.stage))) throw new Error("a work can only be sent back to a stage left of the current one");
    if (toStage === 7 && !this.mockupOn(r)) throw new Error(MOCKUP_OFF);
    const iteration = r.iteration + 1;
    const packet = returnPacket({ ...r, iteration }, stageOf(toStage), stageOf(r.stage), reason, iteration);
    if (!this.store.casStage(r.id, r.stage, toStage, iteration, now)) throw new Error("the stage has already changed — refresh the page");
    this.store.addHandover({ work_id: r.id, stage: r.stage, action: "back", to_stage: toStage, version: null, note: reason.trim(), forced: false, problems: [], at: now });
    this.store.setQueued(r.id, false, now);
    // A queued work did not take a slot on the machine: it enters "from outside" and checks for a slot again.
    const from = r.queued === 1 ? -1 : r.stage;
    this.store.setEntry(r.id, { key: `${r.id}:enter:s${toStage}:i${iteration}:t${now}`, stage: toStage, from, packet, error: null }, now);
  }

  /** Carry out the recorded stage entry intent. An error stays in the intent — reconcile will retry. */
  protected async runEntry(workId: string): Promise<void> {
    const w = this.must(workId);
    const e = this.store.entry(w);
    // Nothing on top of a running install: the Building and Rollout agent enters once the attempt is over and the lock is released.
    // Stages 1–3 do not touch the plugin — their entry does not wait for an attempt.
    if (!e || w.queued === 1 || w.outcome || (isCodeStage(e.stage) && this.attemptBusy(w))) return;
    try {
      if (await this.enterStage(w, e)) this.settleEntry(w.id, e.key, null);
    } catch (err) {
      this.settleEntry(w.id, e.key, { ...e, error: errText(err) });
      this.store.log(w.id, "warn", `could not start the «${stageOf(e.stage).title}» stage: ${errText(err)} — reconcile will retry`, this.ports.now());
    }
  }

  /** Replace the intent only if it is still the same one: while the entry ran, Rollout may have written a new one (a send-back after a rollback). */
  protected settleEntry(workId: string, key: string, next: Entry | null): void {
    this.store.tx(() => {
      const cur = this.store.work(workId);
      if (cur && this.store.entry(cur)?.key === key) this.store.setEntry(workId, next, this.ports.now());
    });
  }

  /**
   * The stage agent enters the work: a new thread or the previous one with a new packet.
   * false — the work was queued (the intent stays until a slot frees up).
   */
  protected async enterStage(w: Ready, e: Entry): Promise<boolean> {
    const no = e.stage as StageNo;
    const stage = stageOf(no);
    const now = this.ports.now();
    const spawnKey = `${e.key}:spawn`;
    const prior = this.store.op(spawnKey);
    if (prior?.status === "done") return true;
    // Into Building — from outside the 4–5 pair, and only when a slot is free; a start that has already begun is not postponed.
    if (building(no) && !building(e.from) && prior?.status !== "pending" && this.buildingFull(w)) {
      this.store.setQueued(w.id, true, now);
      this.store.log(w.id, "queue", `queued: the machine already has ${this.maxBuilding()} ${worksWord(this.maxBuilding())} in Building`, now);
      return false;
    }
    if (prior?.status !== "pending" && !stage.freshEachRound) {
      const existing = this.store.stageThread(w.id, no);
      if (existing && (await this.ports.status(existing.thread_id)) !== "unknown") {
        const sendKey = `${e.key}:send`;
        if (this.store.op(sendKey)?.status !== "done") {
          this.store.beginOp(sendKey, w.id, "send", null, now);
          await this.ports.send(existing.thread_id, e.packet ?? inputsChanged(w, stage));
          this.store.finishOp(sendKey, existing.thread_id, now);
        }
        return true;
      }
    }
    // The live check looks at the navigation bar: the plugin's section is put in place before it.
    if (no === 6) await this.applyNav(w, e.key);
    const payload: SpawnPayload = prior?.payload
      ? (JSON.parse(prior.payload) as SpawnPayload)
      : { stage: no, role: "stage", who: "claude", round: this.store.maxRound(w.id, no, "stage") + 1, input: await this.version(w) };
    await this.spawnRun(w, payload, this.stagePrompt(w, no, payload.round, e.packet ?? undefined, e.attemptId ?? null), false, spawnKey);
    return true;
  }

  /**
   * The plugin's section on the navigation bar: per the `NAV` lines of the spec and the iteration files — visible and placed after
   * its neighbour. Only this plugin's sections: a line does not move other plugins' sections. Once per entry into Rollout (the intent
   * key); a failure goes to the journal and does not hold the entry: the live check will see that the section is not in place.
   */
  protected async applyNav(w: Ready, entryKey: string): Promise<void> {
    const key = `${entryKey}:nav`;
    if (this.store.op(key)?.status === "done") return;
    const now = this.ports.now();
    try {
      const files = [docPaths(w.task_key).tz, ...(await this.iterationFiles(w))];
      const texts = await Promise.all(files.map((p) => this.readText(w, p)));
      const lines = navLines(texts.filter((t): t is string => t !== null).join("\n")) ?? [];
      const own = lines.filter((l) => l.panel.startsWith(`${w.plugin_id}/`));
      const foreign = lines.filter((l) => !own.includes(l));
      if (foreign.length > 0) this.store.log(w.id, "warn", `NAV lines not about this plugin were skipped: ${foreign.map((l) => l.panel).join(", ")}`, now);
      if (own.length > 0) {
        const ui = await this.ports.ui.panels();
        let order = ui.order;
        for (const l of own) order = placeAfter(order, l.panel, l.after) ?? order;
        if (order !== ui.order) await this.ports.ui.setOrder(order, ui.orderRevision);
        const hidden = ui.visible === null ? [] : own.map((l) => l.panel).filter((p) => !ui.visible!.includes(p));
        if (hidden.length > 0) await this.ports.ui.setVisible([...ui.visible!, ...hidden], ui.visibleRevision);
        this.store.log(w.id, "nav", `section on the navigation bar: ${own.map((l) => (l.after ? `${l.panel} after ${l.after}` : `${l.panel} at the end`)).join(", ")}`, now);
      }
      this.store.beginOp(key, w.id, "nav", null, now);
      this.store.finishOp(key, "nav", now);
    } catch (err) {
      this.store.log(w.id, "warn", `section not placed on the navigation bar: ${errText(err)} — place it in the navigation bar settings or send the work back`, now);
    }
  }

  /** The stage agent's first message. Stage 6 — always `kickoff` with the attempt facts (`liveCheckPrompt`) as the packet. */
  protected stagePrompt(w: Ready, no: StageNo, round: number, packet: string | undefined, attemptId: string | null): string {
    if (no !== 6) return kickoff(w, stageOf(no), round, packet);
    return kickoff(w, stageOf(6), round, liveCheckPrompt(w, round, this.liveAttempt(w, attemptId), { needsConfiguration: this.needsConfiguration(w) }));
  }

  /** The plugin came up and is waiting for settings (the last confirmed state in VesnALIA). */
  protected needsConfiguration(w: WorkRow): boolean {
    return this.store.plugin(w.plugin_id)?.last_state === "needs-configuration";
  }

  /** The attempt the stage 6 thread checks: from the intent or the plugin's current attempt; only one that finished successfully. */
  protected liveAttempt(w: Ready, attemptId: string | null): AttemptRow {
    const a = attemptId ? this.store.attempt(attemptId) : this.ownAttempt(w);
    if (!a || !this.belongs(a, w) || a.status !== "done" || a.kind === "rollback") throw new Error("there is no finished rollout — nothing to live-check");
    return a;
  }

  protected maxBuilding(): number {
    return Math.max(1, Math.floor(this.limits().maxBuilding));
  }
  protected buildingFull(w: Ready): boolean {
    return this.store.activeBuilding(w.host_id, w.id) >= this.maxBuilding();
  }

  /** Whether at least one thread of the work is busy. A failed status request is an exception, not "free". */
  protected async anyActive(w: Ready, roles: Role[] = ["stage", "review"]): Promise<boolean> {
    if (this.liveSpawns(w, roles) > 0) return true;
    const now = this.ports.now();
    for (const r of this.store.runs(w.id).filter((x) => roles.includes(x.role))) {
      const st = await this.ports.status(r.thread_id);
      // Just received a message from the Workshop (for example, review files) and may not have started its turn yet — busy too.
      const sent = this.store.lastOpAt(w.id, r.thread_id);
      if (BUSY.includes(st) || (st === "idle" && (now - r.created_at < SETTLE_MS || (sent !== null && now - sent < SETTLE_MS)))) return true;
    }
    return false;
  }

  /** Unfinished thread starts (younger than SPAWN_GIVE_UP_MS): the thread may have appeared but is not recorded yet. */
  protected liveSpawns(w: Ready, roles: Role[] = ["stage", "review"], exceptKey?: string): number {
    const now = this.ports.now();
    return this.store.pendingOps(w.id).filter((o) => {
      if (o.kind !== "spawn" || o.key === exceptKey || now - o.created_at >= SPAWN_GIVE_UP_MS) return false;
      const p = o.payload ? (JSON.parse(o.payload) as SpawnPayload) : null;
      return p === null || roles.includes(p.role);
    }).length;
  }

  /** Stop the work's busy threads; true — all are stopped (and there is no unconfirmed start). */
  async stopThreads(w: WorkRow): Promise<boolean> {
    const r = this.ready(w);
    for (const run of this.store.runs(r.id)) {
      const st = await this.ports.status(run.thread_id).catch(() => null);
      if (st === null || BUSY.includes(st)) await this.ports.stop(run.thread_id).catch(() => undefined);
    }
    return !(await this.anyActive(r));
  }

  /** A thread with a recorded intent: after a failure it is found by its key rather than created a second time. Always in the work's worktree. */
  protected async spawnRun(w: Ready, p: SpawnPayload, prompt: string, hidden: boolean, opKey?: string): Promise<string> {
    const key = opKey ?? `${w.id}:${p.stage}:${p.role}:${p.who}:r${p.round}`;
    const op = this.store.op(key);
    if (op?.status === "done" && op.result) return op.result;
    const since = (op?.created_at ?? this.ports.now()) - 1000;
    if (op?.status === "pending") {
      const found = await this.ports.findThread(w.project_id, key, since);
      if (found) return await this.recordRun(w, p, found, key);
      // The previous start is not confirmed: the thread may still appear. A second one — only after SPAWN_GIVE_UP_MS.
      if (this.ports.now() - op.created_at < SPAWN_GIVE_UP_MS) throw new Error("the thread start is not confirmed yet — reconcile will check in a minute");
      this.store.failOp(key, "the thread did not appear", this.ports.now());
    }
    const otherSpawns = this.liveSpawns(w, ["stage", "review"], key) > 0;
    if (!w.environment_id && (this.store.runs(w.id).length > 0 || otherSpawns)) throw new Error("the work's environment is still being created — wait a minute");
    this.store.beginOp(key, w.id, "spawn", JSON.stringify(p), this.ports.now());
    // Provider, model and reasoning level come from the work's choice (the stage group or the reviewer slot).
    const agent = agentOf(modelsOf(w.models), p.role, p.stage, p.who);
    let threadId: string;
    try {
      threadId = await this.ports.spawn({
        projectId: w.project_id,
        environment: w.environment_id ? { kind: "reuse", environmentId: w.environment_id } : { kind: "new-worktree", hostId: w.host_id },
        providerId: agent.providerId,
        model: agent.model,
        reasoningLevel: agent.effort,
        title: threadTitle(w, stageOf(p.stage), p.role, p.who, p.round),
        prompt,
        hidden,
        metadata: { workId: w.id, opKey: key, stage: p.stage, role: p.role, who: p.who },
      });
    } catch (e) {
      // The outcome is unknown: the thread may have appeared (or may appear later). Not found or the search failed — the intent stays
      // "pending": reconcile will find the thread or, after SPAWN_GIVE_UP_MS, declare the start failed.
      const found = await this.ports.findThread(w.project_id, key, since);
      if (!found) throw e;
      threadId = found;
    }
    return await this.recordRun(w, p, threadId, key);
  }

  protected async recordRun(w: Ready, p: SpawnPayload, threadId: string, key: string): Promise<string> {
    const now = this.ports.now();
    const regulation = p.role === "review" ? `review:${p.stage}` : regulationOf(p.stage);
    this.store.tx(() => {
      this.store.addRun({ thread_id: threadId, work_id: w.id, stage: p.stage, role: p.role, who: p.who, round: p.round, input_version: p.input, regulation_sha: sha(regulation), created_at: now });
      this.store.finishOp(key, threadId, now);
    });
    this.store.log(w.id, "thread", `${p.role === "review" ? `reviewer ${this.whoLabel(w, "review", p.stage, p.who)}` : "agent"} · ${stageOf(p.stage).title} · round ${p.round}`, now);
    try {
      await this.ports.tasks.attach(w.task_id, threadId);
      this.store.markAttached(threadId);
    } catch (e) {
      this.store.log(w.id, "warn", `thread not attached to the task: ${errText(e)} — reconcile will retry`, now);
    }
    if (!w.environment_id) await this.adoptEnvironment(w, threadId);
    return threadId;
  }

  /** Finish thread-creation intents interrupted by a failure: record a thread that was found; one not found for long — failed. */
  protected async recoverOps(w: Ready): Promise<void> {
    for (const op of this.store.pendingOps(w.id).filter((o) => o.kind === "spawn")) {
      const p = op.payload ? (JSON.parse(op.payload) as SpawnPayload) : null;
      if (!p) {
        this.store.failOp(op.key, "no intent data", this.ports.now());
        continue;
      }
      const found = await this.ports.findThread(w.project_id, op.key, op.created_at - 1000);
      if (found) await this.recordRun(this.must(w.id), p, found, op.key);
      else if (this.ports.now() - op.created_at > SPAWN_GIVE_UP_MS) {
        this.store.failOp(op.key, "the thread did not appear", this.ports.now());
        this.store.log(w.id, "warn", `thread ${stageOf(p.stage).title} · ${this.whoLabel(w, p.role === "review" ? "review" : "stage", p.stage, p.who)} never appeared`, this.ports.now());
      }
    }
  }

  /** The work's environment is the first thread's worktree. */
  protected async adoptEnvironment(w: Ready, threadId: string): Promise<void> {
    const env = await this.ports.environmentOf(threadId);
    if (!env) return;
    this.store.setEnvironment(w.id, env.environmentId, env.baseBranch, this.ports.now());
    await this.ports.ensureWorkDir(env.environmentId).catch((e) => this.store.log(w.id, "warn", `.superpowers/.gitignore not written: ${errText(e)}`, this.ports.now()));
  }

  /** The tracker task status by stage or outcome; an error — retried on reconcile. */
  protected async taskSync(w: Ready): Promise<void> {
    const want: TaskStatus = w.outcome ?? stageOf(w.stage).taskStatus;
    if (w.task_synced === want) return;
    try {
      await this.ports.tasks.setStatus(w.task_id, want);
      this.store.setTaskSynced(w.id, want);
    } catch (e) {
      this.store.log(w.id, "warn", `task status not updated: ${errText(e)} — reconcile will retry`, this.ports.now());
    }
  }

  /** A task comment: token-shaped text in a note or a reason is redacted before it goes to the tracker. */
  protected async comment(w: Ready, text: string): Promise<void> {
    await this.ports.tasks.comment(w.task_id, redact(text)).catch((e) => this.store.log(w.id, "warn", `task comment not written: ${errText(e)}`, this.ports.now()));
  }

  protected forwardApprovals(w: Ready) {
    return this.store.handovers(w.id).filter((h) => (h.action === "forward" || h.action === "reconfirm") && h.version);
  }

  /** Stages left of the current one whose hand-over is stale. At Rollout too: exactly the verified commit is accepted. */
  protected staleBefore(w: Ready, v: Version): number[] {
    return staleStages(this.forwardApprovals(w), v).filter((s) => before(s, w.stage));
  }

  /**
   * Whether the working copy's main branch has moved ahead of the work branch: the working copy's HEAD is not an ancestor of the work's HEAD.
   * null — cannot tell: no work HEAD, no git, the working copy is not on the main branch (the rollout gate will not let it through anyway).
   */
  protected async baseAheadOf(w: Ready, v: Version): Promise<boolean | null> {
    if (!v.headSha) return null;
    const dir = pluginDir(w.plugin_id);
    const copy = await this.ports.git.facts(dir);
    if (!copy.hasGit || copy.branch !== MAIN_BRANCH || !copy.head) return null;
    return !(await this.ports.git.isAncestor(dir, copy.head, v.headSha));
  }
  /** For gates and buttons: a check right now; if it cannot tell or fails — what reconcile noticed. */
  protected async baseAheadNow(w: Ready, v: Version): Promise<boolean> {
    const live = await this.baseAheadOf(w, v).catch(() => null);
    return live ?? w.base_ahead === 1;
  }

  /** A work file: from the worktree while the work is in progress; from the snapshot once it is finished. */
  protected async readText(w: Ready, rel: string): Promise<string | null> {
    if (!w.outcome && w.environment_id) return await this.ports.read(w.environment_id, rel);
    const f = await this.ports.readSaved(w.id, rel);
    if (!f) return null;
    return f.encoding === "utf8" ? f.content : Buffer.from(f.content, "base64").toString("utf8");
  }
  protected async readRawAny(w: Ready, rel: string): Promise<RawFile | null> {
    if (!w.outcome && w.environment_id) return await this.ports.readRaw(w.environment_id, rel);
    return await this.ports.readSaved(w.id, rel);
  }

  /** Iteration addendum files (`iteration-N.md`) in number order: from the worktree while the work is in progress; from the snapshot once it is finished. */
  protected async iterationFiles(w: Ready): Promise<string[]> {
    const dir = docsDir(w.task_key);
    const all = !w.outcome && w.environment_id ? await this.ports.list(w.environment_id, dir) : await this.ports.listSaved(w.id, dir);
    const num = (p: string) => Number(/iteration-(\d+)\.md$/.exec(p)?.[1] ?? 0);
    return all.filter((p) => isIterationPath(w.task_key, p)).sort((a, b) => num(a) - num(b));
  }

  /** Implementation progress: tasks done in the ledger out of the tasks of the spec and the iteration files; null — there is no ledger. */
  protected async progressOf(w: Ready, tz: string | null, ledger: string | null): Promise<{ done: number; total: number } | null> {
    if (ledger === null) return null;
    const extra = await Promise.all((await this.iterationFiles(w).catch(() => [])).map((p) => this.readText(w, p).catch(() => null)));
    return { done: ledgerDone(ledger), total: planTaskCount([tz ?? "", ...extra.map((t) => t ?? "")].join("\n")) };
  }

  /** Reviewers of the stage's latest round; null — no review was requested. */
  protected async reviewFacts(w: Ready, no: StageNo, v: Version): Promise<ReviewFact[] | null> {
    const round = this.effectiveRound(w, no);
    if (round === 0) return null;
    const out: ReviewFact[] = [];
    for (const who of this.reviewers(w)) {
      const label = this.whoLabel(w, "review", no, who);
      const run = this.store.runs(w.id).find((r) => r.role === "review" && r.stage === no && r.round === round && r.who === who);
      if (!run) {
        out.push({ who: label, round, started: false, verdict: null, invalid: null });
        continue;
      }
      const text = await this.readText(w, reviewPath(w.task_key, stageOf(no).key, who, round));
      out.push({ who: label, round, started: true, verdict: text === null ? null : reviewVerdict(text), invalid: run.invalid_reason ?? resultHolds(no, parseVersion(run.input_version), v) });
    }
    return out;
  }

  /** The report of the latest stage 5 or 6 thread and whether it holds against the current version; null — there was no thread. */
  protected async reportFact(w: Ready, no: 5 | 6, v: Version): Promise<{ verdict: ReturnType<typeof verifyVerdict>; invalid: string | null } | null> {
    const t = this.store.stageThread(w.id, no);
    if (!t) return null;
    const text = await this.readText(w, no === 5 ? verifyPath(w.task_key, t.round) : livePath(w.task_key, t.round));
    return { verdict: text === null ? null : verifyVerdict(text), invalid: resultHolds(no, parseVersion(t.input_version), v) };
  }

  async gateFacts(w: WorkRow, v: Version): Promise<GateFacts> {
    const r = this.ready(w);
    const no = r.stage as StageNo;
    const docs = docPaths(r.task_key);
    const owner = ownerPath(r.task_key);
    const [context, tech, tz, ledger, ownerText] = await Promise.all([
      this.readText(r, docs.context), this.readText(r, docs.tech), this.readText(r, docs.tz), this.readText(r, ledgerPath(docs.tz)), this.readText(r, owner),
    ]);
    const entry = this.store.entry(r);
    const dir = pluginDir(r.plugin_id);
    // Verification: «Roll out» cannot be pressed on top of a running attempt or an undecided failure; Rollout: only a finished rollout is accepted.
    const current = no === 5 || no === 6 ? this.ownAttempt(r) : null;
    return {
      stage: no,
      paths: { ...docs, owner },
      owner: ownerText === null ? null : { open: ownerItems(ownerText).open },
      reviewsHanded: no === 5 ? this.reviewsHanded(r) : null,
      autoReview: this.limits().autoReview !== false,
      reviewers: this.reviewers(w).length,
      exists: { context: context !== null, tech: tech !== null, tz: tz !== null },
      tech: tech === null ? null : techVerdict(tech),
      migrations: tz === null ? null : migrationsFlag(tz),
      nav: no === 3 && tz !== null ? navLines(tz) !== null : null,
      mockup: no === 7 ? await this.mockupFiles(r).then((f) => ({ index: f.includes(`${mockupDir(r.task_key)}/index.html`), error: null }), (e: unknown) => ({ index: false, error: errText(e) })) : null,
      mockupStage: this.limits().mockup !== false,
      reviews: stageOf(no).reviewed ? await this.reviewFacts(r, no, v) : null,
      progress: await this.progressOf(r, tz, ledger),
      verify: no === 5 ? await this.reportFact(r, 5, v) : null,
      // Until the entry into stage 6 is done (the check thread for this attempt is not created yet), the previous report does not count.
      live: no === 6 && !(entry && entry.stage === 6) ? await this.reportFact(r, 6, v) : null,
      attempt: current ? attemptFact(current) : null,
      copy: no === 5 ? ((await this.ports.fs.exists(dir)) ? await this.ports.git.facts(dir) : null) : null,
      baseAhead: building(no) ? await this.baseAheadNow(r, v) : false,
      staleBefore: this.staleBefore(r, v).map((s) => stageOf(s).title),
      dirty: v.dirty,
      queued: r.queued === 1,
      freeDiskGb: no === 5 ? await this.ports.fs.freeDiskGb(PLUGINS_ROOT).catch(() => null) : null,
      minFreeDiskGb: this.limits().minFreeDiskGb,
      publication: building(no) ? await this.publicationOf(r, v) : null,
    };
  }

  /** The policy a verdict is tied to: the owner and whether public or foreign repositories are allowed. */
  protected policyKey(): string {
    const p = this.publishPolicy();
    return `${p.owner.toLowerCase()}|${p.allowPublic ? "any" : "private"}`;
  }
  /** The destination a verdict is tied to: `origin`'s push URLs as they are now ("" — no origin). */
  protected async destinationKey(dir: string): Promise<string> {
    return (await this.ports.github.pushUrls(dir)).join("\n");
  }
  protected recordScan(workId: string, sha: string, dest: string | null, v: Pick<ScanVerdict, "state" | "text">): void {
    // An unknown destination never matches a later one: such a verdict reads as `unscanned` and is computed again.
    const verdict: ScanVerdict = { sha, state: v.state, text: v.text, dest: dest ?? "\0unknown", policy: this.policyKey() };
    this.store.setScan(workId, JSON.stringify(verdict));
  }

  /**
   * Where the work branch's current commit stands for publication (the stored verdict, read fresh): `findings` blocks «To verification» and
   * «Roll out» (what is not published is not rolled out or accepted either), `failed` and `unscanned` are warnings for the owner; for the
   * autopilot anything but `clean` is a hard stop. null — GitHub is off: none of this applies.
   */
  async publicationOf(w: WorkRow, v: Version): Promise<PublicationFact | null> {
    if (!this.githubOn()) return null;
    if (!v.headSha) return { state: "unscanned", text: "the work branch has no commit to check" };
    const scan = scanVerdictOf(this.store.work(w.id) ?? w);
    if (!scan || scan.sha !== v.headSha || scan.policy !== this.policyKey()) return { state: "unscanned", text: "" };
    const dest = await this.destinationKey(pluginDir(w.plugin_id)).catch(() => null);
    if (dest === null || scan.dest !== dest) return { state: "unscanned", text: "" };
    return { state: scan.state, text: scan.text };
  }

  /**
   * The publication check of `sha` right now, without a push (`scanPublication`), and its verdict stored: clean, findings, or failed —
   * a failed request counts as a failed check. Never throws for the check itself.
   */
  async scanNow(w: WorkRow, sha: string): Promise<PublicationFact> {
    const dir = pluginDir(w.plugin_id);
    let dest: string | null = null;
    let verdict: Pick<ScanVerdict, "state" | "text">;
    try {
      dest = await this.destinationKey(dir);
      verdict = verdictOf(await scanPublication(this.ports.github, dir, sha, this.publishPolicy()));
    } catch (e) {
      verdict = { state: "failed", text: `the publication check did not complete: ${redact(errText(e))}` };
    }
    this.recordScan(w.id, sha, dest, verdict);
    return { ...verdict };
  }

  /**
   * For the gates that let the work branch go on (out of Implementation, «Roll out») and the autopilot's hard stops: the verdict on exactly the
   * current commit; without one, the check runs now (scan only, no push). null — GitHub is off.
   */
  async ensureScan(w: WorkRow, v: Version): Promise<PublicationFact | null> {
    const now = await this.publicationOf(w, v);
    if (now === null || now.state !== "unscanned" || !v.headSha) return now;
    return this.scanNow(w, v.headSha);
  }

  /** The `owner.md` checklist: its open items; null — there is no file. A file that cannot be read throws. */
  async ownerChecklist(w: WorkRow): Promise<{ open: string[] } | null> {
    const r = this.ready(w);
    const text = await this.readText(r, ownerPath(r.task_key));
    return text === null ? null : { open: ownerItems(text).open };
  }

  // --- owner buttons ---

  /** «Next» at stages 1–3, «To verification» at 4. From Verification the way forward is «Roll out», from Rollout — «Accept» (Rollout). */
  handOver(workId: string, a: { expectedStage: number; expectedVersion: Version | null; note: string; force: boolean }): Promise<HandOverResult> {
    if (a.expectedStage === 5) return Promise.reject(new Error("this is done by «Roll out»"));
    if (a.expectedStage === 6) return Promise.reject(new Error("this is done by «Accept»"));
    return this.guard(workId, { stage: a.expectedStage, version: a.expectedVersion }, async (w0, version) => {
      const w = this.ready(w0);
      if (w.entry && w.queued !== 1) throw new Error("the stage has not started yet — press «Restart stage» or wait for reconcile");
      // Out of Implementation only with a publication verdict on exactly this commit: without one, the check runs now.
      if (w.stage === 4) await this.ensureScan(w, version);
      const { blockers, warnings } = gate(await this.gateFacts(w, version));
      if (blockers.length > 0 || (warnings.length > 0 && !a.force)) return { ok: false, blockers, warnings };
      const now = this.ports.now();
      const to = nextStage(w.stage as StageNo, this.limits().mockup !== false);
      const record = { work_id: w.id, stage: w.stage, action: "forward" as const, to_stage: to, version, note: a.note.trim(), forced: warnings.length > 0, problems: warnings, at: now };
      const from = stageOf(w.stage);
      const moved = this.store.tx(() => {
        if (!this.store.casStage(w.id, w.stage, to, w.iteration, now)) return false;
        this.store.addHandover(record);
        this.store.setEntry(w.id, { key: `${w.id}:enter:s${to}:i${w.iteration}:t${now}`, stage: to, from: w.stage, packet: null, error: null }, now);
        return true;
      });
      if (!moved) throw new Error("the stage has already changed — refresh the page");
      this.store.log(w.id, "forward", `«${from.title}» → «${stageOf(to).title}»${warnings.length ? " (despite warnings)" : ""}${record.note ? `: ${record.note}` : ""}`, now);
      await this.saveArtifacts(w, false, `s${w.stage}-i${w.iteration}`);
      await this.taskSync(this.must(w.id));
      await this.comment(w, `«${from.title}» handed over — stage «${stageOf(to).title}».${record.note ? ` ${record.note}` : ""}`);
      await this.runEntry(w.id);
      this.ports.changed(w.id);
      return { ok: true, blockers, warnings };
    });
  }

  /**
   * Send the work back to any earlier stage with a reason. From Rollout — only when the plugin's current attempt is a finished
   * rollback, or with `fixForward` («Fix forward»: the rolled-out code stays, the implementer fixes on top of it); `force` alone is
   * not enough. From Verification and Rollout on top of an undecided rollout failure (`failed`/`unknown` of this work) — only `force`
   * together with `fixForward` («Fix forward» via «Hand over anyway»): the owner's choice resolves that attempt in
   * the same transaction as the send-back. Which of these is needed right now is returned by `view` in `sendBack` — the UI does not guess.
   */
  sendBack(workId: string, a: { expectedStage: number; toStage: number; reason: string; fixForward?: boolean; force?: boolean }): Promise<void> {
    return this.guard(workId, { stage: a.expectedStage }, async (w0) => {
      const w = this.ready(w0);
      if (!(STAGE_ORDER.includes(a.toStage as StageNo) && before(a.toStage, w.stage))) throw new Error("a work can only be sent back to a stage left of the current one");
      if (a.toStage === 7 && !this.mockupOn(w)) throw new Error(MOCKUP_OFF);
      const reason = a.reason.trim();
      if (!reason) throw new Error("a reason for sending back is required");
      // Nothing on top of a running install: a send-back from Building and Rollout also waits for an install job of this folder
      // not started by the Workshop. Send-backs within stages 1–3 do not touch the plugin and do not depend on the job list.
      if (isCodeStage(w.stage)) {
        const jobs = await this.ports.plugins.jobs().catch(() => null);
        if (jobs === null) throw new Error(JOBS_UNKNOWN);
        if (runningJobsOf(jobs, pluginDir(w.plugin_id)).length > 0) throw new Error(INSTALL_RUNNING);
      }
      const failure = this.undecided(w);
      // From Rollout — only after a finished rollback or «Fix forward»: `force` alone is not enough, otherwise it would bypass this rule.
      if (w.stage === 6 && !a.fixForward && !this.rolledBack(w)) throw new Error("first «Roll back» or «Fix forward»");
      // On top of an undecided rollout failure — «Fix forward» via «Hand over anyway»: `force` together with `fixForward`.
      if (failure && !(a.force && a.fixForward)) {
        const what = failure.status === "unknown" ? "install outcome unknown" : attemptFailed(failure.kind);
        throw new Error(`${what} — «Roll back», «Disable» or «Fix forward» via «Hand over anyway»`);
      }
      const now = this.ports.now();
      const to = stageOf(a.toStage);
      const from = stageOf(w.stage);
      const forward = failure !== null || (w.stage === 6 && a.fixForward === true && !this.rolledBack(w));
      this.store.tx(() => {
        if (failure) this.store.resolveAttempt(failure.id, now);
        this.sendBackInTx(w, a.toStage as StageNo, reason, now);
      });
      this.store.log(w.id, "back", `sent back «${from.title}» → «${to.title}»${forward ? " (fix forward: the rolled-out code stays)" : ""}: ${reason}`, now);
      await this.saveArtifacts(w, false, `s${w.stage}-i${w.iteration}-back`);
      await this.taskSync(this.must(w.id));
      await this.comment(w, `Sent back to «${to.title}»: ${reason}`);
      await this.runEntry(w.id);
      this.ports.changed(w.id);
    });
  }

  /**
   * After a hand-over or send-back recorded by someone else's transaction (a Rollout attempt outcome) — as in `handOver` and
   * `sendBack`: a snapshot of the work files (optional: a failure goes to the journal), the task status, a task comment. Does not throw.
   */
  async afterMove(w: WorkRow, label: string, text: string): Promise<void> {
    const r = this.ready(w);
    await this.saveArtifacts(r, false, label);
    await this.taskSync(this.must(r.id));
    await this.comment(r, text);
  }

  /** A rollout failure of this work at Verification or Rollout that the owner has not decided on: the current attempt is `failed` or `unknown` without a mark. */
  protected undecided(w: Ready): AttemptRow | null {
    if (w.stage !== 5 && w.stage !== 6) return null;
    const a = this.ownAttempt(w);
    return a && (a.status === "failed" || a.status === "unknown") && a.resolved_at === null ? a : null;
  }

  /** The plugin's current attempt is a finished rollback: the plugin runs the previous version. */
  protected rolledBack(w: Ready): boolean {
    const a = this.ownAttempt(w);
    return a?.kind === "rollback" && a.status === "done";
  }

  /**
   * What `sendBack` will accept right now — for the work page buttons, so that the UI does not guess from the refusal text. From
   * Verification and Rollout on top of an undecided rollout failure: «Fix forward» via «Hand over anyway» (`needsForce`); from
   * Rollout without a failure and without a finished rollback — «Fix forward» (`fixForwardOffered`). Otherwise a plain send-back.
   */
  protected sendBackOffer(w: Ready): { needsForce: boolean; fixForwardOffered: boolean } {
    if (w.outcome) return { needsForce: false, fixForwardOffered: false };
    const needsForce = this.undecided(w) !== null;
    return { needsForce, fixForwardOffered: needsForce || (w.stage === 6 && !this.rolledBack(w)) };
  }

  /** A replacement stage thread when the previous one crashed or vanished, or the stage entry failed. */
  restartStage(workId: string, expectedStage: number): Promise<void> {
    return this.guard(workId, { stage: expectedStage }, async (w0, v) => {
      const w = this.ready(w0);
      if (w.queued === 1) throw new Error("the work is queued for the machine — nothing to restart");
      const stage = stageOf(w.stage);
      if (!(await this.needsRestart(w))) throw new Error("the stage thread is alive — no restart needed; write to the agent in the chat");
      const prev = this.store.stageThread(w.id, w.stage);
      const round = this.store.maxRound(w.id, w.stage, "stage") + 1;
      const e = this.store.entry(w);
      const pending = e && e.stage === w.stage ? e : null;
      let note: string | undefined;
      if (w.stage !== 6) {
        const lines = [prev ? `The previous stage thread ${prev.thread_id} crashed or vanished; continue from the work files.` : null, pending?.packet ?? null];
        note = [...new Set(lines.filter(Boolean))].join("\n\n") || undefined;
      }
      const prompt = this.stagePrompt(w, w.stage as StageNo, round, note, pending?.attemptId ?? null);
      await this.spawnRun(w, { stage: w.stage as StageNo, role: "stage", who: "claude", round, input: v }, prompt, false);
      if (pending) this.settleEntry(w.id, pending.key, null);
      this.store.log(w.id, "restart", `stage «${stage.title}» restarted, round ${round}`, this.ports.now());
      this.ports.changed(w.id);
    });
  }

  /**
   * A restart is needed only when the stage agent is not there: there is no thread, it crashed or vanished, or the stage entry
   * failed. A live thread that finished its turn is not replaced by a restart — a second agent would write to the same worktree.
   */
  protected async needsRestart(w: Ready): Promise<boolean> {
    const e = this.store.entry(w);
    if (e && e.stage === w.stage && e.error) return true;
    const t = this.store.stageThread(w.id, w.stage);
    if (!t) return true;
    const st = await this.ports.status(t.thread_id);
    return st === "error" || st === "unknown";
  }

  /** «Restart stage» makes sense: the work is in progress, not queued, not under an attempt, at Rollout there is a finished rollout, the agent is not there. */
  protected async canRestart(w: Ready): Promise<boolean> {
    if (w.outcome || w.queued === 1 || this.attemptBusy(w)) return false;
    if (w.stage === 6) {
      const a = this.ownAttempt(w);
      if (!a || a.status !== "done" || a.kind === "rollback") return false;
    }
    return await this.needsRestart(w).catch(() => false);
  }

  requestReview(workId: string, expectedStage: number): Promise<void> {
    return this.guard(workId, { stage: expectedStage }, async (w0, v) => {
      const w = this.ready(w0);
      const stage = stageOf(w.stage);
      if (!stage.reviewed) throw new Error(`the «${stage.title}» stage has no review`);
      if (w.queued === 1) throw new Error("the work is queued for the machine");
      if (!w.environment_id) throw new Error("the work's environment is still being created");
      if (building(w.stage) && (await this.baseAheadNow(w, v))) throw new Error(`${BASE_AHEAD}; review comes after that`);
      const now = this.ports.now();
      const latest = this.store.maxRound(w.id, w.stage, "review");
      const runs = this.store.runs(w.id).filter((r) => r.role === "review" && r.stage === w.stage && r.round === latest);
      if (this.reviewers(w).length === 0) throw new Error("this work has no reviewers — chosen at start");
      const missing = this.reviewers(w).filter((who) => !runs.some((r) => r.who === who));
      const fillIn = latest > 0 && missing.length > 0 && runs.every((r) => !r.invalid_reason && parseVersion(r.input_version)?.iteration === w.iteration);
      let round = latest;
      let who: readonly Who[] = missing;
      if (!fillIn) {
        // The stage's previous reviewers, not yet closed by reconcile, are replaced by a new round.
        for (const r of this.store.runs(w.id).filter((x) => x.role === "review" && x.stage === w.stage && x.done_at === null)) {
          await this.ports.stop(r.thread_id).catch(() => undefined);
          this.store.markRunDone(r.thread_id, now);
          this.store.invalidateRun(r.thread_id, "replaced by a new review round");
        }
        round = latest + 1;
        who = this.reviewers(w);
      }
      await this.startReviews(w, v, round, who, true);
    });
  }

  /** A way out for stuck reviewers: stop them and close the round as invalid. */
  stopReviews(workId: string, expectedStage: number): Promise<void> {
    return this.serial(workId, async () => {
      const w = this.open(workId);
      if (w.stage !== expectedStage) throw new Error("the stage has already changed — refresh the page");
      const now = this.ports.now();
      for (const r of this.store.runs(w.id).filter((x) => x.role === "review" && x.done_at === null)) {
        await this.ports.stop(r.thread_id).catch(() => undefined);
        this.store.markRunDone(r.thread_id, now);
        this.store.invalidateRun(r.thread_id, STOPPED_BY_OWNER);
      }
      this.store.log(w.id, "review", "reviewers stopped by the owner", now);
      this.ports.changed(w.id);
    });
  }

  /**
   * «Reconfirm»: a stage document — Context, Feasibility, Spec, Mockup — was edited after the hand-over: the stage is stale and holds
   * the hand-over. The owner looks at the current text and confirms it without restarting agents: a new confirmation record for the
   * on-screen version, the work's stage does not change. Code stages are not confirmed this way: only the verified commit is accepted.
   */
  reconfirm(workId: string, a: { expectedStage: number; stage: number; expectedVersion: Version }): Promise<void> {
    return this.guard(workId, { stage: a.expectedStage, version: a.expectedVersion }, async (w0, v) => {
      const w = this.ready(w0);
      if (!isDocStage(a.stage)) throw new Error("only documents are reconfirmed: Context, Feasibility, Spec, Mockup");
      if (!this.staleBefore(w, v).includes(a.stage)) throw new Error("this stage is not stale — nothing to reconfirm");
      const now = this.ports.now();
      const title = stageOf(a.stage).title;
      this.store.addHandover({ work_id: w.id, stage: a.stage, action: "reconfirm", to_stage: a.stage, version: v, note: "reconfirmed: the document changed after the hand-over", forced: false, problems: [], at: now });
      this.store.log(w.id, "forward", `«${title}» reconfirmed`, now);
      await this.saveArtifacts(w, false, `s${a.stage}-i${w.iteration}-reconfirm`);
      this.ports.changed(w.id);
    });
  }

  // --- cancel and end of the work ---

  /** The cancel intent: its failure (the snapshot did not succeed) keeps the reason on the card until the next transition. */
  protected cancelKey = (workId: string) => `${workId}:cancel`;

  /**
   * Cancel at stages 1–5: threads are stopped, then the cancel snapshot is taken (the whole working tree as a commit under
   * `refs/workshop/<KEY>/canceled`, files that look like secrets go to the plugin data). If it fails — nothing is archived,
   * the worktree and threads stay, the reason is on the card. If it succeeds — `finishWork(canceled)`.
   */
  cancel(workId: string, reason: string): Promise<void> {
    return this.serial(workId, async () => {
      const w0 = this.open(workId);
      if (w0.stage === 6) throw new Error("there is no cancel at Rollout: «Roll back» and send the work back to the implementer, or «Accept»");
      this.refuseDuringAttempt(w0);
      await this.stopThreads(w0);
      await this.guarded(workId, { stage: w0.stage }, async (w) => {
        const note = reason.trim();
        await this.cancelSnapshotOf(w);
        const record = { work_id: w.id, stage: w.stage, action: "cancel" as const, to_stage: w.stage, version: null, note, forced: false, problems: [], at: this.ports.now() };
        await this.finishWork(w, "canceled", note, record);
      });
    });
  }

  /** The cancel snapshot. No environment or the worktree is already removed — nothing to snapshot. A failure — the reason on the card and an exception. */
  protected async cancelSnapshotOf(w: Ready): Promise<void> {
    if (!w.environment_id) return;
    const key = this.cancelKey(w.id);
    let reason: string;
    try {
      const dir = await this.ports.worktreeDir(w.environment_id);
      const r = await cancelSnapshot(this.ports, { id: w.id, task_key: w.task_key, environment_id: w.environment_id, worktreeDir: dir, pluginDir: pluginDir(w.plugin_id) });
      if (r.ok) {
        // The snapshot ref by itself does not count as success — only the ok: true answer does.
        const now = this.ports.now();
        this.store.log(w.id, "save", `cancel snapshot: ${r.sha.slice(0, 7)} under refs/workshop/${w.task_key}/canceled`, now);
        if (r.withheld.length > 0)
          this.store.log(w.id, "warn", `left out of the cancel snapshot and not kept anywhere (listed in its manifest.json): ${withheldText(r.withheld)}`, now);
        if (r.nested.length > 0) this.store.log(w.id, "warn", `a nested repository was left out of the cancel snapshot (its own git history, not checked): ${r.nested.join(", ")}`, now);
        return;
      }
      reason = r.reason;
    } catch (e) {
      if (e instanceof WorktreeGone) {
        this.store.log(w.id, "warn", "the worktree is already removed — no cancel snapshot, nothing more to lose; what was in earlier snapshots remains", this.ports.now());
        return;
      }
      reason = `cancel snapshot failed: ${errText(e)}`;
    }
    const now = this.ports.now();
    this.store.beginOp(key, w.id, "cancel", null, now);
    this.store.failOp(key, reason, now);
    this.store.setState(w.id, "error", reason, w.stale === 1, now);
    this.store.log(w.id, "warn", `${reason} — not canceled: the worktree and threads are in place`, now);
    this.ports.changed(w.id);
    throw new Error(reason);
  }

  /** A failed cancel the card still talks about: since then the owner has not handed over or sent back the work. */
  protected cancelFailure(w: Ready): string | null {
    const op = this.store.op(this.cancelKey(w.id));
    if (op?.status !== "failed") return null;
    const last = this.store.handovers(w.id).at(-1);
    return last && last.at >= op.updated_at ? null : op.error;
  }

  /**
   * End of the work — shared by cancel and acceptance: a snapshot of the work files is mandatory (without it threads are not archived —
   * the worktree would go after them); the outcome and the record — in one transaction; then the comment, the task status and cleanup.
   */
  async finishWork(w: WorkRow, outcome: "done" | "canceled", note: string, record: Omit<HandoverRow, "id">): Promise<void> {
    const r = this.ready(w);
    await this.saveArtifacts(r, true, `final-${outcome}`);
    const now = this.ports.now();
    const finished = this.store.tx(() => {
      if (!this.store.finish(r.id, outcome, now)) return false;
      this.store.addHandover(record);
      return true;
    });
    if (!finished) throw new Error("the work is already finished");
    this.store.log(r.id, outcome, outcome === "done" ? "done" : "canceled", now);
    await this.comment(r, `${outcome === "done" ? "The work is done." : "The work is canceled."}${note.trim() ? ` ${note.trim()}` : ""}`);
    const done = this.must(r.id);
    await this.taskSync(done);
    await this.cleanup(done);
    this.ports.changed(r.id);
  }

  /** Archive the threads of a finished work (VesnALIA removes the worktree by itself); if not everything worked — reconcile will retry. */
  protected async cleanup(w: Ready): Promise<void> {
    let ok = true;
    for (const r of this.store.runs(w.id)) {
      try {
        await this.ports.archive(r.thread_id);
      } catch (e) {
        ok = false;
        this.store.log(w.id, "warn", `thread ${r.thread_id} not archived: ${errText(e)} — reconcile will retry`, this.ports.now());
      }
    }
    if (ok) this.store.setCleanupDone(w.id);
  }

  /** What to save: the work documents (the three main ones, the owner checklist, iterations), its work folder and the implementation ledger folder. */
  protected artifacts(w: Ready, mustExist: string[]): Snapshot {
    const docs = docPaths(w.task_key);
    return { dirs: [workDir(w.task_key), ledgerPath(docs.tz).replace(/\/progress\.md$/, ""), docsDir(w.task_key)], files: [docs.context, docs.tech, docs.tz], mustExist };
  }

  /**
   * A snapshot of the work files into the plugin data. required — without a complete snapshot the action is not carried out: the
   * documents present in the version must make it into the snapshot. A removed worktree can no longer be snapshotted — that is no
   * reason to hold the work forever: what went into earlier snapshots remains.
   */
  protected async saveArtifacts(w: Ready, required: boolean, label: string): Promise<void> {
    if (!w.environment_id) return;
    try {
      let mustExist: string[] = [];
      if (required) {
        const v = await this.version(w);
        const docs = docPaths(w.task_key);
        mustExist = [...(v.contextSha ? [docs.context] : []), ...(v.techSha ? [docs.tech] : []), ...(v.tzSha ? [docs.tz] : [])];
      }
      const r = await this.ports.saveArtifacts(w.id, w.environment_id, this.artifacts(w, mustExist), `${this.ports.now()}-${label}`);
      this.store.log(w.id, "save", `work files snapshot: ${r.saved}`, this.ports.now());
      if (r.withheld.length > 0) this.store.log(w.id, "warn", `not copied into the work files snapshot: ${withheldText(r.withheld)}`, this.ports.now());
    } catch (e) {
      if (e instanceof WorktreeGone) {
        this.store.log(w.id, "warn", "the worktree is already removed — what was in earlier snapshots is kept", this.ports.now());
        return;
      }
      const text = `work files not saved, the action was not carried out: ${errText(e)}`;
      if (required) throw e instanceof MachineUnavailable ? new MachineUnavailable(text) : new Error(text);
      this.store.log(w.id, "warn", `work files snapshot not taken: ${errText(e)}`, this.ports.now());
    }
  }

  // --- reconcile ---

  async reconcileAll(): Promise<void> {
    await Promise.all(
      this.store.unsettledWorks().map((w) =>
        this.reconcile(w.id).catch((e) => {
          try {
            this.store.log(w.id, "warn", `reconcile: ${errText(e)}`, this.ports.now());
          } catch {
            /* the journal is unavailable — reconcile will retry */
          }
        }),
      ),
    );
  }

  /**
   * Reconcile against facts: finishing intents, reviewers, the queue, stage entry, the task, "main branch moved ahead",
   * "stale", the card label. Idempotent. Does not touch a work whose creation is not finished — Creation runs it.
   */
  reconcile(workId: string): Promise<void> {
    return this.serial(workId, async () => {
      let w = this.row(workId);
      if (!w) return;
      if (w.outcome) {
        if (w.cleanup_done === 0) await this.cleanup(w);
        await this.taskSync(this.must(w.id));
        return;
      }
      const now = this.ports.now();
      let machineError: string | null = null;
      let pluginError: string | null = null;
      let stale = w.stale === 1;
      let reviewsDue: string | null = null;
      try {
        await this.recoverOps(w);
        w = this.must(w.id);
        if (!w.environment_id) {
          const first = this.store.runs(w.id)[0];
          if (first) await this.adoptEnvironment(w, first.thread_id);
          w = this.must(w.id);
        }
        await this.closeReviews(w);
        if (w.queued === 1 && !this.buildingFull(w)) {
          this.store.setQueued(w.id, false, now);
          this.store.log(w.id, "queue", "a slot on the machine freed up", now);
        }
        await this.runEntry(w.id);
        w = this.must(w.id);
        await this.taskSync(w);
        for (const r of this.store.runs(w.id).filter((x) => x.attached === 0)) {
          await this.ports.tasks.attach(w.task_id, r.thread_id).then(() => this.store.markAttached(r.thread_id)).catch(() => undefined);
        }
        if (w.environment_id) {
          const v = await this.version(w);
          await this.checkBase(w, v);
          w = this.must(w.id);
          stale = this.staleBefore(w, v).length > 0 || w.base_ahead === 1;
          try {
            reviewsDue = await this.autoReview(w, v);
          } catch (err) {
            this.store.log(w.id, "warn", `review not started: ${errText(err)} — reconcile will retry`, now);
          }
          w = this.must(w.id);
          await this.syncGithub(w, v);
          w = this.must(w.id);
        }
        const e = this.store.entry(w);
        if (e?.error) pluginError = `could not start the stage: ${e.error}`;
      } catch (err) {
        w = this.row(workId) ?? w;
        if (err instanceof MachineUnavailable) machineError = `machine unavailable: ${err.message}`;
        else if (err instanceof WorktreeGone) pluginError = "the work's worktree was removed — cancel the work";
        else pluginError = `reconcile error: ${errText(err)}`;
      }
      pluginError ??= this.cancelFailure(w);
      const current = this.store.stageThread(w.id, w.stage);
      let stageThread: ThreadStatus | null = null;
      if (current) {
        try {
          stageThread = await this.ports.status(current.thread_id);
        } catch (err) {
          pluginError ??= `stage thread status not received: ${errText(err)}`;
        }
      }
      const attempt = this.cardAttempt(w);
      // Hints are not errors: they do not hide the machine and reconcile failures.
      const waiting = this.store.entry(w);
      if (!attempt && !machineError && waiting && !waiting.error && isCodeStage(waiting.stage) && w.queued !== 1 && this.attemptBusy(w)) {
        pluginError ??= `entry into the «${stageOf(waiting.stage).title}» stage is waiting: the plugin has an install running or the build lock is held`;
      }
      if (w.stage === 6 && !attempt && !machineError) pluginError ??= this.liveReason(w);
      const { state, reason } = cardState({
        stage: w.stage,
        outcome: w.outcome,
        queued: w.queued === 1,
        stageThread,
        reviewsPending: this.store.runs(w.id).filter((r) => r.role === "review" && r.done_at === null).length,
        machineError,
        pluginError,
        attempt,
        needsConfiguration: w.stage === 6 && this.needsConfiguration(w),
        reviewsDue,
      });
      if (this.store.setState(w.id, state, reason, stale, now)) this.ports.changed(w.id);
    });
  }

  /** The latest GitHub failure text for a work: reconcile runs every minute, but a failure is written to the journal once per text. */
  private readonly githubErrors = new Map<string, string>();
  /** The retry pause after a GitHub failure: until when and for which branch commit. */
  private readonly githubPause = new Map<string, { head: string; until: number }>();
  /** What is wrong with GitHub for the work right now (for the autopilot and the page); null — everything is pushed. */
  githubProblem(workId: string): string | null {
    return this.githubErrors.get(workId) ?? null;
  }
  /** GitHub is on: the repositories' owner is set in the settings. */
  githubOn(): boolean {
    return (this.limits().githubOwner ?? GITHUB_OWNER) !== "";
  }

  /** Who may receive published code: the configured owner's private repositories, or any with «Allow public repositories». */
  publishPolicy(): PublishPolicy {
    return { owner: this.limits().githubOwner ?? GITHUB_OWNER, allowPublic: this.limits().allowPublicRepos === true };
  }

  /** The one content-bearing push (publish.ts): the destination check, the scan of exactly what GitHub does not have yet, then exactly `sha`. */
  publish(dir: string, sha: string, branch: string): Promise<PublishResult> {
    return publish(this.ports.github, dir, sha, branch, this.publishPolicy());
  }

  /**
   * GitHub as the source of truth. If the plugin has no `origin` — create the repository (`<owner>/alia-plugin-<id>`, private) and publish main
   * with its whole history; every new work branch commit is published (the exact commit to the branch, without `--force`); from
   * Implementation on — a PR from the branch into main. Every push goes through the publication gate (`publish`): a repository that is not
   * private or not the owner's, something like a key in the new commits, or an incomplete scan — nothing is pushed. The verdict on the work
   * branch commit is kept (`gh_scan`, `ScanVerdict`): clean, findings or failed. Until the commit has a verdict of its own, a failure on the
   * way (the first push of main, the destination, a request) is recorded as `failed` with its reason; a pushed commit without a current
   * verdict is checked again (scan only). A failure goes to the journal once per text and is retried on the next reconcile.
   */
  protected async syncGithub(w: Ready, v: Version): Promise<void> {
    if (!v.headSha || !w.environment_id || !this.githubOn()) return;
    const head = v.headSha;
    const dir = pluginDir(w.plugin_id);
    const now = this.ports.now();
    // After a failure — a pause (the network call runs inside the work's queue: owner buttons and the autopilot would wait for it every minute); a new commit lifts it.
    const pause = this.githubPause.get(w.id);
    if (pause && pause.head === head && now < pause.until) return;
    let judged = false;
    try {
      const policy = this.publishPolicy();
      let remote = await this.ports.github.remote(dir);
      if (!remote) {
        remote = await this.ports.github.ensureRepo(policy.owner, `alia-plugin-${w.plugin_id}`, `alia plugin ${w.plugin_id}`);
        await this.ports.github.setRemote(dir, remote);
        // Only main: branches of other worktrees (alia/*) are not needed on GitHub. If a repository with this name already existed with a
        // different history, git's refusal ("non-fast-forward") goes to the journal in words below.
        const main = (await this.ports.git.facts(dir)).head;
        if (main) {
          const r = await this.publish(dir, main, MAIN_BRANCH);
          if (!r.ok) throw new Error(r.kind === "destination" ? r.reason : `main ${r.reason}`);
        }
        this.store.log(w.id, "github", `plugin repository on GitHub: ${remote.replace(/\.git$/, "")}`, now);
      }
      if (w.pushed_sha !== head) {
        const branch = (await this.ports.git.facts(await this.ports.worktreeDir(w.environment_id))).branch;
        if (!branch || branch === MAIN_BRANCH) throw new Error(`the work branch is not determined (${branch ?? "detached HEAD"})`);
        // Keys do not go to GitHub: every commit GitHub does not have yet is checked before the push — per commit rather than as a tree diff:
        // a key added and removed right away would still be in the history.
        // The gate's verdict is the commit's, whatever happens to the push after it (a refused push goes to the journal, not into the verdict).
        const dest = await this.destinationKey(dir);
        const g = await publicationGate(this.ports.github, dir, head, policy);
        this.recordScan(w.id, head, dest, verdictOf(g));
        judged = true;
        if (!g.ok) throw new Error(g.kind === "secrets" ? `the work branch ${g.reason}` : g.reason);
        await this.ports.github.push(dir, g.clearance, branch);
        this.store.setPushed(w.id, head, branch);
        if (atOrAfter(w.stage, 4) && w.pr_url === null) await this.openPr(w, dir, g.clearance.repo, branch, now);
      } else {
        // Already on GitHub, but no verdict for this commit, destination and policy (they changed since, or an older record), or a check that
        // failed: checked again (scan only). A failed check waits for the retry pause like any other failure.
        const known = await this.publicationOf(w, v);
        if (known?.state === "unscanned" || known?.state === "failed") {
          const again = await this.scanNow(w, head);
          judged = true;
          if (again.state === "failed") throw new Error(again.text);
        }
        judged = true;
        if (atOrAfter(w.stage, 4) && w.pr_url === null) {
          // The branch is already on GitHub, but there is no PR yet (the work reached Implementation without a new commit, or the previous attempt to open it failed).
          const branch = (await this.ports.git.facts(await this.ports.worktreeDir(w.environment_id))).branch;
          if (!branch || branch === MAIN_BRANCH) throw new Error(`the work branch is not determined (${branch ?? "detached HEAD"})`);
          const d = await checkDestination(this.ports.github, dir, policy);
          if (!d.ok) throw new Error(d.reason);
          await this.openPr(w, dir, d.dest.repo, branch, now);
        }
      }
      this.githubErrors.delete(w.id);
      this.githubPause.delete(w.id);
    } catch (e) {
      this.githubPause.set(w.id, { head, until: now + GITHUB_RETRY_MS });
      let text = redact(errText(e));
      if (/non-fast-forward|rejected/i.test(text)) text = `GitHub refused the push (GitHub has a different history — a repository with this name already existed or the branch was rewritten): ${text}`;
      // No completed check of this commit yet: the failure on the way is its verdict — the gates and the autopilot see it, not only the journal.
      // A completed check (clean or findings) for the same commit, destination and policy stays: a later failure does not undo it.
      if (!judged) {
        const known = await this.publicationOf(w, v).catch(() => null);
        if (known?.state !== "clean" && known?.state !== "findings") this.recordScan(w.id, head, await this.destinationKey(dir).catch(() => null), { state: "failed", text });
      }
      if (this.githubErrors.get(w.id) === text) return;
      this.githubErrors.set(w.id, text);
      this.store.log(w.id, "warn", `GitHub: ${text} — reconcile will retry`, now);
    }
  }

  /** The work branch PR in the checked repository; an address that is not a PR of exactly that repository is neither stored nor shown. */
  protected async openPr(w: Ready, dir: string, repo: string, branch: string, now: number): Promise<void> {
    const answer = await this.ports.github.openPr(dir, repo, branch, `${w.task_key}: ${w.title}`, prBody(w));
    const url = prUrlOf(answer, repo);
    if (!url) throw new Error(`GitHub answered the PR request with something that is not a PR of ${repo} — not recorded`);
    this.store.setPr(w.id, url);
    this.store.log(w.id, "github", `work branch PR: ${url}`, now);
    await this.comment(w, `PR on GitHub: ${url} — merged into main on «Accept».`);
  }

  /** "Main branch moved ahead" — only in Building; leaving it, the work loses the mark. A failed check does not change the mark. */
  protected async checkBase(w: Ready, v: Version): Promise<void> {
    const now = this.ports.now();
    if (!building(w.stage)) {
      this.store.setBaseAhead(w.id, false, now);
      return;
    }
    let ahead: boolean | null;
    try {
      ahead = await this.baseAheadOf(w, v);
    } catch (e) {
      this.store.log(w.id, "warn", `the working copy's main branch was not checked: ${errText(e)}`, now);
      return;
    }
    if (ahead === null || !this.store.setBaseAhead(w.id, ahead, now)) return;
    this.store.log(w.id, "base", ahead ? BASE_AHEAD : "the working copy's main branch is an ancestor of the work branch again", now);
  }

  /**
   * The plugin attempt the work card has to talk about. A running one — at any stage: a rollback runs even when the work has gone
   * back to Implementation. A closed `failed` or `unknown` attempt of this work — at Verification (a failed rollout leaves the work at
   * stage 5) and at Rollout, while it is the plugin's current attempt and the owner has not resolved it: the `resolved_at` mark
   * («Roll back», «Disable», «Install again» — Rollout) or a next attempt. The plugin's state in the catalog does not count as a decision.
   */
  protected cardAttempt(w: Ready): AttemptFact | null {
    const open = this.store.openAttemptOf(w.plugin_id);
    if (open) return attemptFact(open);
    if (w.stage !== 5 && w.stage !== 6) return null;
    const cur = this.ownAttempt(w);
    if (!cur || cur.status === "done" || cur.resolved_at !== null) return null;
    return attemptFact(cur);
  }

  /**
   * The work is at Rollout, but there is no rolled-out code to check and accept (the card no longer talks about the attempt):
   * what the owner should do. null — the rollout finished successfully, the check thread and the gate decide from here.
   */
  protected liveReason(w: Ready): string | null {
    const cur = this.ownAttempt(w);
    if (!cur) return "there is no rollout attempt — send the work back to the implementer";
    if (cur.status === "done") return cur.kind === "rollback" ? "the plugin was rolled back — send the work back to the implementer" : null;
    // A failure the owner resolved while the work stayed at Rollout: that is «Disable» — a rollback or a retry makes another attempt current.
    return removedText(cur);
  }

  /**
   * A reviewer finished (the thread stopped or crashed; a failed status request is an exception, nothing is closed) — close it. Without
   * a review file the round is invalid: reconcile will repeat it. When the whole valid round (both) is closed, the stage agent gets the
   * files: at Spec — "close the items", at Verification — the verifier, "confirm or refute against the code". The delivery key is per
   * receiving thread: after «Restart stage» the new agent gets the files again. The agent is not interrupted in the middle of its turn.
   */
  protected async closeReviews(w: Ready): Promise<void> {
    const env = w.environment_id;
    if (!env) return;
    const now = this.ports.now();
    for (const r of this.store.runs(w.id).filter((x) => x.role === "review" && x.done_at === null)) {
      const st = await this.ports.status(r.thread_id);
      if (!(st === "error" || st === "unknown" || (st === "idle" && now - r.created_at > SETTLE_MS))) continue;
      const path = reviewPath(w.task_key, stageOf(r.stage).key, r.who as Who, r.round);
      const text = await this.ports.read(env, path);
      const head = await this.ports.head(env);
      const input = parseVersion(r.input_version);
      this.store.markRunDone(r.thread_id, now);
      const label = this.whoLabel(w, "review", r.stage as StageNo, r.who as Who);
      if (text === null) {
        this.store.invalidateRun(r.thread_id, NO_REVIEW_FILE);
        this.store.log(w.id, "review", `${label} finished without the file ${path} — the round is invalid`, now);
      } else if (input?.headSha && head.sha && head.sha !== input.headSha) {
        this.store.invalidateRun(r.thread_id, `the code changed during the review (${input.headSha.slice(0, 7)} → ${head.sha.slice(0, 7)})`);
        this.store.log(w.id, "review", `review by ${label} is invalid: the code changed`, now);
      }
      await this.ports.stop(r.thread_id).catch(() => undefined);
    }
    if (w.stage !== 3 && w.stage !== 5) return;
    const no = w.stage as 3 | 5;
    const runs = this.completeRound(w, no);
    if (!runs) return;
    const round = runs[0]!.round;
    const target = this.store.stageThread(w.id, no);
    if (!target) return;
    const key = this.handedKey(w, no, round, target.thread_id);
    if (this.store.op(key)?.status === "done") return;
    if ((await this.ports.status(target.thread_id)) !== "idle") return;
    const files = runs.map((r) => reviewPath(w.task_key, stageOf(no).key, r.who as Who, round));
    this.store.beginOp(key, w.id, "send", null, now);
    await this.ports.send(target.thread_id, no === 3 ? reviewsReady(w, files) : reviewsForVerifier(w, files, target.round));
    this.store.finishOp(key, target.thread_id, now);
  }

  /** The key for "the round's files were handed to this stage thread". */
  protected handedKey(w: Ready, no: StageNo, round: number, threadId: string): string {
    return `${w.id}:${no}:reviews-ready:r${round}:${threadId}`;
  }

  /** The stage's latest review round, if it is closed completely (both reviewers) and valid; otherwise null. */
  protected completeRound(w: Ready, no: StageNo): ReturnType<Store["runs"]> | null {
    const round = this.store.maxRound(w.id, no, "review");
    if (round === 0) return null;
    const runs = this.store.runs(w.id).filter((r) => r.role === "review" && r.stage === no && r.round === round);
    if (this.reviewers(w).some((who) => !runs.some((r) => r.who === who && r.done_at !== null))) return null;
    if (runs.some((r) => r.invalid_reason)) return null;
    return runs;
  }

  /**
   * The round the gate judges by: the latest one, unless it was stopped entirely by the owner — then the previous one (the owner
   * stopped an extra round rather than declining the review). 0 — there were no rounds.
   */
  protected effectiveRound(w: Ready, no: StageNo): number {
    const max = this.store.maxRound(w.id, no, "review");
    for (let round = max; round >= 1; round--) {
      const runs = this.store.runs(w.id).filter((r) => r.role === "review" && r.stage === no && r.round === round);
      if (runs.length > 0 && runs.every((r) => r.invalid_reason === STOPPED_BY_OWNER)) continue;
      return round;
    }
    return max;
  }

  /**
   * Verification: the review round's files went to the current verifier. While the round is running or reconcile has not closed it
   * yet — false: the rollout does not get ahead of the verifier. null — there is no round or it is invalid (the review gate says so).
   */
  protected reviewsHanded(w: Ready): boolean | null {
    const round = this.effectiveRound(w, 5);
    if (round === 0) return null;
    const runs = this.store.runs(w.id).filter((r) => r.role === "review" && r.stage === 5 && r.round === round);
    if (runs.some((r) => r.invalid_reason)) return null;
    const t = this.store.stageThread(w.id, 5);
    return t !== null && this.store.op(this.handedKey(w, 5, round, t.thread_id))?.status === "done";
  }

  /**
   * Review without a button. Spec: the agent finished its turn and the spec is ready (it has a MIGRATIONS line) — the iteration's first
   * round, if the spec changed since the previous review; the agent closed the items of a round with a blocking finding — another
   * round; a round without a review file is repeated; up to AUTO_REVIEW_ROUNDS rounds per iteration in total. Verification — together
   * with the verifier, one valid round per code version (a failed one is repeated, up to AUTO_REVIEW_ROUNDS). A round missing a
   * reviewer (its start failed) is filled in. Returns the card label when a review is about to start, otherwise null.
   */
  protected async autoReview(w: Ready, v: Version): Promise<string | null> {
    if (this.limits().autoReview === false || this.reviewers(w).length === 0) return null;
    if ((w.stage !== 3 && w.stage !== 5) || w.outcome || w.queued === 1 || !w.environment_id) return null;
    if (this.store.entry(w) || this.attemptBusy(w)) return null;
    const no = w.stage as 3 | 5;
    const stageRun = this.store.stageThread(w.id, no);
    if (!stageRun) return null;
    const reviews = this.store.runs(w.id).filter((r) => r.role === "review" && r.stage === no);
    if (reviews.some((r) => r.done_at === null) || this.liveSpawns(w, ["review"]) > 0) return null;
    // A round "holds" for what it ran against: Spec — for the iteration, Verification — also for the commit.
    const ours = (r: (typeof reviews)[number]) => {
      const iv = parseVersion(r.input_version);
      return iv?.iteration === v.iteration && (no === 3 || iv.headSha === v.headSha);
    };
    const failed = (r: (typeof reviews)[number]) => r.invalid_reason === NO_REVIEW_FILE;
    const latest = this.store.maxRound(w.id, no, "review");
    const latestRuns = reviews.filter((r) => r.round === latest);
    const missing = this.reviewers(w).filter((who) => !latestRuns.some((r) => r.who === who));
    const codeMoving = async () => no === 5 && (v.dirty || !v.headSha || (await this.baseAheadNow(w, v)));
    if (latest > 0 && missing.length > 0 && latestRuns.every((r) => !r.invalid_reason && ours(r))) {
      if (await codeMoving()) return null;
      await this.startReviews(w, v, latest, missing);
      return null;
    }
    const mine = reviews.filter(ours);
    const rounds = [...new Set(mine.map((r) => r.round))];
    if (no === 5) {
      // A round for this code version already holds or was stopped by the owner — a second one does not start by itself; a failed one is repeated.
      const settled = rounds.some((round) => !mine.filter((r) => r.round === round).some(failed));
      if (settled || rounds.length >= AUTO_REVIEW_ROUNDS || (await codeMoving())) return null;
      await this.startReviews(w, v, latest + 1, this.reviewers(w));
      return null;
    }
    if ((await this.ports.status(stageRun.thread_id)) !== "idle") return null;
    const tz = await this.readText(w, docPaths(w.task_key).tz);
    if (tz === null || migrationsFlag(tz) === null) return null;
    let due = "the spec review is about to start";
    if (rounds.length === 0) {
      // A new iteration: a spec that was already reviewed does not go to review without an edit — the agent may not have started it yet.
      const prev = reviews.filter((r) => !ours(r)).sort((a, b) => b.round - a.round)[0];
      const prevTz = prev ? parseVersion(prev.input_version)?.tzSha : null;
      if (prevTz && prevTz === v.tzSha) return null;
    } else {
      if (rounds.length >= AUTO_REVIEW_ROUNDS || !latestRuns.every(ours)) return null;
      // Stopped by the owner or the code changed — the round does not repeat by itself; without a file — it does.
      if (latestRuns.some((r) => r.invalid_reason && !failed(r))) return null;
      if (!latestRuns.some(failed)) {
        // The next round — only after the current agent has received the round's files and closed the items.
        if (this.store.op(this.handedKey(w, 3, latest, stageRun.thread_id))?.status !== "done") return null;
        const verdicts = await Promise.all(latestRuns.map(async (r) => {
          const text = await this.readText(w, reviewPath(w.task_key, stageOf(3).key, r.who as Who, r.round));
          return text === null ? null : reviewVerdict(text);
        }));
        if (!verdicts.includes("blocking")) return null;
        due = "the agent got the reviews and is closing the items — then another round";
      }
    }
    // The thread has just received a message from the Workshop and may not have started its turn yet: wait rather than review unfinished work.
    const sent = this.store.lastOpAt(w.id, stageRun.thread_id) ?? stageRun.created_at;
    if (this.ports.now() - sent < SETTLE_MS) return due;
    await this.startReviews(w, v, latest + 1, this.reviewers(w));
    return null;
  }

  /** The round's reviewers — in the work's worktree, hidden: they see only the files. */
  protected async startReviews(w: Ready, v: Version, round: number, who: readonly Who[], byOwner = false): Promise<void> {
    const stage = stageOf(w.stage);
    for (const x of who) await this.spawnRun(w, { stage: w.stage as StageNo, role: "review", who: x, round, input: v }, reviewerPrompt(w, stage, x, round), true);
    const what = who.length === this.reviewers(w).length ? "" : ` (${who.map((x) => this.whoLabel(w, "review", w.stage as StageNo, x)).join(", ")})`;
    this.store.log(w.id, "review", `review «${stage.title}», round ${round}${what}${byOwner ? "" : " — started automatically"}`, this.ports.now());
    this.ports.changed(w.id);
  }

  // --- views ---

  board(): Card[] {
    const recent = this.ports.now() - 30 * 86_400_000;
    return this.store
      .works()
      .filter(isReady)
      .filter((w) => !w.outcome || (w.finished_at ?? 0) > recent)
      .map((w) => ({ id: w.id, key: w.task_key, title: w.title, projectId: w.project_id, stage: w.stage, state: w.state, reason: w.state_reason, stale: w.stale === 1, iteration: w.iteration, updatedAt: w.updated_at }));
  }

  async view(workId: string): Promise<WorkViewCore> {
    const w = this.must(workId);
    const env = w.environment_id;
    const docs = docPaths(w.task_key);
    const text = async (p: string) => await this.readText(w, p).catch(() => null);
    let version: Version | null = null;
    let blockers: string[] = [];
    let warnings: string[] = [];
    let staleSet = new Set<number>();
    if (!w.outcome) {
      try {
        version = await this.version(w);
        staleSet = new Set(this.staleBefore(w, version));
        ({ blockers, warnings } = gate(await this.gateFacts(w, version)));
      } catch (e) {
        blockers = [`could not read the work files: ${errText(e)}`];
      }
    }
    const runs = this.store.runs(w.id);
    const handovers = this.store.handovers(w.id);
    const stages: StageView[] = [];
    const mockupOn = this.mockupOn(w);
    for (const s of STAGES) {
      if (s.no === 7 && !mockupOn) continue;
      const files: StageView["files"] = [];
      const add = async (path: string, label: string, verdict: (t: string) => string | null) => {
        const t = await text(path);
        if (t !== null) files.push({ path, label, verdict: verdict(t) });
      };
      if (s.no === 1) await add(docs.context, "Context", () => null);
      if (s.no === 2) {
        await add(docs.tech, "Feasibility", techVerdict);
        await add(ownerPath(w.task_key), "Needed from the owner", () => null);
      }
      if (s.no === 3) await add(docs.tz, "Spec", () => null);
      if (s.no === 7) {
        const all = await this.mockupFiles(w).catch(() => [] as string[]);
        const label = (p: string) => (p.endsWith("/index.html") ? "Mockup" : `Mockup · ${p.split("/").pop()}`);
        // The mockup itself first, then screenshots and the rest — in name order.
        for (const p of all.sort((a, b) => Number(!a.endsWith("/index.html")) - Number(!b.endsWith("/index.html")) || a.localeCompare(b))) files.push({ path: p, label: label(p), verdict: null });
      }
      if (s.no === 4) {
        await add(ledgerPath(docs.tz), "Implementation ledger", () => null);
        for (const p of await this.iterationFiles(w).catch(() => [] as string[])) await add(p, `Iteration ${/iteration-(\d+)\.md$/.exec(p)?.[1] ?? "?"}`, () => null);
      }
      if (s.no === 5) for (let round = 1; round <= this.store.maxRound(w.id, 5, "stage"); round++) await add(verifyPath(w.task_key, round), `Verification report · r${round}`, verifyVerdict);
      for (const r of runs.filter((x) => x.stage === s.no && x.role === "review"))
        await add(reviewPath(w.task_key, s.key, r.who as Who, r.round), `Review ${this.whoLabel(w, "review", s.no, r.who as Who)} · r${r.round}`, reviewVerdict);
      if (s.no === 6) {
        for (let round = 1; round <= this.store.maxRound(w.id, 6, "stage"); round++) await add(livePath(w.task_key, round), `Live check · r${round}`, verifyVerdict);
        const shotsDir = `${workDir(w.task_key)}/shots`;
        const shots = !w.outcome && env ? await this.ports.list(env, shotsDir).catch(() => []) : await this.ports.listSaved(w.id, shotsDir).catch(() => []);
        for (const p of shots) files.push({ path: p, label: p.split("/").pop()!, verdict: null });
      }
      let progress: StageView["progress"] = null;
      if (s.no === 4) {
        const [ledger, tz] = await Promise.all([text(ledgerPath(docs.tz)), text(docs.tz)]);
        progress = await this.progressOf(w, tz, ledger).catch(() => null);
      }
      const h = handovers.filter((x) => x.stage === s.no).at(-1) ?? null;
      stages.push({
        no: s.no, title: s.title, ownerCheck: s.ownerCheck, agent: s.agent, reviewed: s.reviewed, current: s.no === w.stage, stale: staleSet.has(s.no) && before(s.no, w.stage),
        threads: await Promise.all(
          runs.filter((r) => r.stage === s.no).map(async (r) => ({
            threadId: r.thread_id, role: r.role, who: this.whoLabel(w, r.role === "review" ? "review" : "stage", r.stage as StageNo, r.who as Who), round: r.round,
            status: await this.ports.status(r.thread_id).catch(() => "unknown"), done: r.done_at !== null, invalid: r.invalid_reason,
          })),
        ),
        files, progress,
        handover: h ? { at: h.at, action: h.action, note: h.note, forced: h.forced } : null,
      });
    }
    const own = this.ownAttempt(w);
    const ownerText = w.outcome ? null : await text(ownerPath(w.task_key));
    return {
      work: {
        id: w.id, key: w.task_key, title: w.title, request: w.request, pluginId: w.plugin_id, kind: w.kind, created: true, projectId: w.project_id, stage: w.stage,
        iteration: w.iteration, state: w.state, reason: w.state_reason, stale: w.stale === 1, queued: w.queued === 1, environmentId: env, outcome: w.outcome,
        createdAt: w.created_at, canRestart: await this.canRestart(w),
      },
      version, blockers, warnings, stages,
      events: this.store.events(w.id).map((e) => ({ at: e.at, kind: e.kind, text: e.text })),
      baseAhead: w.base_ahead === 1,
      attempt: own ? attemptView(own) : null,
      sendBack: this.sendBackOffer(w),
      reconfirm: STAGE_ORDER.filter((s) => staleSet.has(s) && isDocStage(s) && before(s, w.stage)),
      ownerNeeds: ownerText === null ? [] : ownerItems(ownerText).open,
      returnByReport: version ? await this.returnByReport(w, version).catch(() => null) : null,
    };
  }

  /**
   * «Send back to Implementation per report»: a red verification report (stage 5) or live check report (stage 6) — a send-back with one
   * button, the reason is the report path. At Rollout without a rollback — «Fix forward». On top of an undecided rollout failure there is
   * no button: the owner decides there.
   */
  protected async returnByReport(w: Ready, v: Version): Promise<{ toStage: number; reason: string; fixForward: boolean } | null> {
    if (w.outcome || (w.stage !== 5 && w.stage !== 6)) return null;
    const offer = this.sendBackOffer(w);
    if (offer.needsForce) return null;
    const no = w.stage as 5 | 6;
    // At Rollout after «Install again» the previous round's report is no longer about this rollout: the new round's thread is still being created.
    if (no === 6 && this.store.entry(w)?.stage === 6) return null;
    const t = this.store.stageThread(w.id, no);
    const fact = await this.reportFact(w, no, v);
    if (!t || !fact || fact.invalid || fact.verdict !== "fail") return null;
    const report = no === 5 ? verifyPath(w.task_key, t.round) : livePath(w.task_key, t.round);
    const what = no === 5 ? `Verification, round ${t.round}` : `Live check, round ${t.round}`;
    return { toStage: 4, reason: `${what}: FAIL. Fix everything the report \`${report}\` calls a failure or a confirmed review finding.`, fixForward: no === 6 && offer.fixForwardOffered };
  }

  /** Work files only: documents, the owner checklist, iterations, the implementation ledger, the work folder (reports, reviews, screenshots). A finished work — from the snapshot. */
  async file(workId: string, path: string): Promise<FileView> {
    const w = this.must(workId);
    const docs = docPaths(w.task_key);
    const dir = `${workDir(w.task_key)}/`;
    const named = [docs.context, docs.tech, docs.tz, ledgerPath(docs.tz), ownerPath(w.task_key)];
    const inside = (base: string) => path.startsWith(`${base}/`) && !path.split("/").includes("..");
    const allowed = named.includes(path) || isIterationPath(w.task_key, path) || inside(dir.replace(/\/$/, "")) || inside(mockupDir(w.task_key));
    if (!allowed || path.includes("\0")) throw new Error("this file cannot be opened");
    // The same file-name rule as the snapshots: a key file is not shown, nor handed to the autopilot.
    if (secretFileName(path)) throw new Error("this file cannot be opened: a key file by name");
    const raw = await this.readRawAny(w, path).catch((e: unknown) => {
      if (e instanceof SymlinkRefused) throw new Error("this file cannot be opened: a symbolic link");
      throw e;
    });
    if (!raw) throw new Error("no such file");
    if (raw.encoding === "utf8") return { mime: raw.mime, text: raw.content, data: null, size: raw.size };
    return { mime: raw.mime, text: null, data: raw.content, size: raw.size };
  }

  /**
   * For configure: who this thread is. configure arrives at thread start — before its row is recorded;
   * then the stage and role are taken from the spawn metadata. The metadata is untrusted: an invalid value counts as absent.
   */
  identityOf(threadId: string, meta: unknown): string | null {
    const run = this.store.run(threadId);
    if (run) {
      const w = this.row(run.work_id);
      return w ? identity(w, stageOf(run.stage), run.role) : null;
    }
    const m = (meta !== null && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
    const w = typeof m.workId === "string" ? this.row(m.workId) : null;
    if (!w) return null;
    const metaStage = STAGES.find((s) => s.no === m.stage && Number.isInteger(m.stage));
    const role: Role = m.role === "review" || m.role === "stage" ? m.role : "stage";
    return identity(w, metaStage ?? stageOf(w.stage), role);
  }
}

/** "1 work", "2 works". */
function worksWord(n: number): string {
  return n === 1 ? "work" : "works";
}
