// Plugin catalog: a board card is a plugin. The column, the state in bb, the labels and the reasons «Rework» is closed are computed
// from facts (`PluginFacts`) by pure functions; `Catalog` gathers the facts from the store and the ports and reconciles the board with bb.

import { editsText, MAIN_BRANCH } from "./gates";
import { sourcePath, type GitFacts, type InstalledPlugin, type PluginState, type Ports } from "./ports";
import type { PublishResult } from "./publish";
import { PLUGINS_ROOT, SELF_ID, pluginDir, STAGES, type Column } from "./stages";
import type { AttemptRow, PilotState, PluginRow, Store, WorkRow } from "./store";

/** Everything known about a card at the time of the request. */
export interface PluginFacts {
  row: PluginRow;
  /** State in bb according to the last confirmed list; null — the plugin is not installed (or bb has never confirmed it yet). */
  installed: InstalledPlugin | null;
  /** The plugin's working copy in the plugins root (`PLUGINS_ROOT`); null — no folder (or git could not be read — then `gitError` is set). */
  git: GitFacts | null;
  /** Why `git` was not read even though the folder may exist. */
  gitError?: string;
  /** The open work (including one still being created). */
  work: WorkRow | null;
  /** The last rollout attempt, whatever its outcome. */
  attempt: AttemptRow | null;
  /** Autopilot of the open work; none — it was never started. */
  pilot?: PilotState | null;
}

/** Column: with an open work — the column of its stage; without a work — by bb: enabled — «In production», disabled or not installed — «Retired». */
export function columnOf(f: PluginFacts): Column {
  if (f.work) return STAGES.find((s) => s.no === f.work!.stage)?.column ?? "context";
  return f.installed !== null && f.installed.enabled ? "live" : "off";
}

/** The state in bb is shown separately from the column. `stale` — the last plugin list could not be fetched: this is the last confirmed state. */
export function bbStateOf(f: PluginFacts): { state: PluginState | "not-installed"; stale: boolean } {
  return { state: f.installed ? f.installed.state : "not-installed", stale: f.row.list_failed_at !== null };
}

export function labelsOf(f: PluginFacts): string[] {
  const labels: string[] = [];
  if (f.installed === null) labels.push("not installed");
  if (f.row.list_failed_at !== null) labels.push("stale data");
  if (f.work?.stage === 6) labels.push("awaiting acceptance");
  // The plugin came up and waits for settings — not a failure, but the owner needs to know.
  if (f.installed?.state === "needs-configuration") labels.push("needs configuration");
  // While an attempt is running, HEAD moves on purpose — the rollout records the commit at the end.
  if (f.row.installed_sha !== null && f.git?.head && f.git.head !== f.row.installed_sha && f.attempt?.status !== "running") labels.push("main branch ≠ rolled-out commit");
  labels.push(...githubLabels(f));
  return labels;
}

/**
 * GitHub main holds a commit that was rolled back after acceptance: the plugin's current attempt is a finished rollback, and main on GitHub is the
 * rolled-back commit (the rollback's `before_sha`). It must not be pulled (that would bring back what was rejected); GitHub is not fixed by force — the owner reverts.
 */
export function rolledBackOnGithub(store: Store, pluginId: string, theirs: string): boolean {
  const cur = store.currentAttempt(pluginId);
  return cur?.kind === "rollback" && cur.status === "done" && cur.before_sha === theirs;
}

/** GitHub is the source of truth. Labels from the last reconcile with GitHub (every 15 minutes); never reconciled — no labels. */
export function githubLabels(f: PluginFacts): string[] {
  const r = f.row;
  if (r.gh_checked_at === null || !f.git?.hasGit) return [];
  if (r.gh_error) return [`GitHub check failed: ${r.gh_error.length > 80 ? `${r.gh_error.slice(0, 80)}…` : r.gh_error}`];
  if (r.gh_remote === null) return ["no repository on GitHub"];
  if (r.gh_rolled === 1) return ["a rolled-back commit remains on GitHub — revert it on GitHub (manually)"];
  const ahead = r.gh_ahead ?? 0;
  const behind = r.gh_behind ?? 0;
  if (ahead > 0 && behind > 0) return ["main diverged from GitHub"];
  if (behind > 0) return [`GitHub is ahead by ${behind}`];
  if (ahead > 0) return [`GitHub is behind by ${ahead}`];
  return [];
}

/** Why «Rework» is closed; empty — it is available. */
export function reworkBlockers(f: PluginFacts): string[] {
  const out: string[] = [];
  if (f.row.id === SELF_ID) out.push("the Workshop is not reworked through itself");
  if (f.work) out.push(f.work.task_key ? `work ${f.work.task_key} is already in progress` : "a work is already in progress (being created)");
  // An attempt without a work («Adopt as rolled out») cannot be resolved once a work is open: rollback and retry are closed for the sake of the work, and
  // its gates do not see someone else's attempt. So the decision comes before the work, while the owner has all three buttons. A failure before the merge installed nothing.
  const a = f.attempt;
  if (a && a.work_id === null && (a.status === "running" || (a.resolved_at === null && (a.status === "unknown" || (a.status === "failed" && a.step !== "recorded" && a.step !== "moved")))))
    out.push(a.status === "running" ? "the plugin is being installed — wait" : "the last plugin installation is unresolved — first «Roll back», «Install again» or «Disable»");
  const noCopy = f.git === null && f.gitError === undefined;
  const foreign = f.installed !== null && sourcePath(f.installed.source) !== pluginDir(f.row.id);
  // Installed not from this folder: with a working copy — «installed from …»; with no working copy in the plugins root — the source is foreign.
  if (foreign) out.push(noCopy ? `source outside ${PLUGINS_ROOT}` : `installed from ${f.installed!.source}, not from this folder`);
  const g = f.git;
  if (g === null) {
    if (f.gitError !== undefined) out.push(`could not read git: ${f.gitError}`);
    else if (!foreign) out.push("no working copy folder");
    return out;
  }
  if (!g.hasGit) {
    out.push("no git");
    return out;
  }
  if (g.head === null) {
    out.push("the repository has no commits");
    return out;
  }
  if (g.branch === null) out.push(`the working copy is not on branch ${MAIN_BRANCH} (detached HEAD)`);
  else if (g.branch !== MAIN_BRANCH) out.push(`the working copy is on branch ${g.branch}, not ${MAIN_BRANCH}`);
  if (g.dirtyCount > 0) out.push(`${editsText(g.dirtyCount)} in the working copy`);
  // A work starts from what is on GitHub. Newer there — pull it first; diverged — needs sorting out.
  const behind = f.row.gh_behind ?? 0;
  if (!f.row.gh_error && behind > 0 && f.row.gh_rolled !== 1) out.push((f.row.gh_ahead ?? 0) > 0 ? "main diverged from GitHub — needs sorting out" : "GitHub is ahead — first «Adopt as rolled out» (pulls from GitHub)");
  return out;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** At most `limit` calls at once: each plugin means several git processes. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** What was read from the working copy's git: the facts themselves or the reason they could not be read. */
interface GitRead {
  git: GitFacts | null;
  gitError?: string;
}

export class Catalog {
  /** Plugin error texts (`statusDetail`) from the last list; they are not in the database, after a restart the first reconcile brings them back. */
  private readonly errors = new Map<string, string | null>();
  /**
   * Git facts per plugin for the board: read on catalog reconcile and on changes (`refreshGit`), not on every request.
   * `seq` — the read's number taken when it starts: a read started later is not overwritten by an earlier one that finished later.
   */
  private readonly gitCache = new Map<string, { seq: number; read: GitRead }>();
  private gitSeq = 0;
  /**
   * Running cache refreshes: `again` — another pass was requested while one was running (the earlier one may have started before the change); `state` — the
   * next pass also needs to reconcile the plugin's state with bb, not just git.
   */
  private readonly refreshing = new Map<string, { again: boolean; state: boolean; done: Promise<void> }>();

  /**
   * `publish` — the publication gate (Engine.publish): the only way main reaches GitHub. Without it the catalog only compares main with GitHub
   * and never pushes.
   */
  constructor(
    private readonly store: Store,
    private readonly ports: Ports,
    private readonly publish?: (dir: string, sha: string, branch: string) => Promise<PublishResult>,
  ) {}

  /**
   * Reconcile the board with bb: the list of installed plugins and the `bb-plugin-*` folders. Called at startup, every five minutes and on `system:changed`.
   *
   * If the list did not come, nothing is overwritten (name, folder and source stay as they were) and the cards get a failure mark: they are «stale», not
   * «not installed». New folders are not added without the list — whether they are installed is unknown. If one plugin fails to reconcile, the rest
   * are still reconciled and the first error is thrown at the end.
   */
  async sync(): Promise<void> {
    try {
      await this.syncStore();
    } finally {
      // The board reads git from the cache: after a reconcile it is fresh, even if one plugin failed to reconcile.
      await this.refreshGit().catch(() => undefined);
    }
  }

  private async syncStore(): Promise<void> {
    const now = this.ports.now();
    let list: InstalledPlugin[];
    try {
      list = await this.ports.plugins.list();
    } catch {
      this.store.tx(() => {
        for (const row of this.store.plugins()) if (row.gone_reason === null) this.store.setLastState(row.id, null, now);
      });
      return;
    }
    // Folders are needed to find new plugins; without the listing they just won't be found this time.
    const folders = await this.ports.plugins.folders().catch(() => []);
    const installed = new Map(list.map((p) => [p.id, p]));
    const folderOf = new Map(folders.map((p) => [p.id, p]));
    const ids = [...new Set([...installed.keys(), ...folderOf.keys(), ...this.store.plugins().map((r) => r.id)])].sort();
    let failure: unknown = null;
    for (const id of ids) {
      try {
        await this.syncOne(id, installed.get(id) ?? null, folderOf.get(id) ?? null, now);
      } catch (e) {
        failure ??= e;
      }
    }
    if (failure !== null) throw failure;
  }

  private async syncOne(id: string, inst: InstalledPlugin | null, folder: { dir: string; name: string | null } | null, now: number): Promise<void> {
    const row = this.store.plugin(id);
    // The working copy is always `pluginDir(id)`; a plugin installed from another folder may have one alongside.
    const dir = folder ? folder.dir : (await this.ports.fs.exists(pluginDir(id))) ? pluginDir(id) : null;
    if (inst) {
      let state = inst.state;
      let error = inst.error;
      // The folder is gone but bb still considers the plugin running: bb reports `missing` only when it loads the plugin from scratch.
      if (state !== "missing" && inst.rootDir !== null && !(await this.ports.fs.exists(inst.rootDir))) {
        state = "missing";
        error = `plugin folder is missing: ${inst.rootDir}`;
      }
      this.store.tx(() => {
        this.store.upsertSeen({ id, name: inst.name ?? folder?.name ?? row?.name ?? id, dir, source: inst.source }, now);
        this.store.setLastState(id, { state, enabled: inst.enabled }, now);
      });
      this.errors.set(id, error);
      return;
    }
    this.errors.delete(id);
    if (dir !== null) {
      this.store.tx(() => {
        // The name the owner entered at creation is not overwritten by the scaffold's name (`bb plugin new` puts the id into the manifest).
        this.store.upsertSeen({ id, name: row?.name ?? folder?.name ?? id, dir, source: null }, now);
        this.store.setNotInstalled(id, now);
      });
      return;
    }
    if (row === null) return;
    // The plugin is being created: its row was written before the folder.
    if (this.store.openWorkOf(id) !== null) {
      this.store.setNotInstalled(id, now);
      return;
    }
    // Not in the list (the list came) and no folder (checked) — gone.
    if (row.gone_reason === null) this.store.markGone(id, "plugin not installed, no folder", now);
  }

  /** All board cards by id; git is read live. */
  async facts(): Promise<PluginFacts[]> {
    return mapLimit(this.store.plugins(), 4, (row) => this.factsOf(row));
  }

  /** A plugin's card; null — it is not on the board. The working copy facts are fresh (and update the board cache). */
  async one(id: string): Promise<PluginFacts | null> {
    const row = this.store.plugin(id);
    return row ? this.factsOf(row) : null;
  }

  /**
   * Board cards: git from the cache (updated by the catalog reconcile and `refreshGit`), everything else fresh from the database. A card
   * that is not in the cache yet is read once.
   */
  async cachedFacts(): Promise<PluginFacts[]> {
    return mapLimit(this.store.plugins(), 4, async (row) => {
      let hit = this.gitCache.get(row.id);
      if (!hit) {
        await this.refreshOne(row.id, false);
        hit = this.gitCache.get(row.id);
      }
      return this.compose(row, hit?.read ?? { git: null });
    });
  }

  /**
   * Re-read the working copies' git into the board cache: of the named plugins or of all. One reading pass per plugin; a request that arrives
   * during a pass gets one more — the earlier one may have started before the change. A plugin not on the board — nothing happens.
   */
  async refreshGit(ids?: string[]): Promise<void> {
    const rows = (ids ?? this.store.plugins().map((r) => r.id)).filter((id) => this.store.plugin(id) !== null);
    await mapLimit(rows, 4, (id) => this.refreshOne(id, false));
  }

  /**
   * Targeted reconcile of one plugin — after an owner action and after a rollout attempt step: its state in bb (one list request, this plugin's
   * row; folders and other plugins are not touched) and the git of its working copy. Without it the column and the bb state on the board would wait
   * for the full catalog reconcile. A failed state reconcile is thrown after git is read. A plugin not on the board — nothing happens.
   */
  async refreshPlugin(id: string): Promise<void> {
    if (this.store.plugin(id) === null) return;
    await this.refreshOne(id, true);
  }

  /**
   * Reconcile with GitHub — one plugin at a time (it goes over the network). No `origin` — «no repository on GitHub»; otherwise fetch and compare
   * main with `origin/main`. When main is the rolled-out commit, no attempt is running and GitHub is simply behind, main is published through the
   * gate: GitHub holds what was rolled out. A refused publication (destination, a finding, an incomplete scan) is the card's GitHub error. The
   * reconcile changes nothing else: edits that exist only on GitHub are pulled in by the owner.
   */
  async syncGithub(ids?: string[]): Promise<void> {
    const rows = (ids ? ids.map((id) => this.store.plugin(id)).filter((r): r is PluginRow => r !== null) : this.store.plugins()).filter((r) => r.gone_reason === null && r.dir !== null);
    for (const row of rows) await this.githubOne(row.id);
  }

  /** Reconcile one plugin with GitHub; a failure goes to `gh_error` (a card label), the previous numbers stay. */
  async githubOne(id: string): Promise<void> {
    const row = this.store.plugin(id);
    if (!row) return;
    const dir = pluginDir(id);
    try {
      const git = await this.ports.git.facts(dir);
      if (!git.hasGit || !git.head) return this.store.setGithub(id, { remote: null, ahead: null, behind: null, error: null }, this.ports.now());
      const remote = await this.ports.github.remote(dir);
      if (!remote) return this.store.setGithub(id, { remote: null, ahead: null, behind: null, error: null }, this.ports.now());
      await this.ports.github.fetch(dir);
      // The working copy is not on main — nothing to compare: the branch is reported among the «Rework» blockers.
      if (git.branch !== MAIN_BRANCH) return this.store.setGithub(id, { remote, ahead: null, behind: null, error: null }, this.ports.now());
      const theirs = await this.ports.github.remoteSha(dir, MAIN_BRANCH);
      let c = theirs ? await this.ports.github.counts(dir, git.head, theirs) : { ahead: 1, behind: 0 };
      const fresh = this.store.plugin(id) ?? row;
      // main goes to GitHub only once it is accepted: it is the rolled-out commit, no attempt is running and there is no work on the plugin (while a work
      // is open, what was rolled out is still under live verification — a rollback would leave the rejected code on GitHub).
      if (this.publish && c.ahead > 0 && c.behind === 0 && git.head === fresh.installed_sha && this.store.openAttemptOf(id) === null && this.store.openWorkOf(id) === null) {
        const r = await this.publish(dir, git.head, MAIN_BRANCH);
        if (!r.ok) throw new Error(r.kind === "destination" ? r.reason : `main ${r.reason}`);
        c = { ahead: 0, behind: 0 };
      }
      const rolled = theirs !== null && rolledBackOnGithub(this.store, id, theirs);
      this.store.setGithub(id, { remote, ahead: c.ahead, behind: c.behind, error: null, rolled }, this.ports.now());
    } catch (e) {
      const cur = this.store.plugin(id) ?? row;
      this.store.setGithub(id, { remote: cur.gh_remote, ahead: cur.gh_ahead, behind: cur.gh_behind, error: errText(e) }, this.ports.now());
    }
  }

  /** The plugin's row from bb's list. If the list did not come, the previous confirmed state stays and the row is marked «stale». */
  private async syncPlugin(id: string): Promise<void> {
    const row = this.store.plugin(id);
    if (!row) return;
    const now = this.ports.now();
    let list: InstalledPlugin[];
    try {
      list = await this.ports.plugins.list();
    } catch {
      if (row.gone_reason === null) this.store.setLastState(id, null, now);
      return;
    }
    await this.syncOne(id, list.find((p) => p.id === id) ?? null, null, now);
  }

  private refreshOne(id: string, state: boolean): Promise<void> {
    const busy = this.refreshing.get(id);
    if (busy) {
      busy.again = true;
      busy.state ||= state;
      return busy.done;
    }
    const st: { again: boolean; state: boolean; done: Promise<void> } = { again: false, state, done: Promise.resolve() };
    this.refreshing.set(id, st);
    st.done = (async () => {
      let failure: unknown = null;
      try {
        do {
          const withState = st.state;
          st.again = false;
          st.state = false;
          if (withState) {
            try {
              await this.syncPlugin(id);
            } catch (e) {
              failure ??= e;
            }
          }
          const row = this.store.plugin(id);
          if (!row) return;
          await this.read(row);
        } while (st.again);
      } finally {
        this.refreshing.delete(id);
      }
      if (failure !== null) throw failure;
    })();
    return st.done;
  }

  /** Live read of the plugin's git; the result goes to the cache unless there is a later read. The read itself does not throw: a failure goes to `gitError`. */
  private async read(row: PluginRow): Promise<GitRead> {
    const seq = ++this.gitSeq;
    const dir = row.dir ?? pluginDir(row.id);
    let read: GitRead;
    try {
      read = (await this.ports.fs.exists(dir)) ? { git: await this.ports.git.facts(dir) } : { git: null };
    } catch (e) {
      read = { git: null, gitError: errText(e) };
    }
    if ((this.gitCache.get(row.id)?.seq ?? 0) < seq) this.gitCache.set(row.id, { seq, read });
    return read;
  }

  private async factsOf(row: PluginRow): Promise<PluginFacts> {
    return this.compose(row, await this.read(row));
  }

  private compose(row: PluginRow, g: GitRead): PluginFacts {
    const installed: InstalledPlugin | null =
      row.last_state === null
        ? null
        : { id: row.id, name: row.name, state: row.last_state as PluginState, enabled: row.last_enabled === 1, source: row.source ?? "", rootDir: row.dir, error: this.errors.get(row.id) ?? null };
    const work = this.store.openWorkOf(row.id);
    return {
      row, installed, git: g.git, ...(g.gitError !== undefined ? { gitError: g.gitError } : {}), work, attempt: this.store.currentAttempt(row.id),
      pilot: work ? (this.store.pilot(work.id)?.state ?? null) : null,
    };
  }
}
