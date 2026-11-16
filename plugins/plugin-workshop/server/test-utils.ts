import Database from "better-sqlite3";
import { Engine } from "./engine";
import { FakePorts } from "./fake-ports";
import { MIGRATIONS } from "./migrations";
import { docPaths, pluginDir, reviewPath, type StageKey, type Who } from "./stages";
import { Store, type AttemptKind, type AttemptStatus, type AttemptStep, type WorkKind } from "./store";
import type { Version } from "./versions";

export function memoryStore(): Store {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  return new Store(db);
}

/**
 * Automatic reviews and the «Mockup» stage are off by default in tests: dedicated tests cover them
 * (`setup(2, 2, true)`, `setup(2, 2, false, true)`).
 */
export function setup(maxBuilding = 2, minFreeDiskGb = 2, autoReview = false, mockup = false) {
  const store = memoryStore();
  const ports = new FakePorts();
  const engine = new Engine(store, ports, () => ({ maxBuilding, minFreeDiskGb, autoReview, mockup, githubOwner: "acme" }));
  return { store, ports, engine };
}
export type Setup = ReturnType<typeof setup>;

/**
 * A work as Creation leaves it: the plugin row and its working copy (git on main), the tracker task, the execution project,
 * `created = 1` and the intent to enter Context. The first reconcile creates the stage thread.
 */
export async function madeWork(s: Setup, o: { pluginId?: string; kind?: WorkKind; title?: string; request?: string; models?: string } = {}): Promise<string> {
  const pluginId = o.pluginId ?? "hello";
  const now = s.ports.now();
  if (!s.store.plugin(pluginId)) s.store.upsertSeen({ id: pluginId, name: pluginId, dir: pluginDir(pluginId), source: null }, now);
  if (!(await s.ports.git.facts(pluginDir(pluginId))).hasGit) {
    s.ports.fs.put(pluginDir(pluginId));
    s.ports.git.setRepo(pluginDir(pluginId), {});
  }
  const title = o.title ?? `Rework of plugin «${pluginId}»`;
  const request = o.request ?? "R";
  const task = await s.ports.tasks.create({ tasksProjectId: "tp1", title, description: request });
  const id = `w_${pluginId}_${s.store.works().length + 1}`;
  s.store.tx(() => {
    s.store.addWork({ id, plugin_id: pluginId, kind: o.kind ?? "rework", tasks_project_id: "tp1", host_id: s.ports.serverHost, title, request, created_at: now, models: o.models ?? null });
    s.store.setTask(id, task, now);
    s.store.setProject(id, "p1", now);
    s.store.markCreated(id, now);
    s.store.setEntry(id, s.engine.firstStageEntry(s.store.work(id)!, now), now);
  });
  return id;
}

/** A work at Context: the first reconcile created the stage thread (still running); the work branch HEAD is `h1`, a descendant of the working copy HEAD. */
export async function started(s: Setup = setup(), o: Parameters<typeof madeWork>[1] = {}) {
  const id = await madeWork(s, o);
  await s.engine.reconcile(id);
  const w = s.store.work(id)!;
  const env = w.environment_id!;
  const dir = pluginDir(w.plugin_id);
  s.ports.git.link("h1", (await s.ports.git.facts(dir)).head);
  s.ports.heads.set(env, "h1");
  const key = w.task_key!;
  return { ...s, id, env, key, dir, docs: docPaths(key), w };
}
export type Started = Awaited<ReturnType<typeof started>>;

/** A new commit on the work branch on top of its HEAD. */
export function commitWork(s: Started, sha: string): void {
  s.ports.git.link(sha, s.ports.heads.get(s.env) ?? null);
  s.ports.heads.set(s.env, sha);
}

/** The stage thread finished its turn (the clock moves a minute ahead); by default — of the current stage. */
export function idleStage(s: Started, stage = s.store.work(s.id)!.stage): string {
  const t = s.store.stageThread(s.id, stage)!.thread_id;
  s.ports.idle(t);
  return t;
}

/** Move the work to a stage directly (bypassing the gates) and enter it by reconcile; the stage thread finished its turn. */
export async function moveTo(s: Started, stage: number): Promise<void> {
  const w = s.store.work(s.id)!;
  const now = s.ports.now();
  s.store.tx(() => {
    s.store.casStage(s.id, w.stage, stage, w.iteration, now);
    s.store.setEntry(s.id, { key: `${s.id}:jump:s${stage}:t${now}`, stage, from: w.stage, packet: null, error: null }, now);
  });
  await s.engine.reconcile(s.id);
  idleStage(s, stage);
}

let attempts = 0;
/** A rollout attempt of the work's plugin (by default — this work's rollout, finished successfully, at the work HEAD). */
export function attempt(
  s: Started,
  o: { id?: string; kind?: AttemptKind; status?: AttemptStatus; step?: AttemptStep; error?: string | null; lock?: boolean; work?: string | null } = {},
): string {
  const id = o.id ?? `a_${++attempts}`;
  const now = s.ports.now();
  const w = s.store.work(s.id)!;
  s.store.addAttempt({
    id, plugin_id: w.plugin_id, work_id: o.work === undefined ? s.id : o.work, kind: o.kind ?? "enter", before_sha: "c0", target_sha: s.ports.heads.get(s.env) ?? null,
    migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1, started_at: now,
  });
  const step = o.step ?? (o.status === undefined || o.status === "done" ? "checked" : "recorded");
  if (step !== "recorded") s.store.stepAttempt(id, "recorded", step, {}, now);
  if (o.lock) s.store.setLock(id, true, "tok", now);
  const status = o.status ?? "done";
  if (status !== "running") s.store.closeAttempt(id, status, o.error ?? null, now);
  return id;
}

/** A work at Rollout: the rollout finished successfully, the reconcile created the live check thread, and it finished its turn. Returns the attempt id. */
export async function entered(s: Started): Promise<string> {
  const w = s.store.work(s.id)!;
  const now = s.ports.now();
  const a = attempt(s);
  s.store.tx(() => {
    s.store.casStage(s.id, w.stage, 6, w.iteration, now);
    s.store.setEntry(s.id, s.engine.liveCheckEntry(s.store.work(s.id)!, s.store.attempt(a)!, now), now);
  });
  await s.engine.reconcile(s.id);
  idleStage(s, 6);
  return a;
}

/**
 * A review round without the reviewers themselves: thread rows (finished), files and verdicts. By default the stage agent has already received
 * the round files (`handed`): at Verification the rollout gate waits for that.
 */
export function reviewed(s: Started, stage: number, stageKey: StageKey, input: Version, verdicts: Partial<Record<Who, string>> = {}, round = 1, handed = true): void {
  for (const who of ["fable", "astra"] as Who[]) {
    const thread = `rv_${stage}_${who}_r${round}`;
    s.store.addRun({ thread_id: thread, work_id: s.id, stage, role: "review", who, round, input_version: input, regulation_sha: "r", created_at: 1 });
    s.store.markRunDone(thread, 2);
    s.ports.files.set(`${s.env}:${reviewPath(s.key, stageKey, who, round)}`, `ok\nVERDICT: ${verdicts[who] ?? "CLEAR"}`);
  }
  if (handed && (stage === 3 || stage === 5)) {
    const thread = s.store.stageThread(s.id, stage)?.thread_id ?? "stage-thread";
    const key = `${s.id}:${stage}:reviews-ready:r${round}:${thread}`;
    s.store.beginOp(key, s.id, "send", null, 2);
    s.store.finishOp(key, thread, 2);
  }
}

/** The work's current version. */
export const versionOf = (s: Started) => s.engine.version(s.store.work(s.id)!);
