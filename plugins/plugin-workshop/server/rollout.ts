// Plugin Workshop: rollout, acceptance, rollback, «Disable» and «Enable», reinstall and cancelling an install job.
// Everything goes by the attempt record (table attempts): a step is recorded before its action (compare-and-swap `stepAttempt`), the action
// is repeatable or recognized from facts after a restart, an unknown outcome is never repeated blindly, and the build lock is held until
// it is proven that no install of this folder is running. Spec: «Rollout», «Rollback», «Disable and enable», «Nothing on top of a running
// install», «External actions»; bb behavior relied on: source form, merging of install jobs, cancellation, finished jobs kept ~10 minutes.
import { randomUUID } from "node:crypto";
import { rolledBackOnGithub, type Catalog, type PluginFacts } from "./catalog";
import { errText, type Engine, type HandOverResult } from "./engine";
import { editsText, gate, MAIN_BRANCH } from "./gates";
import { JOB_RUNNING, runningJobsOf, sourcePath, type GitFacts, type InstallJob, type InstalledPlugin, type Ports } from "./ports";
import { CANCEL_EXCLUDE } from "./snapshot";
import { pluginDir, SELF_ID } from "./stages";
import { attemptFailed, attemptNoun, INSTALL_RUNNING, JOBS_UNKNOWN, UNEXPECTED_COPY } from "./state";
import type { AttemptPatch, AttemptRow, AttemptStep, Store, WorkRow } from "./store";
import type { Version } from "./versions";

export type CopyState = "before" | "after" | "interrupted" | "unexpected";

/**
 * State of the working copy relative to the transition from → to (spec, rollout step 3): HEAD = to and clean — the transition is done; HEAD = from
 * and clean — not started yet; HEAD = to, but files and index exactly as in from (`equalsFrom` = `copyEquals(dir, from)`, no new files) —
 * the command was interrupted between the ref and the files; anything else is unexpected. A transition to the same commit (from = to) with a clean tree is done.
 */
export function classifyCopy(f: { head: string | null; clean: boolean; equalsFrom: boolean }, from: string, to: string): CopyState {
  if (f.head === to && f.clean) return "after";
  if (f.head === from && f.clean) return "before";
  if (f.head === to && f.equalsFrom) return "interrupted";
  return "unexpected";
}

/** Actions on the plugin: null — available, otherwise — why not (the label of the disabled button). */
export interface Availability {
  rollback: string | null;
  reinstall: string | null;
  disable: string | null;
  enable: string | null;
  cancelInstall: string | null;
  /** «Adopt as rolled out». */
  adopt: string | null;
}

/** bb lists for one decision; null — the list did not arrive (the action is then not started). */
interface Live {
  list: InstalledPlugin[] | null;
  jobs: InstallJob[] | null;
}

const short = (s: string | null) => (s ? s.slice(0, 7) : "—");
/** Git text in an attempt error is no longer than this: the full text is in the git journal, while the error goes onto the card. */
const GIT_TEXT_MAX = 300;
/** How many `git status` lines to name in the «unexpected state» error. */
const DIRTY_LIST_MAX = 10;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
/**
 * Short poll within a pass on the `locking` and `installed` steps: the lock holder comes up in a fraction of a second, a quick install
 * finishes in seconds — no point waiting for the once-a-minute reconcile. Longer — the next pass (reconcile or a bb event about jobs).
 */
const POLL_MS = 10_000;
const POLL_STEP_MS = 500;
const newAttemptId = () => `att_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** How many characters of the diff to read when deciding about migrations for «Adopt as rolled out»; more — data is assumed to have changed. */
const ADOPT_DIFF_MAX = 2_000_000;
/** Files that do not touch plugin data: docs, tests. */
const NOT_CODE = /(^|\/)(docs?|tests?|__tests__)\/|\.(md|txt)$|\.test\.[jt]sx?$|(^|\/)README/i;
/** Signs of a data change in diff lines: schema SQL, migrations, plugin storage. */
const DATA_LINE = /\bCREATE\s+(UNIQUE\s+|VIRTUAL\s+|TEMP(ORARY)?\s+)?(TABLE|INDEX|VIEW|TRIGGER)\b|\b(ALTER|DROP)\s+(TABLE|INDEX|VIEW|TRIGGER)\b|\buser_version\b|\bmigrat|bb\.storage\.database/i;

/**
 * Whether the change touched plugin data («Adopt as rolled out»): a changed code file with «migrat» in its path, or an added/removed
 * code line with a schema, a migration or plugin storage. Docs and tests do not count. When in doubt (the diff is longer than the limit) — yes:
 * rollback is then closed, as with a contradictory MIGRATIONS line on rollout.
 */
export function touchesData(names: string[], diff: string, truncated: boolean): boolean {
  if (truncated) return true;
  if (names.some((n) => !NOT_CODE.test(n) && /migrat/i.test(n))) return true;
  let code = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // A quoted path (spaces, non-ASCII) or a rename cannot be parsed reliably — such a file counts as code.
      const m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      code = !m || !NOT_CODE.test(m[1]!) || !NOT_CODE.test(m[2]!);
      continue;
    }
    if (code && (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---") && DATA_LINE.test(line)) return true;
  }
  return false;
}
const BASE_AHEAD = "the working copy's main branch has moved ahead — the implementer is pulling it in";
const NO_LIST = "the plugin list did not arrive — the action does not start";
const NO_POINT = "no rollback point";
const FOREIGN_WAIT = "waiting for another install of this folder";
const NOT_UNKNOWN = "a retry is only possible when the install outcome is unknown";
const STOPPING = "wait: the work's threads are still stopping";

/**
 * Queue of actions on a plugin — one for all Rollout instances over the same database (repeated wiring, tests with a «restart»): a second
 * instance in the same process does not bypass it. Across processes (and module instances), order is kept by the step records (CAS).
 */
const CHAINS = new WeakMap<Store, Map<string, Promise<unknown>>>();

function describeCopy(f: GitFacts, from: string, to: string): string {
  if (!f.hasGit) return "the plugin folder has no git";
  const parts = [`HEAD ${short(f.head)}, expected ${short(from)} or ${short(to)}`];
  if (f.branch !== MAIN_BRANCH) parts.push(f.branch === null ? "HEAD is detached" : `branch ${f.branch}`);
  if (f.dirtyCount > 0) parts.push(`${editsText(f.dirtyCount)} in the working copy`);
  return parts.join("; ");
}

export class Rollout {
  constructor(
    private readonly store: Store,
    private readonly ports: Ports,
    private readonly engine: Engine,
    private readonly catalog: Catalog,
    private readonly opts: {
      cancelSupported: boolean;
      /**
       * Stop signal (the service is stopped, the plugin is unloading): the short step poll exits at once, without a step error, and the pass
       * does not take further attempts — the next reconcile finishes them from the records.
       */
      stop?: () => AbortSignal | undefined;
    },
  ) {}

  /** One action on a plugin at a time: rollout, acceptance, rollback, reinstall, «Disable»/«Enable», job cancellation and attempt reconcile. */
  private serial<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
    let chains = CHAINS.get(this.store);
    if (!chains) CHAINS.set(this.store, (chains = new Map()));
    const prev = chains.get(pluginId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(pluginId, next.catch(() => undefined));
    return next;
  }

  // --- owner buttons ---

  /**
   * «Roll out» from Verification: under the stage-5 `guard` and the on-screen version — nothing on top of a running install, the stage-5 gate,
   * the attempt record (before the first change) and the handover in one transaction; then the attempt's steps, as far as possible right now. The work
   * moves to Rollout only on a successful outcome. A step failure after recording is an exception; the reconcile will finish the attempt.
   */
  enter(workId: string, a: { expectedVersion: Version; force: boolean }): Promise<HandOverResult> {
    const w0 = this.store.work(workId);
    if (!w0) return Promise.reject(new Error("work not found"));
    return this.serial(w0.plugin_id, async () => {
      let recorded: string | null = null;
      const result = await this.engine.guard(workId, { stage: 5, version: a.expectedVersion, duringAttempt: true }, async (w, v): Promise<HandOverResult> => {
        const dir = pluginDir(w.plugin_id);
        await this.releaseIdle(w.plugin_id);
        const live = await this.live();
        const busy = this.busy(w.plugin_id, live, true);
        if (busy) throw new Error(busy);
        // Rollout only with a publication verdict on exactly this commit: without one, the check runs now (scan only, no push).
        await this.engine.ensureScan(w, v);
        const facts = await this.engine.gateFacts(w, v);
        const { blockers, warnings } = gate(facts);
        const copy = await this.ports.git.facts(dir);
        if (!v.headSha) blockers.push("the work branch has no commit — nothing to roll out");
        if (copy.hasGit && copy.head === null) blockers.push("the working copy has no commits");
        // `target` must be a descendant of `before`: the gate knows this from the reconcile; here — right before recording.
        if (copy.head && v.headSha && !blockers.includes(BASE_AHEAD) && !(await this.ports.git.isAncestor(dir, copy.head, v.headSha))) blockers.push(BASE_AHEAD);
        // GitHub is the source of truth. main commits that exist only on GitHub would be lost by the rollout (main would not reach GitHub after «Accept»).
        if (v.headSha) {
          const gh = await this.githubBehind(w.plugin_id, v.headSha);
          if (gh.blocker) blockers.push(gh.blocker);
          if (gh.warning) warnings.push(gh.warning);
        }
        if (blockers.length > 0 || (warnings.length > 0 && !a.force)) return { ok: false, blockers, warnings };
        const p = live.list!.find((x) => x.id === w.plugin_id) ?? null;
        const point = this.inheritedPoint(w.plugin_id);
        const id = newAttemptId();
        const now = this.ports.now();
        this.store.tx(() => {
          this.store.addAttempt({
            id, plugin_id: w.plugin_id, work_id: w.id, kind: "enter", target_sha: v.headSha,
            // Rollback point: the copy's HEAD — or the one inherited from a failed rollout whose code has already been merged; the branch then
            // moves from where it is now (`from_sha`).
            before_sha: point ? point.before_sha : copy.head,
            from_sha: point ? copy.head : null,
            // No MIGRATIONS line, or a contradictory one — migrations are assumed: rollback is then unavailable. Migrations of a
            // failed rollout that got past the merge may already have run — they count too; before the merge nothing was installed.
            // A point that is itself inherited (`from_sha`) carries the migrations of the link before it — they cannot be checked, so they
            // count too (conservative: rollback gets closed, not opened).
            migrations: facts.migrations === false && !(point && (this.pastMove(point) || point.from_sha !== null) && point.migrations) ? 0 : 1,
            was_installed: point ? point.was_installed : p ? 1 : 0,
            was_enabled: point ? point.was_enabled : p?.enabled ? 1 : 0,
            want_enabled: 1, started_at: now,
          });
          this.store.addHandover({ work_id: w.id, stage: 5, action: "forward", to_stage: 6, version: v, note: `rollout, attempt ${id}`, forced: warnings.length > 0, problems: warnings, at: now });
        });
        this.store.log(w.id, "rollout", `rollout: ${short(copy.head)} → ${short(v.headSha)}${warnings.length ? " (despite warnings)" : ""}`, now);
        if (point) this.store.log(w.id, "rollout", `rollback point — ${short(point.before_sha)}, same as the failed attempt ${point.id}`, now);
        recorded = id;
        return { ok: true, blockers, warnings };
      });
      if (recorded) await this.drive(recorded);
      return result;
    });
  }

  /**
   * Whether main on GitHub has commits that are not in `head` (the work branch): a rollout blocker. No `origin` — nothing to check; the network did
   * not answer — a warning (rollout is possible with «Hand over anyway»; main goes to GitHub later or shows the divergence).
   */
  private async githubBehind(pluginId: string, head: string): Promise<{ blocker?: string; warning?: string }> {
    if (!this.engine.githubOn()) return {};
    const dir = pluginDir(pluginId);
    try {
      if (!(await this.ports.github.remote(dir))) return {};
      await this.ports.github.fetch(dir);
      const theirs = await this.ports.github.remoteSha(dir, MAIN_BRANCH);
      if (!theirs || (await this.ports.git.isAncestor(dir, theirs, head))) return {};
      // GitHub has a commit that was rolled back after acceptance: it must not be pulled in; rollout is possible, main will diverge from GitHub after «Accept».
      if (rolledBackOnGithub(this.store, pluginId, theirs))
        return { warning: `main on GitHub still has the rolled-back commit ${short(theirs)} — after «Accept» main will diverge from GitHub; a revert on GitHub is needed (by hand)` };
      return { blocker: "main on GitHub has commits that are not in the work branch — first «Adopt as rolled out» on the plugin card (it pulls them in), then the implementer pulls main into the work branch" };
    } catch (e) {
      return { warning: `GitHub was not checked before the rollout: ${errText(e)}` };
    }
  }

  /**
   * After «Accept» and «Adopt as rolled out»: main — the rolled-out commit — goes to GitHub (the plugin's GitHub reconcile pushes it under the rule
   * «main = rolled out»), the work branch is deleted on GitHub — main already contains it. A failure — the «GitHub behind» label, retried by the reconcile.
   */
  private async publish(pluginId: string, branch: string | null): Promise<void> {
    if (!this.engine.githubOn()) return;
    await this.catalog.githubOne(pluginId).catch(() => undefined);
    const row = this.store.plugin(pluginId);
    if (!branch || !row?.gh_remote || row.gh_error || (row.gh_ahead ?? 1) !== 0) return;
    // The branch goes only after GitHub has marked the PR merged: deleting it earlier would close the PR unmerged. Not marked — the branch stays.
    const dir = pluginDir(pluginId);
    if (!(await this.ports.github.prMerged(dir, branch).catch(() => false))) return;
    await this.ports.github.deleteBranch(dir, branch).catch(() => undefined);
    const w = this.store.works().find((x) => x.plugin_id === pluginId && x.pushed_branch === branch);
    if (w) this.store.clearPushedBranch(w.id);
  }

  /**
   * The plugin's GitHub reconcile — in the plugin's queue: fetch and push do not cut across rollout, acceptance and pulling. Along the way, branches
   * of accepted works whose PR GitHub has already marked merged (right after «Accept» there is usually no mark yet) are deleted on GitHub.
   */
  githubOne(pluginId: string): Promise<void> {
    if (!this.engine.githubOn()) return Promise.resolve();
    return this.serial(pluginId, async () => {
      await this.catalog.githubOne(pluginId);
      const dir = pluginDir(pluginId);
      for (const w of this.store.works().filter((x) => x.plugin_id === pluginId && x.outcome === "done" && x.pushed_branch !== null)) {
        if (!(await this.ports.github.prMerged(dir, w.pushed_branch!).catch(() => false))) continue;
        await this.ports.github.deleteBranch(dir, w.pushed_branch!).then(
          () => this.store.clearPushedBranch(w.id),
          // The branch is already gone from GitHub — cleaned up as well.
          (e: unknown) => (/remote ref does not exist|unable to delete/i.test(errText(e)) ? this.store.clearPushedBranch(w.id) : undefined),
        );
      }
    });
  }

  /** A GitHub reconcile pass over all plugins on the board — one at a time. */
  async syncGithub(): Promise<void> {
    for (const row of this.store.plugins().filter((r) => r.gone_reason === null && r.dir !== null)) await this.githubOne(row.id).catch(() => undefined);
  }

  /**
   * «Accept» on Rollout: under the stage-6 `guard` and the on-screen version; the attempt id is the current attempt of this work's plugin, the stage-6 gate (finished rollout, live-check report for the rolled-out commit) → `finishWork(done)`. The rollback point stays
   * with the plugin until the next rollout or rollback.
   */
  accept(workId: string, a: { expectedVersion: Version; attemptId: string; force: boolean; note: string }): Promise<HandOverResult> {
    const w0 = this.store.work(workId);
    if (!w0) return Promise.reject(new Error("work not found"));
    return this.serial(w0.plugin_id, async () => {
      const r = await this.acceptInGuard(workId, a);
      if (r.ok) await this.publish(w0.plugin_id, this.store.work(workId)?.pushed_branch ?? null);
      return r;
    });
  }

  private acceptInGuard(workId: string, a: { expectedVersion: Version; attemptId: string; force: boolean; note: string }): Promise<HandOverResult> {
    return this.engine.guard(workId, { stage: 6, version: a.expectedVersion, duringAttempt: true }, async (w, v): Promise<HandOverResult> => {
        const cur = this.store.currentAttempt(w.plugin_id);
        // Only this work's attempt: an attempt without a work («Adopt as rolled out») does not belong to the work.
        if (!cur || cur.id !== a.attemptId || cur.work_id !== w.id) throw new Error("the attempt has changed — refresh the page");
        const { blockers, warnings } = gate(await this.engine.gateFacts(w, v));
        if (blockers.length > 0 || (warnings.length > 0 && !a.force)) return { ok: false, blockers, warnings };
        const note = a.note.trim();
        const record = { work_id: w.id, stage: 6, action: "forward" as const, to_stage: 6, version: v, note: `accepted, attempt ${cur.id}${note ? `: ${note}` : ""}`, forced: warnings.length > 0, problems: warnings, at: this.ports.now() };
        await this.engine.finishWork(w, "done", note, record);
        return { ok: true, blockers, warnings };
    });
  }

  /**
   * «Roll back» by the record of the plugin's current attempt: the code goes back to `before` (the same recognition as the merge, in reverse),
   * install under the lock, the plugin enabled or not — as before the rollout. A new plugin (not installed before the rollout) — disabling only.
   * From Verification and Rollout the work's threads stop first; the rollback outcome sends the work back to Implementation in its own transaction.
   */
  rollback(pluginId: string, reason: string): Promise<void> {
    const why = reason.trim();
    if (!why) return Promise.reject(new Error("a rollback reason is required"));
    return this.serial(pluginId, async () => {
      await this.releaseIdle(pluginId);
      const f = await this.facts(pluginId);
      const live = await this.live();
      const p = live.list?.find((x) => x.id === pluginId) ?? null;
      const block = this.busy(pluginId, live, true) ?? this.rollbackBlock(f, p);
      if (block) throw new Error(block);
      const cur = this.store.currentAttempt(pluginId)!;
      const w = this.workOf(cur);
      const touches = w !== null && (w.stage === 5 || w.stage === 6);
      if (touches && !(await this.engine.stopThreads(w))) throw new Error(STOPPING);
      const fresh = cur.was_installed === 0;
      const record = async () =>
        this.record(pluginId, cur.id, (id, now) => {
          this.store.addAttempt({
            id, plugin_id: pluginId, work_id: cur.work_id, kind: "rollback",
            before_sha: cur.target_sha, target_sha: fresh ? cur.target_sha : cur.before_sha, migrations: cur.migrations,
            was_installed: p ? 1 : 0, was_enabled: p?.enabled ? 1 : 0, want_enabled: fresh ? 0 : cur.was_enabled,
            started_at: now, origin_id: cur.id, note: why,
          });
          // A new plugin: no merge, lock or install — straight to disabling (the card does not say «waiting for the build lock»).
          if (fresh) this.store.stepAttempt(id, "recorded", "state-set", {}, now);
        });
      const id = touches ? await this.engine.guard(w.id, { stage: w.stage, duringAttempt: true }, record) : await record();
      this.note(this.store.attempt(id)!, "rollout", fresh ? `rollback of a new plugin — disabling: ${why}` : `rollback to ${short(cur.before_sha)}: ${why}`);
      await this.drive(id);
    });
  }

  /**
   * «Install again» — only with an unknown, undecided outcome and the working copy's HEAD = the attempt's commit: then a retry is safe.
   * Retrying a rollback is another rollback by the same record; retrying a rollout is reinstalling the same commit with the same rollback point.
   */
  reinstall(pluginId: string): Promise<void> {
    return this.serial(pluginId, async () => {
      await this.releaseIdle(pluginId);
      const f = await this.facts(pluginId);
      const live = await this.live();
      const block = this.busy(pluginId, live, true) ?? this.reinstallBlock(f);
      if (block) throw new Error(block);
      const cur = this.store.currentAttempt(pluginId)!;
      const w = this.workOf(cur);
      const touches = w !== null && (w.stage === 5 || w.stage === 6);
      if (touches && cur.kind === "rollback" && !(await this.engine.stopThreads(w))) throw new Error(STOPPING);
      const record = async () =>
        this.record(pluginId, cur.id, (id, now) => {
          const again = cur.kind === "rollback";
          this.store.addAttempt({
            id, plugin_id: pluginId, work_id: cur.work_id, kind: again ? "rollback" : "reinstall",
            before_sha: cur.before_sha, target_sha: cur.target_sha, migrations: cur.migrations,
            was_installed: cur.was_installed, was_enabled: cur.was_enabled, want_enabled: cur.want_enabled,
            started_at: now, origin_id: again ? cur.origin_id : cur.id, note: cur.note, from_sha: cur.from_sha,
          });
          this.store.resolveAttempt(cur.id, now);
        });
      const id = touches ? await this.engine.guard(w.id, { stage: w.stage, duringAttempt: true }, record) : await record();
      this.note(this.store.attempt(id)!, "rollout", `install again: ${short(cur.target_sha)}`);
      await this.drive(id);
    });
  }

  /**
   * «Adopt as rolled out»: the owner approves a change made in the working copy bypassing the Workshop (the main branch
   * moved ahead of the rolled-out commit). This is a rollout without a work: the current HEAD is installed under the build lock (dependencies too), the
   * previous rolled-out commit becomes the rollback point. There is no merge: the working copy is already at `target`. Whether the change touched data —
   * `touchesData` on the diff: if yes, rollback is closed (data cannot be brought back).
   */
  adopt(pluginId: string, note: string): Promise<void> {
    const why = note.trim();
    if (!why) return Promise.reject(new Error("a reason is required: what the change is and why it is being adopted"));
    return this.serial(pluginId, async () => {
      await this.releaseIdle(pluginId);
      const live = await this.live();
      const busy = this.busy(pluginId, live, true);
      if (busy) throw new Error(busy);
      // GitHub is the source of truth: changes that exist only on GitHub are pulled in here too — fast-forward, in the plugin's queue, before the checks.
      await this.pullFromGithub(pluginId, await this.facts(pluginId));
      const f = await this.facts(pluginId);
      const p = live.list?.find((x) => x.id === pluginId) ?? null;
      const block = this.adoptBlock(f, p) ?? (f.git?.head === f.row.installed_sha ? "the main branch is at the rolled-out commit — nothing to adopt (and nothing new on GitHub)" : null);
      if (block) throw new Error(block);
      const dir = pluginDir(pluginId);
      const head = f.git!.head!;
      const installed = f.row.installed_sha!;
      if (!(await this.ports.git.isAncestor(dir, installed, head))) throw new Error(`the rolled-out commit ${short(installed)} is not an ancestor of ${short(head)} — cannot adopt, a work is needed`);
      const changed = await this.ports.git.diffNames(dir, installed, head);
      const diff = await this.ports.git.diffText(dir, installed, head, ADOPT_DIFF_MAX + 1);
      const id = newAttemptId();
      const now = this.ports.now();
      this.store.addAttempt({
        id, plugin_id: pluginId, work_id: null, kind: "enter", before_sha: installed, target_sha: head,
        migrations: touchesData(changed, diff, diff.length > ADOPT_DIFF_MAX) ? 1 : 0,
        was_installed: 1, was_enabled: p!.enabled ? 1 : 0, want_enabled: p!.enabled ? 1 : 0, started_at: now,
        note: `adopted as rolled out: ${why}`,
      });
      await this.drive(id);
      const a = this.store.attempt(id)!;
      if (a.status === "failed" || a.status === "unknown") throw new Error(`${attemptFailed("enter")}: ${a.error ?? a.status}`);
      if (a.status === "done") await this.publish(pluginId, null);
    });
  }

  /**
   * main on GitHub is ahead of the working copy (and only ahead): fast-forward the copy to it. The copy is not on main or has changes, a work is open, or
   * main diverged from GitHub — nothing is touched (`adoptBlock` or the card label says what is next). No `origin` — nothing to pull.
   */
  private async pullFromGithub(pluginId: string, f: PluginFacts): Promise<void> {
    if (!this.engine.githubOn()) return;
    const dir = pluginDir(pluginId);
    const g = f.git;
    if (f.work || !g?.hasGit || !g.head || g.branch !== MAIN_BRANCH || g.dirtyCount > 0) return;
    if (!(await this.ports.github.remote(dir))) return;
    await this.ports.github.fetch(dir);
    const theirs = await this.ports.github.remoteSha(dir, MAIN_BRANCH);
    if (!theirs || theirs === g.head || rolledBackOnGithub(this.store, pluginId, theirs)) return;
    const c = await this.ports.github.counts(dir, g.head, theirs);
    if (c.ahead > 0 && c.behind > 0) throw new Error("the working copy's main diverged from GitHub — cannot adopt, a work is needed (or sorting it out by hand)");
    if (c.behind > 0) await this.ports.github.ffOnly(dir, `origin/${MAIN_BRANCH}`);
  }

  /** «Adopt as rolled out»: the main branch moved ahead of the rolled-out commit, the working copy is clean, no work is open on the plugin. */
  private adoptBlock(f: PluginFacts, p: InstalledPlugin | null): string | null {
    if (f.work) return `work ${f.work.task_key ?? "(being created)"} is open on the plugin — the change goes through it`;
    if (f.row.id === SELF_ID) return "the Workshop itself is not adopted this way — it is installed by hand";
    if (!p) return "the plugin is not installed in bb";
    if (f.row.installed_sha === null) return "the rolled-out commit is unknown — there is nothing to compare the change against";
    const g = f.git;
    if (g === null) return f.gitError !== undefined ? `could not read git: ${f.gitError}` : "no plugin working copy";
    if (!g.hasGit) return "the working copy has no git";
    if (g.branch !== MAIN_BRANCH) return g.branch === null ? `the working copy is not on branch ${MAIN_BRANCH} (detached HEAD)` : `the working copy is on branch ${g.branch}, not ${MAIN_BRANCH}`;
    if (g.dirtyCount > 0) return `${editsText(g.dirtyCount)} in the working copy — commit or discard first`;
    // Newer on GitHub (as of the last reconcile) — adopting is possible: `adopt` pulls first.
    if (!g.head || g.head === f.row.installed_sha)
      return (f.row.gh_behind ?? 0) > 0 && (f.row.gh_ahead ?? 0) === 0 && !f.row.gh_error && f.row.gh_rolled !== 1 ? null : "the main branch is at the rolled-out commit — nothing to adopt";
    return null;
  }

  /**
   * «Disable» (`disable`) and «Enable» (`enable`): code and data stay; whether it worked is decided by the plugin list. «Disable» after a failure is
   * the owner's decision: the attempt is marked resolved.
   */
  setEnabled(pluginId: string, on: boolean): Promise<void> {
    return this.serial(pluginId, async () => {
      await this.releaseIdle(pluginId);
      await this.facts(pluginId);
      const live = await this.live();
      const p = live.list?.find((x) => x.id === pluginId) ?? null;
      const block = this.busy(pluginId, live, true) ?? (on ? this.enableBlock(p) : this.disableBlock(pluginId, p));
      if (block) throw new Error(block);
      const now = this.ports.now();
      if (on) await this.ports.plugins.enable(pluginId);
      else {
        if (p?.enabled) {
          try {
            await this.ports.plugins.disable(pluginId);
          } catch (e) {
            // The answer was lost, or bb answered «already disabled»: the list decides. The list did not arrive or the plugin is enabled — refuse.
            const again = await this.installedPlugin(pluginId).catch(() => undefined);
            if (again === undefined || again?.enabled) throw e;
          }
        }
        // «Disable» after a failure is the owner's decision: it is marked as soon as the plugin is disabled (also if it already was), before the
        // check by the list — a list failure does not lose it, and the gate does not stay closed with no way out.
        const cur = this.undecided(pluginId);
        if (cur) this.store.resolveAttempt(cur.id, now);
      }
      const after = (await this.ports.plugins.list()).find((x) => x.id === pluginId) ?? null;
      if (!on && after?.enabled) throw new Error(`the plugin did not turn off: ${after.state}`);
      const work = this.store.openWorkOf(pluginId);
      if (work) this.store.log(work.id, "rollout", on ? "plugin enabled again" : "plugin disabled", now);
      if (work?.created === 1) await this.engine.reconcile(work.id);
      if (on && (!after?.enabled || (after.state !== "running" && after.state !== "needs-configuration"))) {
        throw new Error(`the plugin is enabled but not working: ${after ? `${after.state}${after.error ? ` (${after.error})` : ""}` : "it is not in the bb list"}`);
      }
    });
  }

  /**
   * «Try to cancel install»: only calls `cancelJob`. The outcome is not assumed — a cancelled running
   * job may still end `succeeded`; the attempt waits for the job's final state and goes on as usual.
   */
  cancelInstall(pluginId: string): Promise<void> {
    return this.serial(pluginId, async () => {
      const live = await this.live();
      const block = this.cancelBlock(pluginId, live);
      if (block) throw new Error(block);
      const ids = this.cancelTargets(pluginId, live.jobs!);
      for (const id of ids) await this.ports.plugins.cancelJob(id);
      const open = this.store.openAttemptOf(pluginId);
      const workId = open ? open.work_id : this.store.openWorkOf(pluginId)?.id;
      if (workId) {
        this.store.log(workId, "rollout", `trying to cancel the install: ${ids.join(", ")} — the job will show the outcome`, this.ports.now());
        this.ports.changed(workId);
      }
    });
  }

  /** Which actions on the plugin are available now (buttons of the plugin summary and of the work page). */
  async availability(pluginId: string): Promise<Availability> {
    const f = await this.catalog.one(pluginId);
    if (!f) {
      const no = "the plugin is not on the board";
      return { rollback: no, reinstall: no, disable: no, enable: no, cancelInstall: no, adopt: no };
    }
    return this.availabilityOf(f, await this.live());
  }

  /**
   * Availability for the board: from the cards' ready facts (git — from the cache); the plugin and install-job lists — one request for all.
   * The actions themselves re-read the facts live, so a stale cache can at most show a button that then refuses with a reason.
   */
  async availabilityFor(facts: PluginFacts[]): Promise<Map<string, Availability>> {
    if (facts.length === 0) return new Map();
    const live = await this.live();
    return new Map(facts.map((f) => [f.row.id, this.availabilityOf(f, live)]));
  }

  private availabilityOf(f: PluginFacts, live: Live): Availability {
    const pluginId = f.row.id;
    // The lock of a closed attempt is released by the action itself when no install of this folder is running: it does not affect availability.
    const busy = this.busy(pluginId, live, false);
    const p = live.list?.find((x) => x.id === pluginId) ?? null;
    return {
      rollback: busy ?? this.rollbackBlock(f, p),
      reinstall: busy ?? this.reinstallBlock(f),
      disable: busy ?? this.disableBlock(pluginId, p),
      enable: busy ?? this.enableBlock(p),
      cancelInstall: this.cancelBlock(pluginId, live),
      adopt: busy ?? this.adoptBlock(f, p),
    };
  }

  // --- attempt reconcile ---

  /** Drive the attempt by its record as far as possible now (waiting for the lock or a job — returns). A step failure is an exception. */
  advance(attemptId: string): Promise<void> {
    const a = this.store.attempt(attemptId);
    if (!a) return Promise.resolve();
    return this.serial(a.plugin_id, async () => {
      const before = this.store.attempt(attemptId);
      if (!before || before.status !== "running") return;
      await this.run(attemptId);
      const now = this.store.attempt(attemptId)!;
      if (now.step !== before.step || now.status !== before.status) await this.after(attemptId);
    });
  }

  /**
   * Reconcile (once a minute and on bb events about install jobs and the plugin list): running attempts move on by their record, on the
   * lock and install steps — with a short poll; for closed `unknown`/`failed` attempts that may still hold the build lock,
   * the lock is released only when the job list has no running job of this folder (the list did not arrive — keep holding).
   */
  async advanceAll(): Promise<void> {
    for (const a of this.store.openAttempts()) {
      if (this.opts.stop?.()?.aborted) return;
      // The step failure is written to the work's journal; the next reconcile retries.
      await this.advance(a.id).catch(() => undefined);
    }
    for (const a of this.store.lockedAttempts()) {
      if (a.status === "running") continue;
      await this.serial(a.plugin_id, () => this.releaseIfIdle(a.id)).catch(() => undefined);
    }
  }

  // --- attempt steps ---

  /** Drive the attempt and update the work's card. */
  private async drive(id: string): Promise<void> {
    await this.run(id);
    await this.after(id);
  }

  private async run(id: string): Promise<void> {
    for (let i = 0; i < 40; i++) {
      const a = this.store.attempt(id);
      if (!a || a.status !== "running") return;
      let moved: boolean;
      try {
        moved = await this.step(a);
      } catch (e) {
        const cur = this.store.attempt(id);
        if (cur?.status === "running") this.note(cur, "warn", `${attemptNoun(cur.kind)}: step «${cur.step}» interrupted: ${errText(e)} — the reconcile will continue`);
        throw e;
      }
      if (!moved) return;
    }
  }

  /** One step: the step's action and recording the next one. true — can go on; false — wait (lock, job), the attempt is closed, or another call did the step. */
  private step(a: AttemptRow): Promise<boolean> {
    switch (a.step) {
      case "recorded":
        return this.recorded(a);
      case "moved":
        return this.move(a);
      case "locking":
        return this.locking(a);
      case "locked":
        return this.locked(a);
      case "installing":
        return this.installing(a);
      case "installed":
        return this.installed(a);
      case "released":
        return this.released(a);
      case "state-set":
        return this.stateSet(a);
      case "checked":
        return this.checked(a);
    }
  }

  private cas(a: AttemptRow, to: AttemptStep, patch: AttemptPatch = {}, expect: AttemptPatch = {}): boolean {
    return this.store.stepAttempt(a.id, a.step, to, patch, this.ports.now(), expect);
  }

  /** No install: rollback of a new plugin (and rollback of a rollout that did not change the code) — only enable or disable. */
  private noInstall(a: AttemptRow): boolean {
    return a.kind === "rollback" && a.before_sha === a.target_sha;
  }

  /** Refs in the plugin repository, outside the Workshop's database, hold both commits of the rollout; writing them again is harmless. */
  private async recorded(a: AttemptRow): Promise<boolean> {
    if (this.noInstall(a)) return this.cas(a, "state-set");
    if (a.kind === "enter") {
      const dir = pluginDir(a.plugin_id);
      const key = this.refKey(a);
      await this.ports.git.updateRef(dir, `refs/workshop/${key}/before`, a.before_sha!);
      await this.ports.git.updateRef(dir, `refs/workshop/${key}/target`, a.target_sha!);
    }
    return this.cas(a, "moved");
  }

  /**
   * The merge (for a rollback — the same in reverse): the copy's state is recognized before the command and after it, including after
   * a restart. If `reset --keep` refused, the copy is provably intact: a failure without «unexpected state».
   */
  private async move(a: AttemptRow): Promise<boolean> {
    const dir = pluginDir(a.plugin_id);
    const from = a.from_sha ?? a.before_sha!;
    const to = a.target_sha!;
    let seen = await this.copyState(dir, from, to);
    let kept = false;
    if (seen.state === "before") {
      const keep = await this.ports.git.resetKeep(dir, to);
      if (keep !== "ok") {
        this.close(a, "failed", `git reset --keep ${short(to)} refused — nothing changed (usually uncommitted changes in the working copy are in the way); git: ${clip(keep.refused, GIT_TEXT_MAX)}`);
        return false;
      }
      kept = true;
      seen = await this.copyState(dir, from, to);
    } else if (seen.state === "interrupted") {
      // Interrupted transition: the branch is already at to, files and index are exactly from, no foreign changes. First a tree snapshot, then finishing it.
      await this.ports.git.snapshotTree(dir, `refs/workshop/${this.refKey(a)}/pre-recover`, [...CANCEL_EXCLUDE], []);
      try {
        await this.ports.git.resetHard(dir, to);
      } catch (e) {
        this.close(a, "failed", `${UNEXPECTED_COPY}: the interrupted transition to ${short(to)} was not completed — git reset --hard: ${errText(e)}`);
        return false;
      }
      seen = await this.copyState(dir, from, to);
    }
    if (seen.state !== "after") {
      // After a successful `reset --keep` the copy must be exactly «after»: if it is not, someone wrote to it during the transition; which files — from git.
      const files = kept ? await this.dirtyList(dir) : "";
      this.close(a, "failed", `${UNEXPECTED_COPY}: ${seen.text}${files}`);
      return false;
    }
    if (from !== to) this.note(a, "rollout", `${attemptNoun(a.kind)}: the working copy's main branch is at ${short(to)}`);
    return this.cas(a, "locking");
  }

  /** «; files: …» — the first lines of `git status --porcelain` (up to DIRTY_LIST_MAX); git did not answer — empty: the attempt closes without the list. */
  private async dirtyList(dir: string): Promise<string> {
    const lines = await this.ports.git.statusLines(dir).catch(() => [] as string[]);
    if (lines.length === 0) return "";
    const more = lines.length > DIRTY_LIST_MAX ? ` and ${lines.length - DIRTY_LIST_MAX} more` : "";
    return `; files (git status): ${lines.slice(0, DIRTY_LIST_MAX).join(", ")}${more}`;
  }

  /**
   * Check until `check` yields a value — up to POLL_MS, in steps of POLL_STEP_MS (time — `ports.now`, waiting — `ports.sleep`); not
   * reached — null. Stop (`opts.stop`) — null at once, like «still waiting»: the step is not recorded, the attempt stays on it until the next reconcile.
   */
  private async poll<T>(check: () => Promise<T | null>): Promise<T | null> {
    const until = this.ports.now() + POLL_MS;
    for (let i = 0; ; i++) {
      const v = await check();
      if (v !== null) return v;
      const stop = this.opts.stop?.();
      // The number of steps is bounded on its own as well: a clock that does not move will not make the poll loop forever.
      if (stop?.aborted || i >= POLL_MS / POLL_STEP_MS || this.ports.now() >= until) return null;
      await this.ports.sleep(POLL_STEP_MS, stop);
      if (stop?.aborted) return null;
    }
  }

  private async copyState(dir: string, from: string, to: string): Promise<{ state: CopyState; text: string }> {
    const f = await this.ports.git.facts(dir);
    const text = describeCopy(f, from, to);
    if (!f.hasGit || f.branch !== MAIN_BRANCH) return { state: "unexpected", text };
    const clean = f.dirtyCount === 0;
    const equalsFrom = f.head === to && !clean ? await this.ports.git.copyEquals(dir, from) : false;
    return { state: classifyCopy({ head: f.head, clean, equalsFrom }, from, to), text };
  }

  /**
   * Build lock: a new holder generation — together with the «lock may be held» mark, and only once; then the request. Later — by the
   * holder's state: `held` — go on, `waiting` — wait, `none` (the request did not get through, the holder died) — request again with the same token.
   */
  private async locking(a: AttemptRow): Promise<boolean> {
    let token = a.lock_token;
    if (token === null) {
      token = randomUUID();
      if (!this.cas(a, "locking", { lock_token: token, lock_held: 1 }, { lock_token: null })) return false;
      await this.ports.lock.request(a.id, token);
    } else if ((await this.ports.lock.state(a.id, token)) === "none") {
      await this.ports.lock.request(a.id, token);
    }
    const t = token;
    if (!(await this.poll(async () => ((await this.ports.lock.state(a.id, t)) === "held" ? true : null)))) return false; // waiting for the build lock
    if (!this.store.stepAttempt(a.id, "locking", "locked", {}, this.ports.now())) return false;
    this.note(a, "rollout", `${attemptNoun(a.kind)}: build lock taken`);
    return true;
  }

  /** Ids of already known jobs — recorded with the step and before the start: by them, after a lost answer, our own job is found. */
  private async locked(a: AttemptRow): Promise<boolean> {
    if (!(await this.depsReady(a))) return false;
    const known = (await this.ports.plugins.jobs()).map((j) => j.id);
    if (!this.cas(a, "installing", { known_job_ids: JSON.stringify(known), foreign_job_id: null, job_id: null })) return false;
    return this.answered(a, await this.ports.plugins.startInstall(pluginDir(a.plugin_id)), known, false);
  }

  /**
   * The work's dependencies go into the working copy before the install (otherwise «Could not resolve "yaml"»): bb builds the plugin from the working copy,
   * while the implementer's `npm ci` ran in the worktree. They are installed by a background process under the build lock the attempt already holds; we wait
   * with a short poll, then — the next reconcile. This attempt's dependency install failed — a failure with the tail of the npm log; one failed earlier — install again.
   */
  private async depsReady(a: AttemptRow): Promise<boolean> {
    const dir = pluginDir(a.plugin_id);
    const s = await this.ports.deps.state(dir);
    if (s.kind === "ok") return true;
    if (s.kind === "failed" && s.startedAt >= a.started_at) {
      this.close(a, "failed", `the working copy's dependencies failed to install — ${s.text}`);
      return false;
    }
    if (s.kind !== "running") {
      await this.ports.deps.start(dir);
      this.note(a, "rollout", `${attemptNoun(a.kind)}: installing the working copy's dependencies (npm ci)`);
    }
    const done = await this.poll(async () => {
      const x = await this.ports.deps.state(dir);
      return x.kind === "running" ? null : x;
    });
    if (done === null) return false; // still installing
    if (done.kind === "ok") {
      this.note(a, "rollout", `${attemptNoun(a.kind)}: the working copy's dependencies are in place`);
      return true;
    }
    if (done.kind === "failed") this.close(a, "failed", `the working copy's dependencies failed to install — ${done.text}`);
    return false;
  }

  /** The `startInstall` answer: a new id — our own job; a known one — someone else's job for the same folder, not to be taken over. */
  private answered(a: AttemptRow, jobId: string, known: string[], retry: boolean): boolean {
    const now = this.ports.now();
    if (!known.includes(jobId)) {
      if (!this.store.stepAttempt(a.id, "installing", "installed", { job_id: jobId }, now, { job_id: null })) return false;
      this.note(a, "rollout", `${attemptNoun(a.kind)}: install started, job ${jobId}`);
      return true;
    }
    if (!retry) {
      // bb returned an already running job for the same source string (someone started an install of this folder by hand): it may have built
      // old files — wait for it to end and start our own install once more, just once.
      if (!this.store.stepAttempt(a.id, "installing", "installing", { foreign_job_id: jobId, known_job_ids: null }, now, { foreign_job_id: null, job_id: null })) return false;
      this.note(a, "warn", `${attemptNoun(a.kind)}: bb returned the already running job ${jobId} for this folder — waiting for it to end, then installing again`);
      return true;
    }
    this.close(a, "unknown", `bb again returned the already running job ${jobId} for this folder`);
    return false;
  }

  /**
   * The `installing` step after a restart or a failure. Waiting for someone else's job — until it ends, then the second and last start.
   * Otherwise the answer to the start was lost: our job is the only new job of this folder (`sourcePath`, both source forms);
   * none or several — the outcome is unknown, the lock stays.
   */
  private async installing(a: AttemptRow): Promise<boolean> {
    const dir = pluginDir(a.plugin_id);
    if (a.foreign_job_id !== null && a.known_job_ids === null) {
      const j = await this.ports.plugins.job(a.foreign_job_id);
      if (j !== null && JOB_RUNNING.includes(j.state)) return false; // waiting for the other install
      const known = (await this.ports.plugins.jobs()).map((x) => x.id);
      if (!this.cas(a, "installing", { known_job_ids: JSON.stringify(known) }, { known_job_ids: null, foreign_job_id: a.foreign_job_id, job_id: null })) return false;
      return this.answered(a, await this.ports.plugins.startInstall(dir), known, true);
    }
    if (a.known_job_ids === null) {
      this.close(a, "unknown", "the ids of known jobs were not recorded — our own job cannot be told apart");
      return false;
    }
    const known = JSON.parse(a.known_job_ids) as string[];
    const fresh = (await this.ports.plugins.jobs()).filter((j) => sourcePath(j.source) === dir && !known.includes(j.id));
    if (fresh.length !== 1) {
      this.close(a, "unknown", `the answer to the install start was lost; new jobs of this folder: ${fresh.length}`);
      return false;
    }
    if (!this.cas(a, "installed", { job_id: fresh[0]!.id }, { job_id: null })) return false;
    this.note(a, "rollout", `${attemptNoun(a.kind)}: the answer to the start was lost, job found — ${fresh[0]!.id}`);
    return true;
  }

  /** Wait for the job's final state (also after a cancel: it may end `succeeded`). The job vanished — the outcome is unknown. */
  private async installed(a: AttemptRow): Promise<boolean> {
    const seen = await this.poll(async () => {
      const job = await this.ports.plugins.job(a.job_id!);
      return job === null || !JOB_RUNNING.includes(job.state) ? { job } : null;
    });
    if (!seen) return false; // the job is still running
    const j = seen.job;
    if (j === null) {
      this.close(a, "unknown", `install job ${a.job_id} vanished from the bb list (bb keeps finished jobs for about 10 minutes; after a server restart they are gone)`);
      return false;
    }
    this.note(a, j.state === "succeeded" ? "rollout" : "warn", `${attemptNoun(a.kind)}: job ${j.id} finished — ${j.state}${j.error ? ` (${j.error})` : ""}`);
    return this.cas(a, "released", { job_state: j.state });
  }

  private async released(a: AttemptRow): Promise<boolean> {
    await this.ports.lock.release(a.id);
    this.store.setLock(a.id, false, a.lock_token, this.ports.now());
    return this.cas(a, "state-set");
  }

  /**
   * An install enables a disabled plugin (bb behavior): the state is set after every install, also with `want_enabled = 0`.
   * The plugin is enabled only after a successful install (or without one): otherwise a failure would bring up the old code of a deliberately disabled plugin.
   */
  private async stateSet(a: AttemptRow): Promise<boolean> {
    const p = await this.installedPlugin(a.plugin_id);
    const installed = this.noInstall(a) || a.job_state === "succeeded";
    if (p && a.want_enabled === 1 && !p.enabled && installed) await this.ports.plugins.enable(a.plugin_id);
    if (p && a.want_enabled === 0 && p.enabled) await this.ports.plugins.disable(a.plugin_id);
    return this.cas(a, "checked");
  }

  /** Check by the job and the plugin list: `succeeded` does not mean «working» (a broken build is `succeeded` with an `error`). */
  private async checked(a: AttemptRow): Promise<boolean> {
    const p = await this.installedPlugin(a.plugin_id);
    const installs = !this.noInstall(a);
    const jobOk = !installs || a.job_state === "succeeded";
    const ok =
      a.want_enabled === 1
        ? jobOk && p !== null && p.enabled && (p.state === "running" || p.state === "needs-configuration")
        : jobOk && (p === null ? !installs : !p.enabled);
    if (!ok) {
      this.close(a, "failed", await this.failure(a, p, installs));
      return false;
    }
    return await this.finish(a, p);
  }

  private async failure(a: AttemptRow, p: InstalledPlugin | null, installs: boolean): Promise<string> {
    const parts: string[] = [];
    if (installs && a.job_state !== "succeeded") {
      const j = a.job_id ? await this.ports.plugins.job(a.job_id).catch(() => null) : null;
      parts.push(`job ${a.job_id ?? "—"} — ${a.job_state ?? "?"}${j?.error ? ` (${j.error})` : ""}`);
    }
    if (p === null) {
      if (installs || a.want_enabled === 1) parts.push("the plugin is not in the bb list");
    } else if (a.want_enabled === 1) {
      if (!p.enabled) parts.push("the plugin is disabled");
      else if (p.state !== "running" && p.state !== "needs-configuration") parts.push(`the plugin is in state ${p.state}${p.error ? ` (${p.error})` : ""}`);
    } else if (p.enabled) parts.push("the plugin did not turn off");
    return `${a.kind === "rollback" ? "rollback failed" : "install failed"}: ${parts.join("; ") || "the plugin is not in the expected state"}`;
  }

  /**
   * The outcome — in one transaction: the attempt is `done`; the rolled-out commit = its `target` (for a rollback without an install — the previous one: the code
   * was not installed, and the failed rollout's commit never ran); the plugin state confirmed by the list during the check; a rollout and its retry —
   * the work moves from Verification to Rollout with the intent of a live-check thread; a rollback — the rolled-back attempt is resolved, the work goes from
   * Verification or Rollout back to Implementation with the reason. The thread is created by the engine's reconcile from the intent. Then, as with the engine's
   * handover and send-back, — a snapshot of the work's files and a comment in the task.
   */
  private async finish(a: AttemptRow, p: InstalledPlugin | null): Promise<boolean> {
    const now = this.ports.now();
    const before = this.workOf(a);
    let moved: { label: string; text: string } | null = null;
    const closed = this.store.tx(() => {
      if (!this.store.closeAttempt(a.id, "done", null, now)) return false;
      if (!this.noInstall(a)) this.store.setInstalled(a.plugin_id, a.target_sha);
      if (p) this.store.setLastState(a.plugin_id, { state: p.state, enabled: p.enabled }, now);
      else this.store.setNotInstalled(a.plugin_id, now);
      const w = this.workOf(a);
      if (a.kind === "rollback") {
        if (a.origin_id) this.store.resolveAttempt(a.origin_id, now);
        if (w && (w.stage === 5 || w.stage === 6)) {
          const reason = a.note ?? "rollback";
          this.engine.sendBackInTx(w, 4, reason, now);
          const what = this.noInstall(a) ? (a.want_enabled === 0 ? "plugin disabled, code untouched" : "plugin enabled, code untouched") : `plugin back on commit ${short(a.target_sha)}`;
          moved = { label: `s${w.stage}-i${w.iteration}-back`, text: `Rollback: ${what}. Sent back to «Implementation»: ${reason}` };
        }
      } else if (w && w.stage === 5 && this.store.casStage(w.id, 5, 6, w.iteration, now)) {
        this.store.setEntry(w.id, this.engine.liveCheckEntry(w, this.store.attempt(a.id)!, now), now);
        moved = { label: `s5-i${w.iteration}`, text: `«Verification» handed over — stage «Rollout»: plugin rolled out, commit ${short(a.target_sha)}.` };
      }
      return true;
    });
    if (!closed) return false;
    this.note(a, "rollout", `${attemptNoun(a.kind)}: done — rolled-out commit ${short(a.target_sha)}`);
    const done = moved as { label: string; text: string } | null;
    if (done && before) await this.engine.afterMove(before, done.label, done.text);
    return false;
  }

  // --- the lock after an unknown outcome ---

  /** The lock of a closed attempt is released only when the job list has no running job of this folder; a list failure is an exception. */
  private async releaseIfIdle(id: string): Promise<void> {
    const a = this.store.attempt(id);
    if (!a || a.status === "running" || a.lock_held === 0) return;
    if (this.runningJobs(a.plugin_id, await this.ports.plugins.jobs()).length > 0) return;
    await this.ports.lock.release(a.id);
    this.store.setLock(a.id, false, a.lock_token, this.ports.now());
    this.note(a, "rollout", "build lock released: no install of this folder is running");
  }

  private async releaseIdle(pluginId: string): Promise<void> {
    for (const a of this.store.lockedAttempts()) {
      if (a.plugin_id === pluginId && a.status !== "running") await this.releaseIfIdle(a.id).catch(() => undefined);
    }
  }

  // --- availability ---

  private async live(): Promise<Live> {
    const [list, jobs] = await Promise.all([this.ports.plugins.list().catch(() => null), this.ports.plugins.jobs().catch(() => null)]);
    return { list, jobs };
  }

  private runningJobs(pluginId: string, jobs: InstallJob[]): InstallJob[] {
    return runningJobsOf(jobs, pluginDir(pluginId));
  }

  /** Nothing on top of a running install: an open attempt (including one waiting for the lock), a running job of this folder, lists that did not arrive. */
  private busy(pluginId: string, live: Live, locks: boolean): string | null {
    const open = this.store.openAttemptOf(pluginId);
    if (open) return `a ${attemptNoun(open.kind)} is in progress — wait`;
    if (live.jobs === null) return JOBS_UNKNOWN;
    if (this.runningJobs(pluginId, live.jobs).length > 0) return INSTALL_RUNNING;
    if (live.list === null) return NO_LIST;
    if (locks && this.store.lockedAttempts().some((a) => a.plugin_id === pluginId)) return "the build lock is not released yet — wait a minute";
    return null;
  }

  private rollbackBlock(f: PluginFacts, p: InstalledPlugin | null): string | null {
    const cur = this.store.currentAttempt(f.row.id);
    if (!cur || cur.kind === "rollback") return NO_POINT;
    if (cur.status === "failed" && (cur.step === "recorded" || cur.step === "moved") && !cur.error?.startsWith(UNEXPECTED_COPY)) return "the attempt did not reach the install — nothing to roll back";
    const other = this.otherWork(f, cur);
    if (other) return other;
    if (cur.was_installed === 0) return p ? null : "the plugin is not installed — nothing to roll back";
    if (cur.migrations === 1) return cur.work_id === null ? "the adopted change touched data (migrations) or is too large to check — rollback is impossible, only «Disable»" : "the work added data migrations — rollback is impossible, only «Disable»";
    return this.copyBlock(f, cur.target_sha, "rollback by the record is impossible");
  }

  private reinstallBlock(f: PluginFacts): string | null {
    const cur = this.store.currentAttempt(f.row.id);
    if (!cur || cur.status !== "unknown" || cur.resolved_at !== null) return NOT_UNKNOWN;
    return this.otherWork(f, cur) ?? this.copyBlock(f, cur.target_sha, "a retry is unsafe");
  }

  private disableBlock(pluginId: string, p: InstalledPlugin | null): string | null {
    if (pluginId === SELF_ID) return "the Workshop cannot disable itself";
    if (p?.enabled) return null;
    // The plugin is already disabled (an earlier «Disable» went through, but its answer did not), and the failure is undecided: «Disable» only records the decision.
    if (this.undecided(pluginId)) return null;
    return p ? "the plugin is already disabled" : "the plugin is not installed";
  }

  /** The plugin's current attempt — a closed `failed`/`unknown` one the owner has not decided on yet. */
  private undecided(pluginId: string): AttemptRow | null {
    const cur = this.store.currentAttempt(pluginId);
    return cur && (cur.status === "failed" || cur.status === "unknown") && cur.resolved_at === null ? cur : null;
  }

  /** «Enable» — by `enabled`, not by state: for a disabled plugin without a folder bb reports `missing`. */
  private enableBlock(p: InstalledPlugin | null): string | null {
    if (!p) return "the plugin is not installed";
    return p.enabled ? "the plugin is already enabled" : null;
  }

  private cancelTargets(pluginId: string, jobs: InstallJob[]): string[] {
    const open = this.store.openAttemptOf(pluginId);
    const running = this.runningJobs(pluginId, jobs);
    return (open?.job_id ? running.filter((j) => j.id === open.job_id) : running).map((j) => j.id);
  }

  private cancelBlock(pluginId: string, live: Live): string | null {
    if (!this.opts.cancelSupported) return "cancelling an install is not supported";
    const open = this.store.openAttemptOf(pluginId);
    if (open?.step === "installing" && open.foreign_job_id !== null && open.job_id === null) return FOREIGN_WAIT;
    if (live.jobs === null) return JOBS_UNKNOWN;
    return this.cancelTargets(pluginId, live.jobs).length > 0 ? null : "no install is running — nothing to cancel";
  }

  /** Another work is open on the plugin (not the one whose attempt is current — or any, if the attempt has no work): rollback and retry come after it. */
  private otherWork(f: PluginFacts, cur: AttemptRow): string | null {
    const w = f.work;
    if (!w || w.id === cur.work_id) return null;
    return `work ${w.task_key ?? "(being created)"} is open on the plugin — it goes first`;
  }

  /** Right before a rollback and a retry: the working copy is on the main branch, without changes, and its HEAD is the attempt's commit. */
  private copyBlock(f: PluginFacts, sha: string | null, what: string): string | null {
    const g = f.git;
    if (g === null) return f.gitError !== undefined ? `could not read git: ${f.gitError}` : "no plugin working copy";
    if (!g.hasGit) return "the working copy has no git";
    if (g.branch === null) return `the working copy is not on branch ${MAIN_BRANCH} (detached HEAD)`;
    if (g.branch !== MAIN_BRANCH) return `the working copy is on branch ${g.branch}, not ${MAIN_BRANCH}`;
    if (g.dirtyCount > 0) return `${editsText(g.dirtyCount)} in the working copy`;
    if (g.head !== sha) return `the working copy's main branch is not at the rolled-out commit (${short(g.head)}, not ${short(sha)}) — ${what}`;
    return null;
  }

  // --- common ---

  private async facts(pluginId: string): Promise<PluginFacts> {
    const f = await this.catalog.one(pluginId);
    if (!f) throw new Error("the plugin is not on the board");
    return f;
  }

  private async installedPlugin(pluginId: string): Promise<InstalledPlugin | null> {
    return (await this.ports.plugins.list()).find((p) => p.id === pluginId) ?? null;
  }

  /**
   * A chain of rollouts inherits the rollback point. When the plugin's current attempt is a closed, not `done` rollout (or its
   * retry) at any step, a new rollout takes its `before`, `was_installed` and `was_enabled`. Otherwise «Roll back» after it would bring
   * back the failed rollout's code — merged (a failure after the merge), moved up to the «unexpected state», or inherited by
   * a link that `reset --keep` refused. For a failure before the merge without inheritance `before` is HEAD anyway: the same result.
   */
  private inheritedPoint(pluginId: string): AttemptRow | null {
    const cur = this.store.currentAttempt(pluginId);
    if (!cur || (cur.kind !== "enter" && cur.kind !== "reinstall")) return null;
    return cur.status === "failed" || cur.status === "unknown" ? cur : null;
  }

  /** The attempt got past the merge: the main branch moved, the install may have started. */
  private pastMove(a: AttemptRow): boolean {
    return a.step !== "recorded" && a.step !== "moved";
  }

  /** Record an attempt if the plugin's current attempt is still the one the decision was based on, and none is running. */
  private record(pluginId: string, expected: string, add: (id: string, now: number) => void): string {
    if (this.store.currentAttempt(pluginId)?.id !== expected || this.store.openAttemptOf(pluginId)) throw new Error("the attempt has changed — refresh the page");
    const id = newAttemptId();
    const now = this.ports.now();
    this.store.tx(() => add(id, now));
    return id;
  }

  /**
   * The open, created work the attempt is about — its own work; an attempt without a work («Adopt as rolled out») has none.
   * The work is finished — null.
   */
  private workOf(a: AttemptRow): (WorkRow & { created: 1 }) | null {
    // An attempt without a work («Adopt as rolled out») does nothing to another work: no threads, no send-back.
    const w = a.work_id ? this.store.work(a.work_id) : null;
    return w && w.outcome === null && w.created === 1 ? (w as WorkRow & { created: 1 }) : null;
  }

  /** KEY of the attempt's refs in the plugin repository: the task key of its work; without a work — the attempt id. */
  private refKey(a: AttemptRow): string {
    return (a.work_id ? this.store.work(a.work_id)?.task_key : null) ?? a.id;
  }

  private close(a: AttemptRow, status: "failed" | "unknown", error: string): void {
    if (!this.store.closeAttempt(a.id, status, error, this.ports.now())) return;
    this.note(a, "warn", status === "unknown" ? `install outcome unknown: ${error}` : `${attemptFailed(a.kind)}: ${error}`);
  }

  /** A line in the journal of the attempt's work (an attempt without a work writes nothing) and a signal to the UI. */
  private note(a: AttemptRow, kind: string, text: string): void {
    const id = a.work_id;
    if (!id) return;
    this.store.log(id, kind, text, this.ports.now());
    this.ports.changed(id);
  }

  /** The work's card — from fresh facts: the engine's reconcile (it also performs the entry into the stage the outcome recorded). */
  private async after(id: string): Promise<void> {
    const a = this.store.attempt(id);
    const w = a ? this.workOf(a) : null;
    if (w) await this.engine.reconcile(w.id);
  }
}
