// New work: «New plugin» (scaffold → rename → git → project → task → first stage) and «Rework» (project → task → first stage).
// The work is written first, with `created = 0`; every step is an intent (`beginOp`, key `${workId}:create:<step>`) → action → `finishOp`.
// An intent that was already pending (the previous pass failed or bb restarted) first looks for what was done and only then repeats the action.
// While `created = 0`, the work is driven by `Creation`, not by the engine's reconcile. The way out of creation is `cancel`.
//
// A refusal found BEFORE the action (a foreign folder in the plugin's place, a damaged scaffold) closes the intent as `failed`: the work stays in `error`,
// reconcile does not repeat it, the owner decides (cancel). A failed action or an inconclusive search leaves the intent `pending` — the next pass
// first looks for what was done. After a failure the scaffold is retried at most once every 5 minutes and at most three times — then a refusal (counter in the payload).

import type { WorkModels } from "../contract";
import { checkModels } from "./models";
import { randomUUID } from "node:crypto";
import { reworkBlockers, type Catalog } from "./catalog";
import { SCAFFOLD_FILES, type Ports } from "./ports";
import { redact } from "./secrets";
import { PLUGINS_ROOT, SELF_ID, pluginDir } from "./stages";
import type { Entry, NewWork, PluginRow, Store, WorkRow } from "./store";

export { SCAFFOLD_FILES };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Names bb keeps for its own commands and rejects as a plugin id (checked against bb 0.46.0). */
const RESERVED_IDS: ReadonlySet<string> = new Set([
  "browser", "diagnostics", "environment", "file", "guide", "help", "machine", "marketplace", "plugin", "project", "prompt-history",
  "provider", "server", "settings", "skill", "status", "terminal", "theme", "thread", "updates", "voice",
]);
const FOLDER_PREFIX = "bb-plugin-";

/** Form field limits — as in the panel contract. */
const NAME_MAX = 80;
const ID_MAX = 40;
const REQUEST_MAX = 20_000;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validId = (id: string) => id.length <= ID_MAX && ID_RE.test(id);

/**
 * What is wrong with the «New plugin» form; empty — all fine. `taken` — ids of installed plugins, `bb-plugin-*` folders, live board rows and the Workshop itself;
 * `retired` — ids of gone plugins that left history behind (rolled-out commit, attempt, past work), with their names.
 */
export function validateNewPlugin(input: { name: string; id: string; request: string }, taken: Set<string>, retired: ReadonlyMap<string, string> = new Map()): string[] {
  const out: string[] = [];
  const name = input.name.trim();
  const id = input.id.trim();
  if (!name) out.push("a name is required");
  else if ([...name].length > NAME_MAX) out.push(`name — up to ${NAME_MAX} characters`);
  if (!id) out.push("an id is required");
  else if (!validId(id)) out.push("id — lowercase Latin letters, digits and hyphens, up to 40 characters");
  else if (id.startsWith(FOLDER_PREFIX)) out.push(`id must not start with ${FOLDER_PREFIX}`);
  else if (RESERVED_IDS.has(id)) out.push(`id ${id} is taken by a bb command — choose another one`);
  else if (taken.has(id)) out.push(`id ${id} is already taken`);
  else if (retired.has(id)) out.push(retiredText(id, retired.get(id)!));
  out.push(...requestProblems(input.request));
  return out;
}

const retiredText = (id: string, name: string) => `id ${id} belonged to plugin «${name}» (gone) — choose another one`;

function requestProblems(request: string): string[] {
  const r = request.trim();
  if (!r) return ["a description is required: what the plugin should do"];
  if ([...r].length > REQUEST_MAX) return [`description — up to ${REQUEST_MAX} characters`];
  return [];
}

/** Work marker in the tracker task description: the task is found by it if the `create` response is lost. */
export const taskMarker = (workId: string) => `[workshop:${workId}]`;

/** The work's temporary scaffold folder: in it `bb plugin new <id>` creates the nested `bb-plugin-<id>/`. */
export const tmpDirOf = (workId: string) => `${PLUGINS_ROOT}/.workshop-new/${workId}`;

/** What `Creation` takes from the engine: entry into the first stage and reconcile (it creates the stage thread). */
export interface CreationEngine {
  firstStageEntry(w: WorkRow, now: number): Entry;
  reconcile(workId: string): Promise<void>;
}

/** An error after the work is written: `workId` — which work to carry on with. */
export class CreationError extends Error {
  override name = "CreationError";
  constructor(message: string, readonly workId: string, cause?: unknown) {
    super(message, { cause });
  }
}

/** A refusal before the action: the intent is closed as `failed`, the work stays in `error`, no automatic retry. */
class Refusal extends Error {
  override name = "Refusal";
}

/** Too early to retry the step: the pass over the work ends quietly — the error of the previous failure is already on the work. */
class NotYet extends Error {
  override name = "NotYet";
}

/**
 * The scaffold (`bb plugin new` under the build lock, with `npm install`) is heavy: after a failure it is retried no sooner than
 * `SCAFFOLD_RETRY_MS` later, after `SCAFFOLD_MAX_FAILURES` failures — a refusal, the owner decides. The counter lives in the payload of the scaffold intent:
 * it survives a restart.
 */
export const SCAFFOLD_MAX_FAILURES = 3;
export const SCAFFOLD_RETRY_MS = 5 * 60_000;
const SCAFFOLD_GAVE_UP = `the scaffold keeps failing (${SCAFFOLD_MAX_FAILURES} attempts) — cancel the creation and try again later`;
interface ScaffoldTries {
  failures: number;
  /** Time of the last failure. */
  at: number;
}
function triesOf(payload: string | null | undefined): ScaffoldTries {
  try {
    const p = JSON.parse(payload ?? "null") as Partial<ScaffoldTries> | null;
    if (p && typeof p.failures === "number" && typeof p.at === "number") return { failures: p.failures, at: p.at };
  } catch {
    /* someone else's or a corrupted payload — no failures yet */
  }
  return { failures: 0, at: 0 };
}
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

type StepName = "scaffold" | "rename" | "git" | "project" | "task";
interface StepSpec {
  /** Step name in messages to the owner. */
  title: string;
  /**
   * `pending` — what was done is looked for only if the intent was already pending: otherwise a find (a foreign folder in our place) does not count as ours.
   * `always` — «find or create»: the project for the folder, the task by marker, the commit.
   */
  search: "always" | "pending";
  /** The result of what was already done; null — not found. Several finds — an exception. */
  find: () => Promise<string | null>;
  act: () => Promise<string>;
  /** Write the result into the work; runs in one transaction with `finishOp`. */
  record?: (result: string, now: number) => void;
}

const newWorkId = () => `w_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

export class Creation {
  /** The pass over a work that is running or queued: a repeated call gets the same one. */
  private readonly running = new Map<string, Promise<void>>();
  /** One action on a work at a time (pass, cancel): otherwise a repeated search would take a running scaffold for an interrupted one. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly ports: Ports,
    private readonly catalog: Catalog,
    private readonly settings: () => { tasksProject: string },
    private readonly engine: CreationEngine,
  ) {}

  /** The tracker project for work tasks must be selected in the settings: the Workshop has no default of its own. */
  private needTasksProject(): void {
    if (!this.settings().tasksProject) throw new Error("no tracker project for work tasks is selected in the plugin settings (tasksProject) — project ids: `bb tasks project list`");
  }

  /** New plugin: writes the plugin and the work (`created = 0`) and drives the steps. An error after the work is written carries `workId`. */
  async newPlugin(raw: { name: string; id: string; request: string; models?: WorkModels }): Promise<string> {
    this.needTasksProject();
    const input = { name: raw.name.trim(), id: raw.id.trim(), request: raw.request.trim() };
    const { taken, retired } = await this.takenIds(input.id);
    const chosen = await this.modelsCheck(raw.models);
    const problems = [...validateNewPlugin(input, taken, retired), ...chosen.problems];
    if (problems.length > 0) throw new Error(problems.join("; "));
    const hostId = await this.ports.serverHostId();
    const workId = newWorkId();
    const now = this.ports.now();
    // The plugin row comes before any attempt: `Store.addAttempt` refuses without it; the name is the owner's, not the scaffold's.
    this.store.tx(() => {
      // A gone plugin's row without history (e.g. a canceled creation) does not hold the id: `upsertSeen` revives it.
      // With history it does: the new plugin would inherit the previous one's rolled-out commit and attempt.
      const known = this.store.plugin(input.id);
      if (known !== null && known.gone_reason === null) throw new Error(`id ${input.id} is already taken`);
      if (known !== null && this.hasHistory(known)) throw new Error(retiredText(known.id, known.name));
      this.store.upsertSeen({ id: input.id, name: input.name, dir: pluginDir(input.id), source: null }, now);
      this.store.addWork({ ...this.newWork(workId, "new", input.id, `New plugin «${input.name}»`, input.request, hostId, now), models: chosen.models ? JSON.stringify(chosen.models) : null });
    });
    this.store.log(workId, "create", `new plugin «${input.name}» (${input.id}): creating the work`, now);
    this.ports.changed(workId);
    return this.drive(workId);
  }

  /** Model choice: checked against bb's model list; if the list did not come, only what can be seen without it is checked. */
  private async modelsCheck(models: WorkModels | undefined): Promise<{ problems: string[]; models: WorkModels | null }> {
    if (!models) return { problems: [], models: null };
    const catalog = await this.ports.modelCatalog().then((providers) => ({ providers }), () => null);
    return checkModels(models, catalog);
  }

  /** «Rework»: a plugin with its own working copy on main without edits. If closed — one error with all of the catalog's reasons. */
  async rework(pluginId: string, rawRequest: string, models?: WorkModels): Promise<string> {
    this.needTasksProject();
    const request = rawRequest.trim();
    const chosen = await this.modelsCheck(models);
    const problems = [...requestProblems(request), ...chosen.problems];
    if (problems.length > 0) throw new Error(problems.join("; "));
    const facts = await this.catalog.one(pluginId);
    if (facts === null) throw new Error(`plugin ${pluginId} is not on the board`);
    const blockers = reworkBlockers(facts);
    if (blockers.length > 0) throw new Error(blockers.join("; "));
    const hostId = await this.ports.serverHostId();
    const workId = newWorkId();
    const now = this.ports.now();
    this.store.tx(() => {
      // Another work could have started between the catalog check and the write: the partial index would refuse, but words are clearer.
      if (this.store.openWorkOf(pluginId) !== null) throw new Error(`plugin ${pluginId} already has a work in progress`);
      this.store.addWork({ ...this.newWork(workId, "rework", pluginId, `Rework of plugin «${facts.row.name}»`, request, hostId, now), models: chosen.models ? JSON.stringify(chosen.models) : null });
    });
    this.store.log(workId, "create", `rework of plugin «${facts.row.name}» (${pluginId}): creating the work`, now);
    this.ports.changed(workId);
    return this.drive(workId);
  }

  /** Drive the work's creation steps; idempotent. A step's error is recorded on the work (state `error`, journal) and thrown. */
  advance(workId: string): Promise<void> {
    const busy = this.running.get(workId);
    if (busy) return busy;
    const p = this.serial(workId, () => this.run(workId)).finally(() => this.running.delete(workId));
    this.running.set(workId, p);
    return p;
  }

  /**
   * Cancel a work whose creation is not finished: remove the temporary scaffold folder, close the tracker task (`canceled`, with a comment),
   * close the work. The plugin row stays; if there is no plugin folder — «gone: creation canceled». The plugin folder, the bb project and anything
   * foreign are not touched. The cancel intent is written at once — a running pass stops after its current step, reconcile completes an interrupted cancel.
   */
  async cancel(workId: string, reason: string): Promise<void> {
    const w = this.store.work(workId);
    if (!w) throw new Error(`work ${workId} not found`);
    this.refuseCancel(w);
    const text = reason.trim() || "no reason given";
    this.store.beginOp(this.cancelKey(workId), workId, "create", text, this.ports.now());
    await this.serial(workId, async () => {
      // While it waited in the queue, the work could have been canceled or completed.
      const cur = this.store.work(workId);
      if (!cur) throw new Error(`work ${workId} not found`);
      this.refuseCancel(cur);
      await this.doCancel(cur, this.store.op(this.cancelKey(workId))?.payload ?? text);
    });
  }

  private refuseCancel(w: WorkRow): void {
    if (w.outcome === "canceled") throw new Error("the work is already canceled");
    if (w.outcome !== null) throw new Error("the work is already finished");
    if (w.created === 1) throw new Error("creation is already finished — the work is canceled the regular way");
  }

  /** All works whose creation is not finished — one by one (the scaffold is heavy). A failed one does not hold up the rest: its error is already on it. */
  async advanceAll(): Promise<void> {
    for (const w of this.store.creatingWorks()) await this.advance(w.id).catch(() => undefined);
  }

  // --- internals ---

  private newWork(id: string, kind: NewWork["kind"], pluginId: string, title: string, request: string, hostId: string, now: number): NewWork {
    return { id, plugin_id: pluginId, kind, tasks_project_id: this.settings().tasksProject, host_id: hostId, title, request, created_at: now };
  }

  private serial<T>(workId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(workId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(workId, next.catch(() => undefined));
    return next;
  }

  private cancelKey = (workId: string) => `${workId}:create:cancel`;

  private async drive(workId: string): Promise<string> {
    try {
      await this.advance(workId);
    } catch (e) {
      throw new CreationError(errText(e), workId, e);
    }
    // The pass may have stopped not because everything is done but because the work is being (or has been) canceled: that is not success.
    if (this.store.work(workId)?.outcome === "canceled" || this.store.op(this.cancelKey(workId)) !== null) throw new CreationError("creation canceled", workId);
    return workId;
  }

  /** The gone plugin's row has history: a rolled-out commit, a rollout attempt or a past work other than a canceled creation. */
  private hasHistory(row: PluginRow): boolean {
    if (row.installed_sha !== null || row.current_attempt !== null || this.store.openWorkOf(row.id) !== null) return true;
    return this.store.pastWorks(row.id).some((w) => !(w.outcome === "canceled" && w.created === 0));
  }

  /**
   * Taken ids: installed plugins, folders in the plugins root, live board rows, the Workshop itself. Gone rows with history — separately
   * (`retired`, with the name); without history the id is free.
   */
  private async takenIds(id: string): Promise<{ taken: Set<string>; retired: Map<string, string> }> {
    const list = await this.ports.plugins.list().catch((e) => {
      throw new Error(`could not get the plugin list: ${errText(e)}`);
    });
    // The folder listing is only a help: without it a taken folder is still found by the path check below.
    const folders = await this.ports.plugins.folders().catch(() => []);
    const rows = this.store.plugins();
    const taken = new Set<string>([SELF_ID, ...list.map((p) => p.id), ...folders.map((p) => p.id), ...rows.filter((p) => p.gone_reason === null).map((p) => p.id)]);
    if (validId(id) && (await this.ports.fs.exists(pluginDir(id)))) taken.add(id);
    const retired = new Map(rows.filter((p) => p.gone_reason !== null && this.hasHistory(p)).map((p) => [p.id, p.name] as const));
    return { taken, retired };
  }

  private async run(workId: string): Promise<void> {
    const w = this.store.work(workId);
    if (!w || w.created === 1 || w.outcome !== null) return;
    try {
      // A cancel was started but not completed (a failure halfway, a restart): complete it, not the creation.
      const cancel = this.store.op(this.cancelKey(workId));
      if (cancel !== null) {
        if (cancel.status === "pending") await this.doCancel(w, cancel.payload ?? "no reason given");
        return;
      }
      const steps: Array<() => Promise<void>> = [];
      if (w.kind === "new") steps.push(() => this.scaffold(w), () => this.rename(w), () => this.git(w));
      steps.push(() => this.project(w), () => this.task(w));
      for (const step of steps) {
        // A cancel may have been requested while the previous step ran: do not go on, the queue will complete it.
        if (this.store.op(this.cancelKey(workId)) !== null) return;
        await step();
      }
      if (this.store.op(this.cancelKey(workId)) !== null) return;
      await this.finish(w.id);
    } catch (e) {
      if (e instanceof NotYet) return;
      const reason = errText(e);
      try {
        const now = this.ports.now();
        this.store.setState(workId, "error", reason, false, now);
        this.store.log(workId, "error", reason, now);
        this.ports.changed(workId);
      } catch {
        /* recording the failure is not essential: the next pass repeats it */
      }
      throw e;
    }
  }

  /** Intent → look for what was done (if the intent was already pending or the step is «find or create») → action → record the result and `finishOp`. */
  private async step(w: WorkRow, name: StepName, s: StepSpec): Promise<void> {
    const key = `${w.id}:create:${name}`;
    const prior = this.store.op(key);
    if (prior?.status === "done") return;
    // What was closed by a refusal is neither repeated nor looked for: the work waits for the owner's decision.
    if (prior?.status === "failed") throw new Error(`${s.title}: ${prior.error ?? "refused"}`);
    try {
      this.store.beginOp(key, w.id, "create", null, this.ports.now());
      let result: string | null = null;
      if (s.search === "always" || prior !== null) result = await s.find();
      result ??= await s.act();
      const done = result;
      const now = this.ports.now();
      this.store.tx(() => {
        s.record?.(done, now);
        this.store.finishOp(key, done, now);
      });
      this.store.log(w.id, "create", `${s.title}: done`, now);
    } catch (e) {
      if (e instanceof Refusal) this.store.failOp(key, e.message, this.ports.now());
      throw new Error(`${s.title}: ${errText(e)}`, { cause: e });
    }
  }

  /** The scaffold is complete: the nested folder has everything `bb plugin new` puts there (an interrupted `npm install` lacks `node_modules`). */
  private async complete(nested: string): Promise<boolean> {
    const names = await this.ports.fs.list(nested);
    return SCAFFOLD_FILES.every((f) => names.includes(f));
  }

  private async scaffold(w: WorkRow): Promise<void> {
    const dir = pluginDir(w.plugin_id);
    const tmp = tmpDirOf(w.id);
    const nested = `${tmp}/bb-plugin-${w.plugin_id}`;
    const key = `${w.id}:create:scaffold`;
    const op = this.store.op(key);
    if (op?.status === "pending") {
      const t = triesOf(op.payload);
      // The limit is not used up yet, but less than the interval has passed since the last failure — the heavy command is not started.
      if (t.failures > 0 && t.failures < SCAFFOLD_MAX_FAILURES && this.ports.now() - t.at < SCAFFOLD_RETRY_MS) throw new NotYet();
    }
    return this.step(w, "scaffold", {
      title: "scaffold",
      search: "pending",
      // The plugin folder means nothing here: before the rename it can only be someone else's.
      find: async () => {
        if (await this.complete(nested)) return "scaffold complete";
        // Incomplete or in the wrong place (files directly in tmpDir): not patched up, started over.
        await this.ports.fs.remove(tmp);
        return null;
      },
      act: async () => {
        // The heavy command is not run over someone else's folder.
        if (await this.ports.fs.exists(dir)) throw new Refusal(`folder ${dir} already exists and is not a Workshop scaffold — cancel the work and choose another id`);
        // The limit could be used up without the refusal recorded (a restart in between): no fourth run.
        if (triesOf(this.store.op(key)?.payload).failures >= SCAFFOLD_MAX_FAILURES) throw new Refusal(SCAFFOLD_GAVE_UP);
        try {
          await this.ports.fs.scaffold(w.plugin_id, tmp);
          // `bb plugin new` reports success even when `npm install` failed: completeness is checked here, an incomplete scaffold is removed — the next pass starts over.
          if (!(await this.complete(nested))) {
            await this.ports.fs.remove(tmp);
            throw new Error(`scaffold incomplete: bb plugin new finished, but ${nested} is missing files (npm install may have failed); the temporary folder was removed, the scaffold will be made again`);
          }
        } catch (e) {
          const failures = triesOf(this.store.op(key)?.payload).failures + 1;
          const now = this.ports.now();
          // The intent is still pending: beginOp only updates the payload.
          this.store.beginOp(key, w.id, "create", JSON.stringify({ failures, at: now } satisfies ScaffoldTries), now);
          if (failures >= SCAFFOLD_MAX_FAILURES) throw new Refusal(`${SCAFFOLD_GAVE_UP}; last error: ${clip(errText(e), 300)}`);
          throw new Error(`${errText(e)} — retry in ${SCAFFOLD_RETRY_MS / 60_000} minutes at the earliest (failures: ${failures} of ${SCAFFOLD_MAX_FAILURES})`, { cause: e });
        }
        return "scaffold made";
      },
    });
  }

  private rename(w: WorkRow): Promise<void> {
    const dir = pluginDir(w.plugin_id);
    const tmp = tmpDirOf(w.id);
    const nested = `${tmp}/bb-plugin-${w.plugin_id}`;
    return this.step(w, "rename", {
      title: "scaffold rename",
      search: "pending",
      // The plugin folder is our result only if the work made the scaffold itself (its intent is closed) and the nested folder is gone:
      // the rename took it away. While the scaffold sits in the temporary folder, the plugin folder is someone else's.
      find: async () => {
        const scaffolded = this.store.op(`${w.id}:create:scaffold`)?.status === "done";
        if (!scaffolded || !(await this.ports.fs.exists(dir)) || (await this.ports.fs.exists(nested))) return null;
        await this.ports.fs.remove(tmp);
        return "plugin folder in place";
      },
      act: async () => {
        if (await this.ports.fs.exists(dir)) throw new Refusal(`folder ${dir} already exists and is not a Workshop scaffold — cancel the work and choose another id`);
        if (!(await this.complete(nested))) throw new Refusal(`scaffold ${nested} is gone or incomplete — not redoing it blindly: cancel the work`);
        await this.ports.fs.rename(nested, dir);
        await this.ports.fs.remove(tmp);
        return "scaffold renamed";
      },
    });
  }

  private git(w: WorkRow): Promise<void> {
    const dir = pluginDir(w.plugin_id);
    return this.step(w, "git", {
      title: "git",
      search: "always",
      find: async () => (await this.ports.git.facts(dir)).head,
      act: () => this.ports.git.initCommit(dir, `chore: scaffold plugin ${w.plugin_id} (bb plugin new)`),
    });
  }

  private project(w: WorkRow): Promise<void> {
    const dir = pluginDir(w.plugin_id);
    const name = this.store.plugin(w.plugin_id)?.name ?? w.plugin_id;
    return this.step(w, "project", {
      title: "execution project",
      search: "always",
      find: async () => {
        const found = await this.ports.projects.findByPath(w.host_id, dir);
        if (found.length > 1) throw new Error(`several bb projects point to folder ${dir}: ${found.join(", ")} — keep one`);
        return found[0] ?? null;
      },
      act: () => this.ports.projects.create({ name: `Plugin · ${name}`, dir, hostId: w.host_id }),
      record: (projectId, now) => {
        this.store.setProject(w.id, projectId, now);
        this.store.setPluginProject(w.plugin_id, projectId);
      },
    });
  }

  private task(w: WorkRow): Promise<void> {
    const marker = taskMarker(w.id);
    return this.step(w, "task", {
      title: "tracker task",
      search: "always",
      find: async () => {
        const found = await this.ports.tasks.findByMarker(w.tasks_project_id, marker);
        if (found.length > 1) throw new Error(`several tasks found by marker ${marker}: ${found.map((t) => t.key).join(", ")} — keep one`);
        return found[0] ? JSON.stringify({ id: found[0].id, key: found[0].key }) : null;
      },
      act: async () => {
        // The request goes to the tracker redacted: token-shaped text pasted into it is not kept in the task.
        const t = await this.ports.tasks.create({ tasksProjectId: w.tasks_project_id, title: redact(w.title), description: `${redact(w.request)}\n\n${marker}` });
        return JSON.stringify({ id: t.id, key: t.key });
      },
      record: (result, now) => this.store.setTask(w.id, JSON.parse(result) as { id: string; key: string }, now),
    });
  }

  /** Cancel: temporary folder, tracker task, work, plugin row — in this order, each action repeatable; closing the work is written last. */
  private async doCancel(w: WorkRow, reason: string): Promise<void> {
    try {
      // The temporary folder belongs to this work only; the plugin folder is never touched.
      await this.ports.fs.remove(tmpDirOf(w.id));
      const taskKey = `${w.id}:create:cancel-task`;
      if (this.store.op(taskKey)?.status !== "done") {
        this.store.beginOp(taskKey, w.id, "create", null, this.ports.now());
        // The task could have been created without being recorded: look it up by marker as well.
        const ids = new Set<string>(w.task_id ? [w.task_id] : []);
        for (const t of await this.ports.tasks.findByMarker(w.tasks_project_id, taskMarker(w.id))) ids.add(t.id);
        for (const id of ids) {
          await this.ports.tasks.setStatus(id, "canceled");
          await this.ports.tasks.comment(id, `Plugin creation canceled: ${redact(reason)}`);
        }
        this.store.finishOp(taskKey, [...ids].join(","), this.ports.now());
      }
      const gone = w.kind === "new" && !(await this.ports.fs.exists(pluginDir(w.plugin_id)));
      const now = this.ports.now();
      this.store.tx(() => {
        this.store.finish(w.id, "canceled", now);
        // Cleanup and the task were handled right here: the engine's reconcile does not take works with `created = 0`.
        this.store.setCleanupDone(w.id);
        this.store.setTaskSynced(w.id, "canceled");
        if (gone && this.store.plugin(w.plugin_id) !== null) this.store.markGone(w.plugin_id, "creation canceled", now);
        // Pending intents of steps that were never completed are closed: nobody will look for them anymore.
        for (const op of this.store.pendingOps(w.id)) if (op.key !== this.cancelKey(w.id)) this.store.failOp(op.key, "creation canceled", now);
        this.store.finishOp(this.cancelKey(w.id), "canceled", now);
      });
    } catch (e) {
      throw new Error(`cancel: ${errText(e)}`, { cause: e });
    }
    this.store.log(w.id, "cancel", `creation canceled: ${reason}`, this.ports.now());
    this.ports.changed(w.id);
  }

  /** Last step: `markCreated` and entry into the first stage — in one transaction (both or neither); the engine's reconcile creates the stage thread. */
  private async finish(workId: string): Promise<void> {
    const now = this.ports.now();
    try {
      const done = this.store.tx(() => {
        const cur = this.store.work(workId);
        if (!cur || cur.created === 1 || cur.outcome !== null) return false;
        this.store.markCreated(workId, now);
        this.store.setEntry(workId, this.engine.firstStageEntry(this.store.work(workId)!, now), now);
        this.store.setState(workId, "new", "starting the first stage", false, now);
        return true;
      });
      if (!done) return;
    } catch (e) {
      throw new Error(`first stage: ${errText(e)}`, { cause: e });
    }
    this.store.log(workId, "create", "work created: starting the first stage", now);
    this.ports.changed(workId);
    try {
      await this.engine.reconcile(workId);
    } catch (e) {
      // The work is created; reconcile sets up the stage thread on its next pass.
      this.store.log(workId, "warn", `reconcile after creation: ${errText(e)}`, this.ports.now());
    }
  }
}
