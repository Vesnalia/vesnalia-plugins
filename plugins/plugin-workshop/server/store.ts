import type Database from "better-sqlite3";
import type { JobState } from "./ports";
import { redact } from "./secrets";
import type { Version } from "./versions";

export type Outcome = "done" | "canceled";
export type Role = "stage" | "review";
export type WorkKind = "new" | "rework";
export interface WorkRow {
  id: string;
  /** The plugin the work is on; a plugin has at most one open work. */
  plugin_id: string;
  kind: WorkKind;
  /** 0 — the creation steps (scaffold, git, project, task) are not finished yet; the engine reconcile does not touch such a work. */
  created: number;
  /** The task and the execution project are set up during creation; a created work (`created = 1`) has them. */
  task_id: string | null; task_key: string | null; tasks_project_id: string;
  project_id: string | null; host_id: string;
  title: string; request: string;
  stage: number; iteration: number; environment_id: string | null; base_branch: string | null;
  queued: number; entry: string | null;
  /** 1 — the main branch of the plugin's working copy has moved ahead of the work branch. */
  base_ahead: number;
  state: string; state_reason: string; stale: number;
  task_synced: string | null; cleanup_done: number;
  created_at: number; updated_at: number; finished_at: number | null; outcome: Outcome | null;
  /** The last commit of the work branch pushed to GitHub, and the work branch's PR. */
  pushed_sha: string | null; pr_url: string | null; pushed_branch: string | null;
  /** The selected agent models (JSON); null — defaults. */
  models: string | null;
  /** The publication check's last verdict on a work branch commit — clean, findings or failed, with the destination and policy (JSON `ScanVerdict`, engine.ts); null — none. */
  gh_scan: string | null;
}
/** A new work: the first stage is Context, `created = 0` until `markCreated` says otherwise. */
export type NewWork = Pick<WorkRow, "id" | "plugin_id" | "kind" | "tasks_project_id" | "host_id" | "title" | "request" | "created_at"> &
  Partial<Pick<WorkRow, "task_id" | "task_key" | "project_id" | "models">>;

/** A work's autopilot. */
export type PilotState = "on" | "paused" | "stopped" | "done";
export interface PilotRow {
  work_id: string; state: PilotState; reason: string | null; notes: string;
  /** The orchestrator thread and its spawn key (`pluginMetadata.opKey`): the key finds the thread while its id is not recorded yet. */
  thread_id: string | null; op_key: string; spawned_at: number | null;
  /** The last wake-up (situation key and time) and the situation the orchestrator has already answered with an action or «wait». */
  wake_key: string | null; woken_at: number | null; handled_key: string | null;
  /** When and why the orchestrator answered «wait». */
  handled_at: number | null; handled_note: string | null;
  /** Consecutive wake-ups without an answer; consecutive reconciles with the work in a failed state. */
  quiet: number; error_ticks: number;
  acted_at: number | null; actions: number;
  /** Consecutive returns to Implementation from Verification or Rollout. */
  reds: number;
  thread_failures: number;
  report: string | null; started_at: number; updated_at: number; stopped_at: number | null;
}

/** A board card: the plugin as the Workshop last saw it. */
export interface PluginRow {
  id: string; name: string; dir: string | null; source: string | null; project_id: string | null;
  /** The commit the plugin last rolled out. */
  installed_sha: string | null;
  /** The latest rollout attempt, whatever its outcome. */
  current_attempt: string | null;
  /** The last confirmed state in VesnALIA. */
  last_state: string | null; last_enabled: number | null; state_at: number | null;
  /** When the plugin list last failed to load; while this is later than `state_at`, the information is stale. */
  list_failed_at: number | null;
  first_seen: number; last_seen: number; gone_reason: string | null;
  /**
   * GitHub reconcile: `gh_remote` — origin (null — no repository or not reconciled yet), `gh_ahead`/`gh_behind` — main commits only
   * here and only on GitHub, `gh_error` — why the reconcile failed; `gh_checked_at` — null if never reconciled.
   */
  gh_remote: string | null; gh_ahead: number | null; gh_behind: number | null; gh_checked_at: number | null; gh_error: string | null; gh_rolled: number;
  /** The owner removed the gone plugin from the board; null — on the board. */
  hidden_at: number | null;
}

export type AttemptKind = "enter" | "rollback" | "reinstall";
export type AttemptStep = "recorded" | "moved" | "locking" | "locked" | "installing" | "installed" | "released" | "state-set" | "checked";
export type AttemptStatus = "running" | "done" | "failed" | "unknown";
export interface AttemptRow {
  id: string; plugin_id: string; work_id: string | null; kind: AttemptKind;
  /** HEAD of the working copy's main branch before the attempt. */
  before_sha: string | null;
  /** The HEAD the attempt brings the working copy to (for a rollback — the commit being rolled back to). */
  target_sha: string | null;
  migrations: number;
  /** As it was before the attempt; for a repeat — as it was before the attempt it repeats (the rollback point passes to it). */
  was_installed: number; was_enabled: number;
  /** What the plugin must become: rollout and repeat — 1; rollback — `was_enabled` of the attempt being rolled back. */
  want_enabled: number;
  step: AttemptStep; status: AttemptStatus;
  /** JSON: ids of the jobs known before `startInstall`. */
  known_job_ids: string | null;
  /** Someone else's job for the same source, returned by `startInstall`: wait for it to end, then retry once. */
  foreign_job_id: string | null;
  job_id: string | null; error: string | null;
  /** The lock holder generation; `lock_held = 1` — the lock may be held by this attempt. */
  lock_token: string | null; lock_held: number;
  started_at: number; updated_at: number;
  /** When the owner resolved the closed attempt (`resolveAttempt`); null — not resolved. */
  resolved_at: number | null;
  /** Rollback — the attempt it rolls back; reinstall — the attempt it repeats. */
  origin_id: string | null;
  /** Rollback — the owner's reason: the work goes back to the implementer with it in the outcome transaction. */
  note: string | null;
  /** The final state of the install job (`succeeded`, `failed`, `cancelled`), recorded together with the `released` step. */
  job_state: JobState | null;
  /**
   * Where the main branch moves from: the working copy's HEAD at recording time, when `before_sha` is a rollback point inherited
   * from a failed rollout whose code is already merged. null — the branch moves from `before_sha`.
   */
  from_sha: string | null;
}
/** Fields an attempt step writes together with itself (and the conditions under which it does). */
export type AttemptPatch = Partial<Pick<AttemptRow, "job_id" | "known_job_ids" | "foreign_job_id" | "error" | "job_state" | "lock_token" | "lock_held">>;
const PATCH_COLUMNS = ["job_id", "known_job_ids", "foreign_job_id", "error", "job_state", "lock_token", "lock_held"] as const;

/** The intent to enter a stage: recorded together with the transition, executed and reconciled separately. */
export interface Entry {
  key: string;
  stage: number;
  /** Where it came from: a stage, 0 — from outside (creation), −1 — from the queue. Entering 4–5 from outside 4–5 checks the machine's free slots. */
  from: number;
  packet: string | null;
  /** The last execution error; the reconcile will retry. */
  error: string | null;
  /** Stage 6: the attempt the live check thread verifies (`liveCheckEntry`). */
  attemptId?: string | null;
}
export interface RunRow {
  thread_id: string; work_id: string; stage: number; role: Role; who: string; round: number;
  input_version: string | null; regulation_sha: string; invalid_reason: string | null; attached: number;
  created_at: number; done_at: number | null;
}
export interface HandoverRow {
  /** `reconfirm` — the owner confirmed a stale stage document again: like a handover, but the stage does not change. */
  id: number; work_id: string; stage: number; action: "forward" | "back" | "cancel" | "reconfirm"; to_stage: number;
  version: Version | null; note: string; forced: boolean; problems: string[]; at: number;
}
export interface OpRow {
  key: string; work_id: string; kind: string; status: "pending" | "done" | "failed";
  payload: string | null; result: string | null; error: string | null; created_at: number; updated_at: number;
}
export interface EventRow { id: number; at: number; kind: string; text: string }

/**
 * The store keeps diagnostic text — the journal, error texts, reasons, notes, the autopilot's report — redacted (`redact`): token-shaped text
 * that reached an error message or a note is not kept as is. Best effort: a secret no pattern knows passes through.
 */
export class Store {
  constructor(private readonly db: Database.Database) {}

  /** Everything inside — in one SQLite transaction; an exception rolls it back. */
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // --- works ---
  works(): WorkRow[] {
    return this.db.prepare("SELECT * FROM works ORDER BY updated_at DESC").all() as WorkRow[];
  }
  /** Unfinished works, plus finished ones with unfinished cleanup or an unsynced task. Works whose creation is unfinished are driven by `Creation`, not by the reconcile. */
  unsettledWorks(): WorkRow[] {
    return this.db
      .prepare("SELECT * FROM works WHERE created = 1 AND (outcome IS NULL OR cleanup_done = 0 OR task_synced IS NOT outcome) ORDER BY created_at")
      .all() as WorkRow[];
  }
  /** Works whose creation steps are not finished yet (and which are not over). */
  creatingWorks(): WorkRow[] {
    return this.db.prepare("SELECT * FROM works WHERE created = 0 AND outcome IS NULL ORDER BY created_at").all() as WorkRow[];
  }
  /** The plugin's open work (including one still being created); at most one — enforced by a partial index. */
  openWorkOf(pluginId: string): WorkRow | null {
    return (this.db.prepare("SELECT * FROM works WHERE plugin_id = ? AND outcome IS NULL").get(pluginId) as WorkRow | undefined) ?? null;
  }
  /** The plugin's finished works, newest first. */
  pastWorks(pluginId: string): WorkRow[] {
    return this.db.prepare("SELECT * FROM works WHERE plugin_id = ? AND outcome IS NOT NULL ORDER BY created_at DESC, id DESC").all(pluginId) as WorkRow[];
  }
  work(id: string): WorkRow | null {
    return (this.db.prepare("SELECT * FROM works WHERE id = ?").get(id) as WorkRow | undefined) ?? null;
  }
  worksByTask(taskId: string): WorkRow[] {
    return this.db.prepare("SELECT * FROM works WHERE task_id = ? ORDER BY created_at").all(taskId) as WorkRow[];
  }
  workByKey(key: string): WorkRow | null {
    return (this.db.prepare("SELECT * FROM works WHERE task_key = ? ORDER BY created_at DESC LIMIT 1").get(key) as WorkRow | undefined) ?? null;
  }
  /** A new work on the first stage, `created = 0`. A second open work on the same plugin throws. */
  addWork(w: NewWork): void {
    this.db
      .prepare(
        `INSERT INTO works (id, plugin_id, kind, task_id, task_key, tasks_project_id, project_id, host_id, title, request, created_at, updated_at, models)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(w.id, w.plugin_id, w.kind, w.task_id ?? null, w.task_key ?? null, w.tasks_project_id, w.project_id ?? null, w.host_id, w.title, w.request, w.created_at, w.created_at, w.models ?? null);
  }
  /** Creation steps finished: the work comes under the engine reconcile. */
  markCreated(id: string, now: number): void {
    this.db.prepare("UPDATE works SET created = 1, updated_at = ? WHERE id = ? AND created = 0").run(now, id);
  }
  /** The tracker task is created. A second open work on the same task throws. */
  setTask(id: string, task: { id: string; key: string }, now: number): void {
    this.db.prepare("UPDATE works SET task_id = ?, task_key = ?, updated_at = ? WHERE id = ?").run(task.id, task.key, now, id);
  }
  /** The execution project (a VesnALIA project on the plugin folder) is found or created. */
  setProject(id: string, projectId: string, now: number): void {
    this.db.prepare("UPDATE works SET project_id = ?, updated_at = ? WHERE id = ?").run(projectId, now, id);
  }
  /** The working copy's main branch moved ahead (or came back); true — the value changed. */
  setBaseAhead(id: string, ahead: boolean, now: number): boolean {
    return this.db.prepare("UPDATE works SET base_ahead = ?, updated_at = ? WHERE id = ? AND base_ahead != ?").run(ahead ? 1 : 0, now, id, ahead ? 1 : 0).changes === 1;
  }
  /** Compare-and-swap of the stage: false — the work has already been moved. */
  casStage(id: string, from: number, to: number, iteration: number, now: number): boolean {
    return (
      this.db
        .prepare("UPDATE works SET stage = ?, iteration = ?, updated_at = ? WHERE id = ? AND stage = ? AND outcome IS NULL")
        .run(to, iteration, now, id, from).changes === 1
    );
  }
  setEnvironment(id: string, environmentId: string, baseBranch: string | null, now: number): void {
    this.db
      .prepare("UPDATE works SET environment_id = ?, base_branch = ?, updated_at = ? WHERE id = ? AND environment_id IS NULL")
      .run(environmentId, baseBranch, now, id);
  }
  /** The work branch is pushed to GitHub up to this commit. */
  setPushed(id: string, sha: string, branch: string): void {
    this.db.prepare("UPDATE works SET pushed_sha = ?, pushed_branch = ? WHERE id = ?").run(sha, branch, id);
  }
  /** The work branch on GitHub is deleted (PR merged). */
  clearPushedBranch(id: string): void {
    this.db.prepare("UPDATE works SET pushed_branch = NULL WHERE id = ?").run(id);
  }
  /** The publication check's verdict on the work branch commit (JSON `ScanVerdict`); null — none. */
  setScan(id: string, verdict: string | null): void {
    this.db.prepare("UPDATE works SET gh_scan = ? WHERE id = ?").run(verdict === null ? null : redact(verdict), id);
  }
  setPr(id: string, url: string): void {
    this.db.prepare("UPDATE works SET pr_url = ? WHERE id = ? AND pr_url IS NULL").run(url, id);
  }
  setQueued(id: string, queued: boolean, now: number): void {
    this.db.prepare("UPDATE works SET queued = ?, updated_at = ? WHERE id = ?").run(queued ? 1 : 0, now, id);
  }
  entry(w: WorkRow): Entry | null {
    return w.entry ? (JSON.parse(w.entry) as Entry) : null;
  }
  setEntry(id: string, entry: Entry | null, now: number): void {
    this.db.prepare("UPDATE works SET entry = ?, updated_at = ? WHERE id = ?").run(entry ? JSON.stringify({ ...entry, error: redact(entry.error) }) : null, now, id);
  }
  /** The card caption; true — something visible changed. */
  setState(id: string, state: string, reason0: string, stale: boolean, now: number): boolean {
    const reason = redact(reason0);
    return (
      this.db
        .prepare(
          `UPDATE works SET state = ?, state_reason = ?, stale = ?, updated_at = ?
           WHERE id = ? AND (state IS NOT ? OR state_reason IS NOT ? OR stale IS NOT ?)`,
        )
        .run(state, reason, stale ? 1 : 0, now, id, state, reason, stale ? 1 : 0).changes === 1
    );
  }
  setTaskSynced(id: string, status: string): void {
    this.db.prepare("UPDATE works SET task_synced = ? WHERE id = ?").run(status, id);
  }
  /** End of the work: the card caption at once, cleanup separately (cleanup_done = 0 until confirmed). The stage stays the last one passed: the outcome is only in `outcome`. */
  finish(id: string, outcome: Outcome, now: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE works SET outcome = ?, finished_at = ?, queued = 0, entry = NULL, stale = 0, cleanup_done = 0,
             state = ?, state_reason = ?, updated_at = ?
           WHERE id = ? AND outcome IS NULL`,
        )
        .run(outcome, now, outcome, outcome === "done" ? "done" : "canceled", now, id).changes === 1
    );
  }
  setCleanupDone(id: string): void {
    this.db.prepare("UPDATE works SET cleanup_done = 1 WHERE id = ?").run(id);
  }
  /** Works on stages 4–5 (Implementation, Verification) on the machine — not queued and not finished, except exceptId. */
  activeBuilding(hostId: string, exceptId: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM works WHERE host_id = ? AND id != ? AND outcome IS NULL AND queued = 0 AND stage IN (4, 5)")
      .get(hostId, exceptId) as { n: number };
    return r.n;
  }

  // --- stage threads ---
  runs(workId: string): RunRow[] {
    return this.db.prepare("SELECT * FROM stage_runs WHERE work_id = ? ORDER BY created_at, thread_id").all(workId) as RunRow[];
  }
  run(threadId: string): RunRow | null {
    return (this.db.prepare("SELECT * FROM stage_runs WHERE thread_id = ?").get(threadId) as RunRow | undefined) ?? null;
  }
  addRun(r: Omit<RunRow, "input_version" | "invalid_reason" | "attached" | "done_at"> & { input_version: Version | null }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO stage_runs (thread_id, work_id, stage, role, who, round, input_version, regulation_sha, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.thread_id, r.work_id, r.stage, r.role, r.who, r.round, r.input_version ? JSON.stringify(r.input_version) : null, r.regulation_sha, r.created_at);
  }
  markRunDone(threadId: string, now: number): void {
    this.db.prepare("UPDATE stage_runs SET done_at = ? WHERE thread_id = ? AND done_at IS NULL").run(now, threadId);
  }
  invalidateRun(threadId: string, reason0: string): void {
    const reason = redact(reason0);
    this.db.prepare("UPDATE stage_runs SET invalid_reason = COALESCE(invalid_reason, ?) WHERE thread_id = ?").run(reason, threadId);
  }
  markAttached(threadId: string): void {
    this.db.prepare("UPDATE stage_runs SET attached = 1 WHERE thread_id = ?").run(threadId);
  }
  maxRound(workId: string, stage: number, role: Role): number {
    const r = this.db
      .prepare("SELECT COALESCE(MAX(round), 0) AS n FROM stage_runs WHERE work_id = ? AND stage = ? AND role = ?")
      .get(workId, stage, role) as { n: number };
    return r.n;
  }
  stageThread(workId: string, stage: number): RunRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM stage_runs WHERE work_id = ? AND stage = ? AND role = 'stage' ORDER BY round DESC, created_at DESC LIMIT 1")
        .get(workId, stage) as RunRow | undefined) ?? null
    );
  }

  // --- handovers ---
  handovers(workId: string): HandoverRow[] {
    const rows = this.db.prepare("SELECT * FROM handovers WHERE work_id = ? ORDER BY id").all(workId) as Array<
      Omit<HandoverRow, "version" | "forced" | "problems"> & { version: string | null; forced: number; problems: string }
    >;
    return rows.map((r) => ({
      ...r,
      version: r.version ? (JSON.parse(r.version) as Version) : null,
      forced: r.forced === 1,
      problems: JSON.parse(r.problems) as string[],
    }));
  }
  addHandover(h: Omit<HandoverRow, "id">): void {
    this.db
      .prepare("INSERT INTO handovers (work_id, stage, action, to_stage, version, note, forced, problems, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(h.work_id, h.stage, h.action, h.to_stage, h.version ? JSON.stringify(h.version) : null, redact(h.note), h.forced ? 1 : 0, JSON.stringify(h.problems.map((p) => redact(p))), h.at);
  }

  // --- intents of external actions ---
  op(key: string): OpRow | null {
    return (this.db.prepare("SELECT * FROM ops WHERE key = ?").get(key) as OpRow | undefined) ?? null;
  }
  pendingOps(workId: string): OpRow[] {
    return this.db.prepare("SELECT * FROM ops WHERE work_id = ? AND status = 'pending' ORDER BY created_at").all(workId) as OpRow[];
  }
  /** Record an intent; repeating the same key keeps the first one's time (after a failure — the new one's time). */
  beginOp(key: string, workId: string, kind: string, payload: string | null, now: number): void {
    this.db
      .prepare(
        `INSERT INTO ops (key, work_id, kind, status, payload, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET status = 'pending', error = NULL, payload = COALESCE(excluded.payload, ops.payload), updated_at = excluded.updated_at,
           created_at = CASE WHEN ops.status = 'failed' THEN excluded.created_at ELSE ops.created_at END
         WHERE ops.status != 'done'`,
      )
      .run(key, workId, kind, payload, now, now);
  }
  finishOp(key: string, result: string, now: number): void {
    this.db.prepare("UPDATE ops SET status = 'done', result = ?, updated_at = ? WHERE key = ?").run(result, now, key);
  }
  /** When the Workshop last completed an action on the thread (creation, message); null — never. */
  lastOpAt(workId: string, threadId: string): number | null {
    const r = this.db.prepare("SELECT MAX(updated_at) AS at FROM ops WHERE work_id = ? AND result = ? AND status = 'done'").get(workId, threadId) as { at: number | null };
    return r.at;
  }
  failOp(key: string, error: string, now: number): void {
    this.db.prepare("UPDATE ops SET status = 'failed', error = ?, updated_at = ? WHERE key = ? AND status != 'done'").run(redact(error), now, key);
  }

  // --- journal ---
  /** Repeating the work's last line (the same reconcile every minute) adds no lines — its time is updated instead. */
  log(workId: string, kind: string, text0: string, now: number): void {
    const text = redact(text0);
    this.tx(() => {
      const last = this.db.prepare("SELECT id, kind, text FROM events WHERE work_id = ? ORDER BY id DESC LIMIT 1").get(workId) as EventRow | undefined;
      if (last && last.kind === kind && last.text === text) this.db.prepare("UPDATE events SET at = ? WHERE id = ?").run(now, last.id);
      else this.db.prepare("INSERT INTO events (work_id, at, kind, text) VALUES (?, ?, ?, ?)").run(workId, now, kind, text);
    });
  }
  events(workId: string, limit = 50): EventRow[] {
    return this.db.prepare("SELECT id, at, kind, text FROM events WHERE work_id = ? ORDER BY id DESC LIMIT ?").all(workId, limit) as EventRow[];
  }

  // --- autopilot ---
  pilot(workId: string): PilotRow | null {
    return (this.db.prepare("SELECT * FROM pilots WHERE work_id = ?").get(workId) as PilotRow | undefined) ?? null;
  }
  pilots(): PilotRow[] {
    return this.db.prepare("SELECT * FROM pilots ORDER BY started_at").all() as PilotRow[];
  }
  pilotByThread(threadId: string): PilotRow | null {
    return (this.db.prepare("SELECT * FROM pilots WHERE thread_id = ?").get(threadId) as PilotRow | undefined) ?? null;
  }
  /** Start (or restart after a stop): counters from zero, a new thread. */
  startPilot(workId: string, notes: string, opKey: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO pilots (work_id, state, reason, notes, op_key, started_at, updated_at) VALUES (?, 'on', NULL, ?, ?, ?, ?)
         ON CONFLICT(work_id) DO UPDATE SET state = 'on', reason = NULL, notes = excluded.notes, thread_id = NULL, op_key = excluded.op_key,
           spawned_at = NULL, wake_key = NULL, woken_at = NULL, handled_key = NULL, handled_at = NULL, handled_note = NULL, quiet = 0, error_ticks = 0, acted_at = NULL, actions = 0,
           reds = 0, thread_failures = 0, report = NULL, started_at = excluded.started_at, updated_at = excluded.updated_at, stopped_at = NULL`,
      )
      .run(workId, notes, opKey, now, now);
  }
  /** Partial update of the autopilot row. */
  patchPilot(workId: string, patch0: Partial<Omit<PilotRow, "work_id">>, now: number): void {
    const patch = { ...patch0 };
    for (const k of ["reason", "handled_note", "report"] as const) if (typeof patch[k] === "string") patch[k] = redact(patch[k]);
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return;
    const set = keys.map((k) => `${String(k)} = ?`).join(", ");
    this.db.prepare(`UPDATE pilots SET ${set}, updated_at = ? WHERE work_id = ?`).run(...keys.map((k) => patch[k] as never), now, workId);
  }

  // --- plugins ---
  plugins(): PluginRow[] {
    return this.db.prepare("SELECT * FROM plugins ORDER BY id").all() as PluginRow[];
  }
  plugin(id: string): PluginRow | null {
    return (this.db.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as PluginRow | undefined) ?? null;
  }
  /** The plugin was seen in a reconcile: the row is created, or the name, folder, source and time are updated; «gone» is cleared. */
  upsertSeen(p: { id: string; name: string; dir: string | null; source: string | null }, now: number): void {
    this.db
      .prepare(
        `INSERT INTO plugins (id, name, dir, source, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, dir = excluded.dir, source = excluded.source, last_seen = excluded.last_seen, gone_reason = NULL, hidden_at = NULL`,
      )
      .run(p.id, p.name, p.dir, p.source, now, now);
  }
  /** The state in VesnALIA, confirmed by the plugin list; null — the list did not arrive: the previous state stays, the failure is recorded. */
  setLastState(id: string, s: { state: string; enabled: boolean } | null, now: number): void {
    if (s === null) this.db.prepare("UPDATE plugins SET list_failed_at = ? WHERE id = ?").run(now, id);
    else this.db.prepare("UPDATE plugins SET last_state = ?, last_enabled = ?, state_at = ?, list_failed_at = NULL WHERE id = ?").run(s.state, s.enabled ? 1 : 0, now, id);
  }
  /** The plugin is no longer in VesnALIA nor on disk: the row stays with the reason and has no confirmed state. */
  markGone(id: string, reason: string, now: number): void {
    this.db.prepare("UPDATE plugins SET gone_reason = ?, last_state = NULL, last_enabled = NULL, state_at = ?, list_failed_at = NULL WHERE id = ?").run(reason, now, id);
  }
  /** The plugin list arrived without the plugin, but its folder exists: it has no confirmed state in VesnALIA and does not count as gone. */
  setNotInstalled(id: string, now: number): void {
    this.db.prepare("UPDATE plugins SET last_state = NULL, last_enabled = NULL, state_at = ?, list_failed_at = NULL WHERE id = ?").run(now, id);
  }
  setPluginProject(id: string, projectId: string): void {
    this.db.prepare("UPDATE plugins SET project_id = ? WHERE id = ?").run(projectId, id);
  }
  /** The result of the GitHub reconcile. */
  setGithub(id: string, g: { remote: string | null; ahead: number | null; behind: number | null; error: string | null; rolled?: boolean }, now: number): void {
    this.db
      .prepare("UPDATE plugins SET gh_remote = ?, gh_ahead = ?, gh_behind = ?, gh_error = ?, gh_rolled = ?, gh_checked_at = ? WHERE id = ?")
      .run(g.remote, g.ahead, g.behind, redact(g.error), g.rolled ? 1 : 0, now, id);
  }
  /** «Hide from board»: only a gone plugin without an open work; true — hidden. */
  hidePlugin(id: string, now: number): boolean {
    return this.db.prepare("UPDATE plugins SET hidden_at = ? WHERE id = ? AND gone_reason IS NOT NULL").run(now, id).changes === 1;
  }
  /** The commit the plugin rolled out (or rolled back to); null — not rolled out. */
  setInstalled(pluginId: string, sha: string | null): void {
    this.db.prepare("UPDATE plugins SET installed_sha = ? WHERE id = ?").run(sha, pluginId);
  }

  // --- rollout attempts ---
  /**
   * Record an attempt (step `recorded`, status `running`) and, in the same transaction, make it the plugin's current one.
   * A second running attempt on a plugin, or an attempt for a plugin that is not on the board, throws; nothing is recorded.
   */
  addAttempt(
    a: Pick<AttemptRow, "id" | "plugin_id" | "work_id" | "kind" | "before_sha" | "target_sha" | "migrations" | "was_installed" | "was_enabled" | "want_enabled" | "started_at"> &
      Partial<Pick<AttemptRow, "origin_id" | "note" | "from_sha">>,
  ): void {
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO attempts (id, plugin_id, work_id, kind, before_sha, target_sha, migrations, was_installed, was_enabled, want_enabled, started_at, updated_at, origin_id, note, from_sha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          a.id, a.plugin_id, a.work_id, a.kind, a.before_sha, a.target_sha, a.migrations, a.was_installed, a.was_enabled, a.want_enabled, a.started_at, a.started_at,
          a.origin_id ?? null, a.note ?? null, a.from_sha ?? null,
        );
      if (this.db.prepare("UPDATE plugins SET current_attempt = ? WHERE id = ?").run(a.id, a.plugin_id).changes !== 1) throw new Error(`plugin ${a.plugin_id} is not on the board`);
    });
  }
  attempt(id: string): AttemptRow | null {
    return (this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as AttemptRow | undefined) ?? null;
  }
  /** The plugin's running attempt (`running`); at most one — enforced by a partial index. */
  openAttemptOf(pluginId: string): AttemptRow | null {
    return (this.db.prepare("SELECT * FROM attempts WHERE plugin_id = ? AND status = 'running'").get(pluginId) as AttemptRow | undefined) ?? null;
  }
  openAttempts(): AttemptRow[] {
    return this.db.prepare("SELECT * FROM attempts WHERE status = 'running' ORDER BY started_at, id").all() as AttemptRow[];
  }
  /** The plugin's latest attempt, whatever its outcome: a closed `failed` or `unknown` one stays current until the next one replaces it. */
  currentAttempt(pluginId: string): AttemptRow | null {
    return (
      (this.db
        .prepare("SELECT a.* FROM attempts a JOIN plugins p ON p.current_attempt = a.id WHERE p.id = ?")
        .get(pluginId) as AttemptRow | undefined) ?? null
    );
  }
  /**
   * Compare-and-swap of the step: the step changes only if the attempt is `running`, stands on `from` and the `expect` fields are as
   * named (null — empty); false — another call has already taken the step (or the attempt is closed). The same write sets only the
   * `patch` fields named in it (null clears a field). An in-place step (`from = to`) with a condition writes the step's fields exactly once.
   */
  stepAttempt(id: string, from: AttemptStep, to: AttemptStep, patch: AttemptPatch, now: number, expect: AttemptPatch = {}): boolean {
    const named = PATCH_COLUMNS.filter((c) => patch[c] !== undefined);
    const checked = PATCH_COLUMNS.filter((c) => expect[c] !== undefined);
    const sets = ["step = ?", "updated_at = ?", ...named.map((c) => `${c} = ?`)].join(", ");
    const where = ["id = ?", "step = ?", "status = 'running'", ...checked.map((c) => `${c} IS ?`)].join(" AND ");
    return (
      this.db
        .prepare(`UPDATE attempts SET ${sets} WHERE ${where}`)
        .run(to, now, ...named.map((c) => (c === "error" ? redact(patch[c] ?? null) : (patch[c] ?? null))), id, from, ...checked.map((c) => expect[c] ?? null)).changes === 1
    );
  }
  /** Lock: held — whether it may be held by this attempt; token — the holder generation (null — clear). */
  setLock(id: string, held: boolean, token: string | null, now: number): void {
    this.db.prepare("UPDATE attempts SET lock_held = ?, lock_token = ?, updated_at = ? WHERE id = ?").run(held ? 1 : 0, token, now, id);
  }
  /** Attempts that may still hold the lock — in any status, including closed `unknown` and `failed` ones. */
  lockedAttempts(): AttemptRow[] {
    return this.db.prepare("SELECT * FROM attempts WHERE lock_held = 1 ORDER BY started_at, id").all() as AttemptRow[];
  }
  /**
   * The owner resolved a closed attempt: «Roll back» (a successful rollback), «Disable», «Install again». Set only on a closed attempt
   * and only once; true — the mark is set. A new attempt of the same plugin supersedes the old one even without the mark.
   */
  resolveAttempt(id: string, now: number): boolean {
    return this.db.prepare("UPDATE attempts SET resolved_at = ? WHERE id = ? AND status != 'running' AND resolved_at IS NULL").run(now, id).changes === 1;
  }
  /** Close a running attempt; an already closed one does not change — false (the outcome transaction does not silently overwrite someone else's close). */
  closeAttempt(id: string, status: Exclude<AttemptStatus, "running">, error: string | null, now: number): boolean {
    return this.db.prepare("UPDATE attempts SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(status, redact(error), now, id).changes === 1;
  }
}
