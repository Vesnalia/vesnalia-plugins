// Append-only: bb stores a hash of every statement by its index. Do not edit or reorder — only append.
// The schema starts from scratch: the database is new and carries no legacy tables.
export const MIGRATIONS: string[] = [
  // A work is one pass over one plugin. created = 0 until the creation steps (scaffold, git, project, task) are finished;
  // the task and the execution project appear during creation, so task_id, task_key and project_id allow NULL.
  // The state_reason default below is a stored SQL literal and stays as written (statements are hashed).
  `CREATE TABLE works (
     id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL DEFAULT 0,
     task_id TEXT, task_key TEXT, tasks_project_id TEXT NOT NULL, project_id TEXT, host_id TEXT NOT NULL,
     title TEXT NOT NULL, request TEXT NOT NULL,
     stage INTEGER NOT NULL DEFAULT 1, iteration INTEGER NOT NULL DEFAULT 1,
     environment_id TEXT, base_branch TEXT, queued INTEGER NOT NULL DEFAULT 0, entry TEXT, base_ahead INTEGER NOT NULL DEFAULT 0,
     state TEXT NOT NULL DEFAULT 'new', state_reason TEXT NOT NULL DEFAULT 'creating the work', stale INTEGER NOT NULL DEFAULT 0,
     task_synced TEXT, cleanup_done INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER, outcome TEXT);`,
  // A plugin has at most one open work; after cancel or acceptance a new one can be started.
  `CREATE UNIQUE INDEX works_plugin_open ON works(plugin_id) WHERE outcome IS NULL;`,
  // One tracker task — at most one open work (NULL, while the task is not created yet, does not break uniqueness).
  `CREATE UNIQUE INDEX works_task_open ON works(task_id) WHERE outcome IS NULL;`,
  `CREATE TABLE stage_runs (
     thread_id TEXT PRIMARY KEY, work_id TEXT NOT NULL, stage INTEGER NOT NULL, role TEXT NOT NULL, who TEXT NOT NULL,
     round INTEGER NOT NULL, input_version TEXT, regulation_sha TEXT NOT NULL, invalid_reason TEXT,
     attached INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, done_at INTEGER);`,
  `CREATE TABLE handovers (
     id INTEGER PRIMARY KEY AUTOINCREMENT, work_id TEXT NOT NULL, stage INTEGER NOT NULL, action TEXT NOT NULL,
     to_stage INTEGER NOT NULL, version TEXT, note TEXT NOT NULL, forced INTEGER NOT NULL, problems TEXT NOT NULL, at INTEGER NOT NULL);`,
  `CREATE TABLE ops (
     key TEXT PRIMARY KEY, work_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT, result TEXT, error TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`,
  `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, work_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);`,
  // A plugin is a board card. Once here, the row never disappears: a gone plugin gets gone_reason.
  // current_attempt — the latest attempt, whatever its outcome; installed_sha — the commit the plugin last rolled out.
  `CREATE TABLE plugins (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, dir TEXT, source TEXT, project_id TEXT,
     installed_sha TEXT, current_attempt TEXT,
     last_state TEXT, last_enabled INTEGER, state_at INTEGER, list_failed_at INTEGER,
     first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, gone_reason TEXT);`,
  // A rollout attempt: rollout, rollback or reinstall. lock_held = 1 — the install lock may be held by this
  // attempt (including after it closed with status unknown or failed).
  `CREATE TABLE attempts (
     id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, work_id TEXT, kind TEXT NOT NULL,
     before_sha TEXT, target_sha TEXT, migrations INTEGER NOT NULL DEFAULT 0,
     was_installed INTEGER NOT NULL, was_enabled INTEGER NOT NULL, want_enabled INTEGER NOT NULL,
     step TEXT NOT NULL DEFAULT 'recorded', status TEXT NOT NULL DEFAULT 'running',
     known_job_ids TEXT, foreign_job_id TEXT, job_id TEXT, error TEXT,
     lock_token TEXT, lock_held INTEGER NOT NULL DEFAULT 0,
     started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`,
  // At most one running attempt per plugin.
  `CREATE UNIQUE INDEX attempts_running ON attempts(plugin_id) WHERE status = 'running';`,
  // The owner resolved a closed failed attempt («Roll back», «Disable», «Install again»): the work card no longer mentions it.
  `ALTER TABLE attempts ADD COLUMN resolved_at INTEGER;`,
  // Rollback: the attempt it rolls back (a successful rollback resolves it on the owner's behalf); repeat: the attempt it repeats.
  `ALTER TABLE attempts ADD COLUMN origin_id TEXT;`,
  // Rollback: the owner's reason — the work goes back to the implementer with it in the outcome transaction, also after a restart.
  `ALTER TABLE attempts ADD COLUMN note TEXT;`,
  // The install job's final state, recorded together with the released step: the reconcile reads it even after bb has forgotten the job.
  `ALTER TABLE attempts ADD COLUMN job_state TEXT;`,
  // Where the main branch moves from (the copy's HEAD at recording time) when the rollback point is inherited from a failed rollout;
  // NULL — the branch moves from before_sha.
  `ALTER TABLE attempts ADD COLUMN from_sha TEXT;`,
  // GitHub is the source of truth. The last work branch commit pushed to GitHub, and the work branch's PR.
  `ALTER TABLE works ADD COLUMN pushed_sha TEXT;`,
  `ALTER TABLE works ADD COLUMN pr_url TEXT;`,
  // The work branch on GitHub: deleted after «Accept» (main contains it).
  `ALTER TABLE works ADD COLUMN pushed_branch TEXT;`,
  // The plugin's GitHub reconcile (every 15 minutes): origin, how many main commits exist only here and only on GitHub, when, and with what error.
  `ALTER TABLE plugins ADD COLUMN gh_remote TEXT;`,
  `ALTER TABLE plugins ADD COLUMN gh_ahead INTEGER;`,
  `ALTER TABLE plugins ADD COLUMN gh_behind INTEGER;`,
  `ALTER TABLE plugins ADD COLUMN gh_checked_at INTEGER;`,
  `ALTER TABLE plugins ADD COLUMN gh_error TEXT;`,
  // 1 — main on GitHub still has a commit rolled back after acceptance (it is not pulled; revert it manually).
  `ALTER TABLE plugins ADD COLUMN gh_rolled INTEGER NOT NULL DEFAULT 0;`,
  // A work's autopilot: the orchestrator is a thread with the Workshop tools that drives the work to the end on the owner's behalf.
  // state: on — driving; paused — the owner stepped in; stopped — stopped with a reason; done — the work is over, the report is written.
  `CREATE TABLE pilots (
     work_id TEXT PRIMARY KEY, state TEXT NOT NULL, reason TEXT, notes TEXT NOT NULL,
     thread_id TEXT, op_key TEXT NOT NULL, spawned_at INTEGER,
     wake_key TEXT, woken_at INTEGER, handled_key TEXT, handled_at INTEGER, handled_note TEXT,
     quiet INTEGER NOT NULL DEFAULT 0, error_ticks INTEGER NOT NULL DEFAULT 0,
     acted_at INTEGER, actions INTEGER NOT NULL DEFAULT 0, reds INTEGER NOT NULL DEFAULT 0, thread_failures INTEGER NOT NULL DEFAULT 0,
     report TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, stopped_at INTEGER);`,
  // «Hide from board»: a gone plugin (neither in bb nor a folder) is hidden from the board; the row and history stay, the id stays taken. If it reappears, it comes back.
  `ALTER TABLE plugins ADD COLUMN hidden_at INTEGER;`,
  // The work's agent models, selected at start (JSON `WorkModels`); NULL — the defaults.
  `ALTER TABLE works ADD COLUMN models TEXT;`,
  // The publication check's last verdict on a work branch commit (JSON: clean, findings or failed, labels only, with destination and policy); NULL — none.
  `ALTER TABLE works ADD COLUMN gh_scan TEXT;`,
];
