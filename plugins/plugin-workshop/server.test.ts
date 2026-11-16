import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost, makePluginAgentConfigurationContext, makeThreadResponse, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workshopContract } from "./contract";
import plugin from "./server";
import { FakePorts } from "./server/fake-ports";
import { MIGRATIONS } from "./server/migrations";
import { identity } from "./server/regulations";
import { BUILD_LOCK, rulesText } from "./server/rules";
import { COLUMNS, docPaths, pluginDir, PLUGINS_ROOT, reviewPath, SELF_ID, setPluginsRoot, stageOf, verifyPath, type Column, type Who } from "./server/stages";
import { Store } from "./server/store";
import { idleStage, moveTo, reviewed, versionOf, type Started } from "./server/test-utils";
import { READ_ONLY_RPC, wire, type Wiring } from "./server/wiring";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Boot = FakePluginHost & {
  ports: FakePorts;
  store: Store;
  w: Wiring;
  /** Lock folders the wiring must create at startup (temporary: the test does not touch the real ones). */
  lockDirs: string[];
  subscriptions: Array<{ event: string; callback: (event?: unknown) => void }>;
  unsubscribe: ReturnType<typeof vi.fn>;
};

/** The plugin on top of a fake bb and FakePorts; the test touches neither the real lock folders nor the SDK ports. */
async function boot(o: { settings?: Record<string, string | number | boolean>; seed?: (store: Store, ports: FakePorts) => void; sweepFails?: boolean; minGapMs?: number } = {}): Promise<Boot> {
  const ports = new FakePorts();
  const root = mkdtempSync(join(tmpdir(), "workshop-wire-"));
  tmpDirs.push(root);
  const lockDirs = [join(root, "locks", SELF_ID), join(root, "locks")];
  const subscriptions: Boot["subscriptions"] = [];
  const unsubscribe = vi.fn();
  const host = createFakePluginHost({
    pluginId: SELF_ID,
    ...(o.settings ? { settings: o.settings } : {}),
    sdk: { subscribe: ((args: { event: string; callback: (event?: unknown) => void }) => (subscriptions.push(args), unsubscribe)) as never },
  });
  // Database rows go in before the plugin loads: the migrations are applied again afterwards, harmlessly.
  const db = host.bb.storage.database();
  host.bb.storage.migrate(db, MIGRATIONS);
  const store = new Store(db);
  o.seed?.(store, ports);
  if (o.sweepFails) vi.spyOn(ports.lock, "sweep").mockRejectedValue(new Error("disk"));
  const w = await wire(host.bb, {
    ports: (_bb, onChange) => {
      const record = ports.changed.bind(ports);
      ports.changed = (workId: string) => (record(workId), onChange(workId));
      return ports;
    },
    lockDirs,
    debounceMs: 20,
    minGapMs: o.minGapMs ?? 0,
  });
  return { ...host, ports, store, w, lockDirs, subscriptions, unsubscribe };
}

const rpc = (b: Boot, method: string, input: unknown = null) => b.harness.callRpc(method, input);
/** An installed plugin with a working copy on main — the catalog sees it. */
function install(b: Boot, id: string, repo: { head?: string; dirtyCount?: number } = {}) {
  b.ports.plugins.add({ id });
  b.ports.git.setRepo(pluginDir(id), repo);
}
const TASKS = { tasksProject: "tp1" };
/** The bb event "the plugin list changed". */
const SYSTEM_PLUGINS = { entity: "system", type: "changed", changes: ["plugins-changed"] };
type CardRow = { id: string; column: string; bbState: string; stateStale: boolean };
/** A column title as the CLI prints it, escaped for a RegExp. */
const column = (key: Column) => COLUMNS.find((c) => c.key === key)!.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const card = async (b: Boot, id: string) => ((await rpc(b, "board")) as { plugins: CardRow[] }).plugins.find((p) => p.id === id)!;

/** A work on «mail» at Verification with the rollout gate open (like `ready` in the Rollout tests), but through the wiring: the calls, ports and store are the plugin's. */
async function atVerify(b: Boot): Promise<Started> {
  install(b, "mail");
  await b.w.catalog.sync();
  const { workId } = (await rpc(b, "rework", { pluginId: "mail", request: "x" })) as { workId: string };
  const w = b.store.work(workId)!;
  const dir = pluginDir("mail");
  b.ports.git.link("h1", (await b.ports.git.facts(dir)).head);
  b.ports.heads.set(w.environment_id!, "h1");
  const s = { store: b.store, ports: b.ports, engine: b.w.engine, id: workId, env: w.environment_id!, key: w.task_key!, dir, docs: docPaths(w.task_key!), w } as unknown as Started;
  idleStage(s);
  b.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
  await moveTo(s, 5);
  b.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "all ok\nVERDICT: PASS");
  // The Verification reviewers started on their own together with the verifier: they write their files, the reconcile closes the round
  // and hands the files to the verifier, which finishes its turn.
  const auto = b.store.runs(s.id).filter((r) => r.role === "review" && r.stage === 5);
  if (auto.length === 0) reviewed(s, 5, "verify", await versionOf(s));
  for (const r of auto) {
    b.ports.files.set(`${s.env}:${reviewPath(s.key, "verify", r.who as Who, r.round)}`, "ok\nVERDICT: CLEAR");
    b.ports.idle(r.thread_id);
  }
  if (auto.length > 0) {
    await b.w.engine.reconcile(s.id);
    idleStage(s, 5);
  }
  return s;
}

describe("workshop plugin wiring", () => {
  it("registers every method of the contract, the reconcile service and a read-only CLI", async () => {
    const b = await boot();
    expect([...b.harness.registrations.rpcMethods].sort()).toEqual(Object.keys(workshopContract).sort());
    expect([...b.harness.registrations.rpcMethods].sort()).toEqual(
      [
        "accept", "adopt", "board", "cancel", "cancelInstall", "enter", "file", "handOver", "hidePlugin", "models", "newPlugin", "pilotResume", "pilotStart", "pilotStop", "plugin", "reconfirm",
        "reinstall", "restartStage", "review", "rework", "rollback", "sendBack", "setEnabled", "stopReviews", "work",
      ].sort(),
    );
    expect(b.harness.registrations.services.map((s) => s.name)).toContain("reconcile");
    expect(b.harness.registrations.cli?.name).toBe(SELF_ID);
    expect(b.harness.registrations.cli?.commands.map((c) => c.name)).toEqual(["list", "show"]);
    await b.harness.lifecycle.dispose();
  });

  it("the CLI has no transitions: anything but list and show is refused", async () => {
    const b = await boot();
    for (const sub of ["enter", "accept", "rollback", "handover", "cancel", "enable", "disable", "reinstall"]) {
      const out = await b.harness.behavior.runCli([sub, "hello"]);
      expect(out.exitCode, sub).toBe(1);
      expect(out.stderr).toContain("commands: list, show");
    }
    await b.harness.lifecycle.dispose();
  });

  it("declares the nine settings with their defaults; public repositories are off by default", async () => {
    const b = await boot();
    const d = b.harness.registrations.settingsDescriptors;
    expect(Object.keys(d).sort()).toEqual(["allowPublicRepos", "autoReview", "buildLock", "githubOwner", "maxBuilding", "minFreeDiskGb", "mockupStage", "pluginsRoot", "tasksProject"]);
    expect([d.maxBuilding, d.minFreeDiskGb, d.autoReview, d.mockupStage, d.githubOwner, d.allowPublicRepos, d.pluginsRoot, d.buildLock, d.tasksProject].map((x) => (x as { default?: unknown }).default)).toEqual([2, 2, true, true, "", false, "", "", ""]);
    await b.harness.lifecycle.dispose();
  });

  it("the module's default export is the loader function", () => {
    expect(typeof plugin).toBe("function");
  });
});

describe("startup", () => {
  it("makes the lock folders", async () => {
    const b = await boot();
    for (const d of b.lockDirs) expect(existsSync(d), d).toBe(true);
    await b.harness.lifecycle.dispose();
  });

  it("sweeps the lock marks of every attempt that may still hold the lock, and only those", async () => {
    let sweep: ReturnType<typeof vi.spyOn> | undefined;
    const b = await boot({
      seed: (store, ports) => {
        sweep = vi.spyOn(ports.lock, "sweep");
        store.upsertSeen({ id: "hello", name: "Hello", dir: pluginDir("hello"), source: null }, 1);
        const base = { plugin_id: "hello", work_id: null, kind: "enter" as const, before_sha: "a", target_sha: "b", migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1 };
        store.addAttempt({ ...base, id: "att_locking", started_at: 1 });
        store.stepAttempt("att_locking", "recorded", "locking", { lock_token: "t1", lock_held: 1 }, 2);
        store.closeAttempt("att_locking", "unknown", "outcome unknown", 3);
        store.addAttempt({ ...base, id: "att_released", started_at: 4 });
        store.closeAttempt("att_released", "done", null, 5);
        store.addAttempt({ ...base, id: "att_open", started_at: 6 });
        store.stepAttempt("att_open", "recorded", "installed", { lock_token: "t2", lock_held: 1 }, 7);
      },
    });
    expect(sweep).toHaveBeenCalledTimes(1);
    expect((sweep!.mock.calls[0]![0] as string[]).sort()).toEqual(["att_locking", "att_open"]);
    await b.harness.lifecycle.dispose();
  });

  it("with no attempts the sweep clears every mark", async () => {
    let sweep: ReturnType<typeof vi.spyOn> | undefined;
    const b = await boot({ seed: (_s, ports) => void (sweep = vi.spyOn(ports.lock, "sweep")) });
    expect(sweep!.mock.calls).toEqual([[[]]]);
    await b.harness.lifecycle.dispose();
  });

  it("a failed sweep does not stop the plugin: it is logged, the methods are registered", async () => {
    const b = await boot({ sweepFails: true });
    expect(b.harness.registrations.rpcMethods).toContain("board");
    expect(b.harness.logEntries.some((e) => e.level === "warn" && e.message.includes("disk"))).toBe(true);
    await b.harness.lifecycle.dispose();
  });
});

describe("agent configuration", () => {
  it("the thread of a work gets who it is and the plugin rules; a stranger gets nothing", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "hello");
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "hello", request: "do something" })) as { workId: string };
    const run = b.store.runs(workId)[0]!;
    const mine = await b.harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: run.thread_id } }));
    expect(mine.instructions).toContain(identity(b.store.work(workId)!, stageOf(run.stage), run.role));
    expect(mine.instructions).toContain(rulesText());
    const stranger = await b.harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "thr_stranger" } }));
    expect(stranger.instructions).toBeNull();
    expect([stranger.tools, stranger.skills]).toEqual([[], []]);
    await b.harness.lifecycle.dispose();
  });

  it("a thread being born is known from the metadata of its spawn", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "hello");
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "hello", request: "do something" })) as { workId: string };
    const born = await b.harness.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({ thread: { id: "thr_just_born" }, pluginMetadata: { workId, stage: 1, role: "stage", who: "claude" } }),
    );
    expect(born.instructions).toContain(rulesText());
    await b.harness.lifecycle.dispose();
  });
});

describe("new plugin and rework", () => {
  it("a taken id is an error and nothing is scaffolded", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    await b.w.catalog.sync();
    await expect(rpc(b, "newPlugin", { name: "Mail 2", id: "mail", request: "another one" })).rejects.toThrow("id mail is already taken");
    expect(b.ports.count("scaffold")).toBe(0);
    expect(b.store.works()).toEqual([]);
    await b.harness.lifecycle.dispose();
  });

  it("the contract's limits are enforced before the code runs", async () => {
    const b = await boot();
    await expect(rpc(b, "newPlugin", { name: "", id: "x", request: "y" })).rejects.toThrow();
    await expect(rpc(b, "newPlugin", { name: "я".repeat(81), id: "x", request: "y" })).rejects.toThrow();
    await expect(rpc(b, "newPlugin", { name: "x", id: "i".repeat(41), request: "y" })).rejects.toThrow();
    await expect(rpc(b, "newPlugin", { name: "x", id: "x", request: "я".repeat(20001) })).rejects.toThrow();
    expect(b.ports.count("scaffold")).toBe(0);
    await b.harness.lifecycle.dispose();
  });

  it("creates the plugin and its work: the card is on the board, the task goes to the tracker project from the setting", async () => {
    const b = await boot({ settings: TASKS });
    const out = (await rpc(b, "newPlugin", { name: "Hello", id: "hello", request: "a bb hello command" })) as { workId: string; error: string | null };
    expect(out.error).toBeNull();
    expect(b.ports.calls.map((c) => c.effect).slice(0, 5)).toEqual(["scaffold", "rename", "initCommit", "projects.create", "tasks.create"]);
    expect([...b.ports.taskRows.values()][0]).toMatchObject({ projectId: "tp1" });
    const board = (await rpc(b, "board")) as { plugins: Array<{ id: string; column: string; work: { id: string } | null }> };
    expect(board.plugins.find((p) => p.id === "hello")).toMatchObject({ column: "context", work: { id: out.workId } });
    await b.harness.lifecycle.dispose();
  });

  it("tasksProject is read through the setting and follows its changes", async () => {
    const b = await boot();
    await b.harness.behavior.setSettings({ tasksProject: "tp9" });
    await rpc(b, "newPlugin", { name: "Hello", id: "hello", request: "x" });
    expect([...b.ports.taskRows.values()][0]).toMatchObject({ projectId: "tp9" });
    await b.harness.lifecycle.dispose();
  });

  it("a creation that fails after the work is written answers with the work id and the error", async () => {
    const b = await boot({ settings: TASKS });
    b.ports.failAt("scaffold", "before");
    const out = (await rpc(b, "newPlugin", { name: "Hello", id: "hello", request: "x" })) as { workId: string; error: string };
    expect(out.workId).toMatch(/^w_/);
    expect(out.error).toContain("scaffold");
    expect(b.store.work(out.workId)).toMatchObject({ created: 0, state: "error" });
    // The work page opens and shows what happened.
    const view = (await rpc(b, "work", { workId: out.workId })) as { work: { created: boolean; state: string; reason: string } };
    expect(view.work).toMatchObject({ created: false, state: "error" });
    expect(view.work.reason).toContain("scaffold");
    await b.harness.lifecycle.dispose();
  });

  it("rework: a plugin that is closed for it is an error with all the reasons; an open one gets a work", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "newproject", { dirtyCount: 4 });
    install(b, "mail");
    await b.w.catalog.sync();
    await expect(rpc(b, "rework", { pluginId: "newproject", request: "x" })).rejects.toThrow("4 uncommitted changes in the working copy");
    await expect(rpc(b, "rework", { pluginId: "nobody", request: "x" })).rejects.toThrow("plugin nobody is not on the board");
    const out = (await rpc(b, "rework", { pluginId: "mail", request: "add a command" })) as { workId: string; error: string | null };
    expect(out.error).toBeNull();
    expect(b.store.work(out.workId)).toMatchObject({ plugin_id: "mail", kind: "rework", created: 1 });
    await b.harness.lifecycle.dispose();
  });
});

describe("owner buttons", () => {
  /** A work on «mail» at Context. */
  async function withWork(b: Boot): Promise<string> {
    install(b, "mail");
    await b.w.catalog.sync();
    return ((await rpc(b, "rework", { pluginId: "mail", request: "add a command" })) as { workId: string }).workId;
  }

  it("cancel of a work that is still being created goes to Creation; of a created one — to the engine", async () => {
    const b = await boot({ settings: TASKS });
    b.ports.failAt("scaffold", "before");
    const creating = ((await rpc(b, "newPlugin", { name: "Hello", id: "hello", request: "x" })) as { workId: string }).workId;
    b.ports.failAt(null);
    const creationCancel = vi.spyOn(b.w.creation, "cancel");
    const engineCancel = vi.spyOn(b.w.engine, "cancel");
    await rpc(b, "cancel", { workId: creating, reason: "changed my mind" });
    expect(creationCancel.mock.calls).toEqual([[creating, "changed my mind"]]);
    expect(engineCancel).not.toHaveBeenCalled();
    expect(b.store.work(creating)).toMatchObject({ outcome: "canceled" });

    const id = await withWork(b);
    b.ports.idle(b.store.runs(id)[0]!.thread_id);
    await rpc(b, "cancel", { workId: id, reason: "not needed" });
    expect(engineCancel).toHaveBeenCalledWith(id, "not needed");
    expect(creationCancel).toHaveBeenCalledTimes(1);
    expect(b.store.work(id)).toMatchObject({ outcome: "canceled" });
    await b.harness.lifecycle.dispose();
  });

  it("cancel of an unknown work is an error", async () => {
    const b = await boot();
    await expect(rpc(b, "cancel", { workId: "w_nope", reason: "x" })).rejects.toThrow("work not found");
    await b.harness.lifecycle.dispose();
  });

  it("sendBack passes force and fixForward to the engine", async () => {
    const b = await boot({ settings: TASKS });
    const id = await withWork(b);
    const send = vi.spyOn(b.w.engine, "sendBack").mockResolvedValue();
    await rpc(b, "sendBack", { workId: id, expectedStage: 6, toStage: 4, reason: "fixing forward", fixForward: true, force: true });
    expect(send).toHaveBeenCalledWith(id, { expectedStage: 6, toStage: 4, reason: "fixing forward", fixForward: true, force: true });
    await rpc(b, "sendBack", { workId: id, expectedStage: 2, toStage: 1, reason: "x" });
    expect(send).toHaveBeenLastCalledWith(id, { expectedStage: 2, toStage: 1, reason: "x" });
    await b.harness.lifecycle.dispose();
  });

  it("handOver, review, stopReviews and restartStage reach the engine; enter and accept — Rollout", async () => {
    const b = await boot({ settings: TASKS });
    const id = await withWork(b);
    const spies = {
      handOver: vi.spyOn(b.w.engine, "handOver").mockResolvedValue({ ok: true, blockers: [], warnings: [] }),
      requestReview: vi.spyOn(b.w.engine, "requestReview").mockResolvedValue(),
      stopReviews: vi.spyOn(b.w.engine, "stopReviews").mockResolvedValue(),
      restartStage: vi.spyOn(b.w.engine, "restartStage").mockResolvedValue(),
      enter: vi.spyOn(b.w.rollout, "enter").mockResolvedValue({ ok: false, blockers: ["no report"], warnings: [] }),
      accept: vi.spyOn(b.w.rollout, "accept").mockResolvedValue({ ok: true, blockers: [], warnings: [] }),
    };
    const version = { iteration: 1, headSha: "h1", dirty: false, contextSha: "c", techSha: "t", tzSha: "z" };
    expect(await rpc(b, "handOver", { workId: id, expectedStage: 1, expectedVersion: version, note: "ok", force: false })).toEqual({ ok: true, blockers: [], warnings: [] });
    expect(spies.handOver).toHaveBeenCalledWith(id, { expectedStage: 1, expectedVersion: version, note: "ok", force: false });
    expect(await rpc(b, "review", { workId: id, expectedStage: 3 })).toBeNull();
    expect(spies.requestReview).toHaveBeenCalledWith(id, 3);
    expect(await rpc(b, "stopReviews", { workId: id, expectedStage: 3 })).toBeNull();
    expect(spies.stopReviews).toHaveBeenCalledWith(id, 3);
    expect(await rpc(b, "restartStage", { workId: id, expectedStage: 4 })).toBeNull();
    expect(spies.restartStage).toHaveBeenCalledWith(id, 4);
    expect(await rpc(b, "enter", { workId: id, expectedVersion: version, force: true })).toEqual({ ok: false, blockers: ["no report"], warnings: [] });
    expect(spies.enter).toHaveBeenCalledWith(id, { expectedVersion: version, force: true });
    expect(await rpc(b, "accept", { workId: id, expectedVersion: version, attemptId: "att_1", force: false, note: "good" })).toEqual({ ok: true, blockers: [], warnings: [] });
    expect(spies.accept).toHaveBeenCalledWith(id, { expectedVersion: version, attemptId: "att_1", force: false, note: "good" });
    await b.harness.lifecycle.dispose();
  });

  it("a button pauses the autopilot under the name the panel gives it", async () => {
    const b = await boot({ settings: TASKS });
    const id = await withWork(b);
    const ok = { ok: true, blockers: [], warnings: [] };
    vi.spyOn(b.w.engine, "handOver").mockResolvedValue(ok);
    vi.spyOn(b.w.engine, "reconfirm").mockResolvedValue();
    vi.spyOn(b.w.engine, "requestReview").mockResolvedValue();
    vi.spyOn(b.w.engine, "stopReviews").mockResolvedValue();
    vi.spyOn(b.w.engine, "restartStage").mockResolvedValue();
    vi.spyOn(b.w.engine, "sendBack").mockResolvedValue();
    vi.spyOn(b.w.rollout, "enter").mockResolvedValue(ok);
    vi.spyOn(b.w.rollout, "accept").mockResolvedValue(ok);
    vi.spyOn(b.w.rollout, "rollback").mockResolvedValue();
    vi.spyOn(b.w.rollout, "reinstall").mockResolvedValue();
    vi.spyOn(b.w.rollout, "cancelInstall").mockResolvedValue();
    vi.spyOn(b.w.rollout, "setEnabled").mockResolvedValue();
    const version = { iteration: 1, headSha: "h1", dirty: false, contextSha: "c", techSha: "t", tzSha: "z" };
    const pressed = async (method: string, input: Record<string, unknown>) => {
      b.store.startPilot(id, "", `op-${method}`, Date.now());
      await rpc(b, method, input);
      return /the owner pressed «(.+?)»/.exec(b.store.pilot(id)!.reason ?? "")?.[1];
    };
    const handOver = (expectedStage: number) => ({ workId: id, expectedStage, expectedVersion: version, note: "", force: false });
    expect(await pressed("handOver", handOver(1))).toBe("Next");
    expect(await pressed("handOver", handOver(3))).toBe("Next");
    expect(await pressed("handOver", handOver(7))).toBe("Approve mockup");
    expect(await pressed("handOver", handOver(4))).toBe("To verification");
    expect(await pressed("reconfirm", { workId: id, expectedStage: 3, stage: 1, expectedVersion: version })).toBe("Reconfirm");
    expect(await pressed("review", { workId: id, expectedStage: 3 })).toBe("Send to review");
    expect(await pressed("stopReviews", { workId: id, expectedStage: 3 })).toBe("Stop reviewers");
    expect(await pressed("restartStage", { workId: id, expectedStage: 2 })).toBe("Restart stage");
    expect(await pressed("sendBack", { workId: id, expectedStage: 2, toStage: 1, reason: "x" })).toBe("Send back");
    expect(await pressed("enter", { workId: id, expectedVersion: version, force: false })).toBe("Roll out");
    expect(await pressed("accept", { workId: id, expectedVersion: version, attemptId: "att_1", force: false, note: "" })).toBe("Accept");
    expect(await pressed("rollback", { pluginId: "mail", reason: "broke" })).toBe("Roll back");
    expect(await pressed("reinstall", { pluginId: "mail" })).toBe("Install again");
    expect(await pressed("cancelInstall", { pluginId: "mail" })).toBe("Try to cancel install");
    expect(await pressed("setEnabled", { pluginId: "mail", on: false })).toBe("Disable");
    expect(await pressed("setEnabled", { pluginId: "mail", on: true })).toBe("Enable");
    // Cancel closes the autopilot right after the pause: the pause is in the journal.
    b.ports.idle(b.store.runs(id)[0]!.thread_id);
    b.store.startPilot(id, "", "op-cancel", Date.now());
    await rpc(b, "cancel", { workId: id, reason: "not needed" });
    expect(b.store.events(id).some((e) => e.text.includes("the owner pressed «Cancel work»"))).toBe(true);
    await b.harness.lifecycle.dispose();
  });

  it("enter and accept need the version from the screen", async () => {
    const b = await boot();
    await expect(rpc(b, "enter", { workId: "w", force: false })).rejects.toThrow();
    await expect(rpc(b, "accept", { workId: "w", expectedVersion: null, attemptId: "a", force: false, note: "" })).rejects.toThrow();
    await b.harness.lifecycle.dispose();
  });

  it("rollback, reinstall, cancelInstall and setEnabled reach Rollout, with its refusals as they are", async () => {
    const b = await boot();
    install(b, "mail");
    await b.w.catalog.sync();
    await expect(rpc(b, "rollback", { pluginId: "mail", reason: "broke" })).rejects.toThrow("no rollback point");
    await expect(rpc(b, "reinstall", { pluginId: "mail" })).rejects.toThrow("a retry is only possible when the install outcome is unknown");
    await expect(rpc(b, "cancelInstall", { pluginId: "mail" })).rejects.toThrow("no install is running — nothing to cancel");
    await expect(rpc(b, "rollback", { pluginId: "mail", reason: "" })).rejects.toThrow();
    await expect(rpc(b, "rollback", { pluginId: "mail", reason: "я".repeat(2001) })).rejects.toThrow();
    expect(await rpc(b, "setEnabled", { pluginId: "mail", on: false })).toBeNull();
    expect(b.ports.count("disable")).toBe(1);
    expect(await rpc(b, "setEnabled", { pluginId: "mail", on: true })).toBeNull();
    expect(b.ports.count("enable")).toBe(1);
    await b.harness.lifecycle.dispose();
  });

  it("the work page: the engine's view with the availability, and the file reader", async () => {
    const b = await boot({ settings: TASKS });
    const id = await withWork(b);
    const view = (await rpc(b, "work", { workId: id })) as { work: { id: string; created: boolean }; availability: { disable: string | null }; attempt: unknown };
    expect(view.work).toMatchObject({ id, created: true });
    expect(view.availability.disable).toBeNull();
    expect(view.attempt).toBeNull();
    await expect(rpc(b, "file", { workId: id, path: "etc/passwd" })).rejects.toThrow("this file cannot be opened");
    await b.harness.lifecycle.dispose();
  });

  it("the plugin summary", async () => {
    const b = await boot();
    install(b, "mail", { dirtyCount: 2 });
    await b.w.catalog.sync();
    expect(await rpc(b, "plugin", { pluginId: "mail" })).toMatchObject({ id: "mail", dirtyCount: 2, bbState: "running", column: "live" });
    await expect(rpc(b, "plugin", { pluginId: "nobody" })).rejects.toThrow("plugin nobody is not on the board");
    await b.harness.lifecycle.dispose();
  });
});

describe("RPC callers", () => {
  const OTHER = { experimental_caller: { kind: "plugin" as const, pluginId: "other-plugin" } };
  const asPlugin = (b: Boot, method: string, input: unknown) => b.harness.callRpc(method, input, OTHER);

  it("only reads are open to other plugins; every other method is changing and refuses them", async () => {
    const b = await boot();
    expect([...READ_ONLY_RPC].sort()).toEqual(["board", "file", "models", "plugin", "work"]);
    for (const m of READ_ONLY_RPC) expect(Object.keys(workshopContract), m).toContain(m);
    await b.harness.lifecycle.dispose();
  });

  it("another plugin cannot press the owner's buttons; reads work for it; the panel, the CLI and agents (clients) are not refused", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    await b.w.catalog.sync();
    const workId = ((await rpc(b, "rework", { pluginId: "mail", request: "add a command" })) as { workId: string }).workId;
    await expect(asPlugin(b, "setEnabled", { pluginId: "mail", on: false })).rejects.toThrow("plugin other-plugin may not call setEnabled");
    await expect(asPlugin(b, "newPlugin", { name: "Hello", id: "hello", request: "x" })).rejects.toThrow("may not call newPlugin");
    await expect(asPlugin(b, "rework", { pluginId: "mail", request: "x" })).rejects.toThrow("may not call rework");
    await expect(asPlugin(b, "pilotStart", { workId, notes: "" })).rejects.toThrow("may not call pilotStart");
    await expect(asPlugin(b, "cancel", { workId, reason: "no" })).rejects.toThrow("may not call cancel");
    expect(b.store.pilot(workId)).toBeFalsy();
    expect(b.store.work(workId)!.outcome).toBeNull();
    expect((await b.ports.plugins.list()).find((p) => p.id === "mail")!.enabled).not.toBe(false);
    expect(((await asPlugin(b, "board", null)) as { plugins: unknown[] }).plugins.length).toBeGreaterThan(0);
    expect(await asPlugin(b, "work", { workId })).toMatchObject({ work: { id: workId } });
    // A client — the panel, the bb CLI, an agent's `bb plugin rpc call` — is the owner as far as the plugin can tell.
    await rpc(b, "pilotStart", { workId, notes: "" });
    expect(b.store.pilot(workId)!.state).toBe("on");
    await b.harness.lifecycle.dispose();
  });
});

describe("path settings", () => {
  it("a path setting that is not absolute, normalized and plain is ignored for the default; the reason goes to the log and the plugin status", async () => {
    const lock = BUILD_LOCK;
    const b = await boot({ settings: { pluginsRoot: "plugins", buildLock: "-w0 /tmp/x" } });
    expect(PLUGINS_ROOT).toBe(join(homedir(), "plugins"));
    expect(BUILD_LOCK).toBe(lock);
    const status = b.harness.needsConfigurationMessages.join("\n");
    expect(status).toContain("setting pluginsRoot «plugins» is ignored: not an absolute path");
    expect(status).toContain("setting buildLock «-w0 /tmp/x» is ignored: not an absolute path");
    expect(b.harness.logEntries.filter((e) => e.level === "warn" && e.message.includes("is ignored"))).toHaveLength(2);
    await b.harness.lifecycle.dispose();
  });

  it("a valid path is used without the trailing slash and raises nothing", async () => {
    try {
      const b = await boot({ settings: { pluginsRoot: "/srv/bb-plugins/" } });
      expect(PLUGINS_ROOT).toBe("/srv/bb-plugins");
      expect(b.harness.needsConfigurationMessages).toEqual([]);
      await b.harness.lifecycle.dispose();
    } finally {
      setPluginsRoot(join(homedir(), "plugins"));
    }
  });
});

describe("card and bb: reconciling a single plugin", () => {
  it("after «Disable» and «Enable» the card shows the new column and state at once", async () => {
    const b = await boot();
    install(b, "mail");
    await b.w.catalog.sync();
    expect(await card(b, "mail")).toMatchObject({ column: "live", bbState: "running" });
    await rpc(b, "setEnabled", { pluginId: "mail", on: false });
    expect(await card(b, "mail")).toMatchObject({ column: "off", bbState: "disabled", stateStale: false });
    await rpc(b, "setEnabled", { pluginId: "mail", on: true });
    expect(await card(b, "mail")).toMatchObject({ column: "live", bbState: "running" });
    await b.harness.lifecycle.dispose();
  });

  it("a refused action reads the plugin again too", async () => {
    const b = await boot();
    install(b, "mail");
    await b.w.catalog.sync();
    b.ports.plugins.items.get("mail")!.state = "degraded";
    await expect(rpc(b, "rollback", { pluginId: "mail", reason: "broke" })).rejects.toThrow("no rollback point");
    expect(await card(b, "mail")).toMatchObject({ bbState: "degraded" });
    await b.harness.lifecycle.dispose();
  });

  it("the sync does not walk all the plugins: one list request per action and no folder listing", async () => {
    const b = await boot();
    install(b, "mail");
    install(b, "notes");
    await b.w.catalog.sync();
    const folders = vi.spyOn(b.ports.plugins, "folders");
    await rpc(b, "setEnabled", { pluginId: "mail", on: false });
    expect(folders).not.toHaveBeenCalled();
    await b.harness.lifecycle.dispose();
  });

  it("a change of a work re-reads the state of its plugin from bb, then tells the interface", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "mail", request: "x" })) as { workId: string };
    await vi.waitFor(() => expect(b.harness.realtimeSignals.length).toBeGreaterThan(0));
    const before = b.harness.realtimeSignals.length;
    b.ports.plugins.items.get("mail")!.state = "degraded";
    b.ports.changed(workId);
    await vi.waitFor(() => expect(b.harness.realtimeSignals.length).toBeGreaterThan(before));
    expect(await card(b, "mail")).toMatchObject({ bbState: "degraded" });
    await b.harness.lifecycle.dispose();
  });

  it("after a failed installation the card shows the state bb reports, not the old one", async () => {
    const b = await boot({ settings: TASKS });
    const s = await atVerify(b);
    expect(await rpc(b, "enter", { workId: s.id, expectedVersion: await versionOf(s), force: false })).toMatchObject({ ok: true });
    expect(await card(b, "mail")).toMatchObject({ bbState: "running" });
    b.ports.plugins.setJob("job_1", "succeeded");
    b.ports.plugins.items.get("mail")!.state = "error";
    await b.w.tick();
    expect(b.store.currentAttempt("mail")).toMatchObject({ status: "failed" });
    await vi.waitFor(async () => expect(await card(b, "mail")).toMatchObject({ bbState: "error", stateStale: false }));
    await b.harness.lifecycle.dispose();
  });

  it("after a successful entry the card shows the state from the list", async () => {
    const b = await boot({ settings: TASKS });
    const s = await atVerify(b);
    expect(await rpc(b, "enter", { workId: s.id, expectedVersion: await versionOf(s), force: false })).toMatchObject({ ok: true });
    b.ports.plugins.setJob("job_1", "succeeded");
    b.ports.plugins.items.get("mail")!.state = "needs-configuration";
    await b.w.tick();
    expect(b.store.currentAttempt("mail")).toMatchObject({ status: "done" });
    await vi.waitFor(async () => expect(await card(b, "mail")).toMatchObject({ bbState: "needs-configuration", column: "live" }));
    await b.harness.lifecycle.dispose();
  });

  it("«Roll out» itself reads the plugin after its steps, and so does «Accept»", async () => {
    const b = await boot({ settings: TASKS });
    const s = await atVerify(b);
    const refresh = vi.spyOn(b.w.catalog, "refreshPlugin");
    // Without attempt steps (the gate refused) there are no `changed` signals — reconciling the plugin is up to the call itself.
    const enter = vi.spyOn(b.w.rollout, "enter").mockResolvedValue({ ok: false, blockers: ["no report"], warnings: [] });
    await rpc(b, "enter", { workId: s.id, expectedVersion: await versionOf(s), force: false });
    expect(enter).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith("mail");
    refresh.mockClear();
    const accept = vi.spyOn(b.w.rollout, "accept").mockRejectedValue(new Error("not allowed"));
    await expect(rpc(b, "accept", { workId: s.id, expectedVersion: await versionOf(s), attemptId: "a", force: false, note: "" })).rejects.toThrow("not allowed");
    expect(accept).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith("mail");
    await b.harness.lifecycle.dispose();
  });
});

describe("attempts without the minute pause", () => {
  it("an entry with an install of about a second passes in one tick", async () => {
    const b = await boot({ settings: TASKS });
    const s = await atVerify(b);
    // The rollout hit the build lock (held by another build) and waits for the reconcile.
    b.ports.lock.occupy(true);
    expect(await rpc(b, "enter", { workId: s.id, expectedVersion: await versionOf(s), force: false })).toMatchObject({ ok: true });
    expect(b.store.currentAttempt("mail")).toMatchObject({ step: "locking", status: "running" });
    b.ports.lock.occupy(false);
    const start = b.ports.plugins.startInstall.bind(b.ports.plugins);
    b.ports.plugins.startInstall = async (dir) => {
      const id = await start(dir);
      b.ports.after(1_000, () => b.ports.plugins.setJob(id, "succeeded"));
      return id;
    };
    await b.w.tick();
    expect(b.store.currentAttempt("mail")).toMatchObject({ status: "done", job_state: "succeeded" });
    expect(b.store.work(s.id)!.stage).toBe(6);
    await b.harness.lifecycle.dispose();
  });

  it("install-job and plugin-list events drive the attempts at once; other events do not", async () => {
    const b = await boot();
    const tick = vi.spyOn(b.w, "tick");
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    const advance = vi.spyOn(b.w.rollout, "advanceAll");
    const fire = (changes: unknown) => b.subscriptions[0]!.callback({ entity: "system", type: "changed", changes });
    fire(["ui-preferences-changed"]);
    fire(["plugin-update-jobs-changed"]);
    await new Promise((r) => setTimeout(r, 50));
    expect(advance).not.toHaveBeenCalled();
    fire(["plugin-install-jobs-changed"]);
    await vi.waitFor(() => expect(advance).toHaveBeenCalledTimes(1));
    fire(["plugins-changed"]);
    await vi.waitFor(() => expect(advance).toHaveBeenCalledTimes(2));
    run.controller.abort();
    await run.done;
    await b.harness.lifecycle.dispose();
  });
});

describe("stopping while an attempt polls", () => {
  /** A real wait, like `sdkPorts.sleep`: fake time does not run, and a poll without the stop signal would wait the full 10 s. */
  function realSleep(b: Boot) {
    const started = vi.fn();
    b.ports.sleep = async (ms: number, signal?: AbortSignal) => {
      started();
      await delay(ms, undefined, { signal }).catch(() => undefined);
    };
    return started;
  }

  it("stopping the service while an attempt polls ends the service in under a second; the attempt stays on its step and the next start finishes it", { timeout: 30_000 }, async () => {
    const b = await boot({ settings: TASKS });
    const s = await atVerify(b);
    b.ports.lock.occupy(true);
    expect(await rpc(b, "enter", { workId: s.id, expectedVersion: await versionOf(s), force: false })).toMatchObject({ ok: true });
    expect(b.store.currentAttempt("mail")).toMatchObject({ step: "locking", status: "running" });
    const fake = b.ports.sleep.bind(b.ports);
    const polling = realSleep(b);
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(polling).toHaveBeenCalled(), { timeout: 3_000 });
    const t0 = Date.now();
    run.controller.abort();
    await run.done;
    expect(Date.now() - t0).toBeLessThan(1_000);
    // A stop is not a step failure: the attempt stays on its step, and there is no "step interrupted" warning.
    expect(b.store.currentAttempt("mail")).toMatchObject({ step: "locking", status: "running" });
    expect(b.store.events(s.id).some((e) => e.text.includes("interrupted"))).toBe(false);
    // The next service start finishes the attempt.
    b.ports.sleep = fake;
    b.ports.lock.occupy(false);
    const again = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(b.store.currentAttempt("mail")).toMatchObject({ step: "installed", job_id: "job_1" }), { timeout: 3_000 });
    again.controller.abort();
    await again.done;
    await b.harness.lifecycle.dispose();
  });

  it("reloading the plugin while a panel call polls: the old call settles in under a second, no step failure is written, the new instance finishes the attempt", { timeout: 30_000 }, async () => {
    const b = await boot({ settings: TASKS });
    const s = await atVerify(b);
    b.ports.lock.occupy(true);
    const fake = b.ports.sleep.bind(b.ports);
    const polling = realSleep(b);
    // The old instance's database closes under it: the call may also end in a refusal — what matters is that it ends at once, with no step failure recorded.
    const entered = rpc(b, "enter", { workId: s.id, expectedVersion: await versionOf(s), force: false }).then(() => "answer", () => "refusal");
    await vi.waitFor(() => expect(polling).toHaveBeenCalled(), { timeout: 3_000 });
    expect(b.store.currentAttempt("mail")).toMatchObject({ step: "locking", status: "running" });
    let next!: Wiring;
    const t0 = Date.now();
    const host = await b.harness.lifecycle.reload(async (bb) => {
      next = await wire(bb, { ports: () => b.ports, lockDirs: b.lockDirs, debounceMs: 20, minGapMs: 0 });
    });
    await entered;
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(next.store.currentAttempt("mail")).toMatchObject({ step: "locking", status: "running" });
    expect(next.store.events(s.id).some((e) => e.text.includes("interrupted"))).toBe(false);
    b.ports.sleep = fake;
    b.ports.lock.occupy(false);
    await next.tick();
    expect(next.store.currentAttempt("mail")).toMatchObject({ step: "installed", job_id: "job_1" });
    await host.harness.lifecycle.dispose();
  });
});

describe("system:changed events", () => {
  it("only plugins and install/update jobs trigger a catalog sync", async () => {
    const b = await boot();
    const tick = vi.spyOn(b.w, "tick");
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    const sync = vi.spyOn(b.w.catalog, "sync");
    const fire = (changes: unknown) => b.subscriptions[0]!.callback({ entity: "system", type: "changed", changes });
    for (const changes of [["ui-preferences-changed"], ["config-changed", "app-update-changed"], ["provider-registrations-changed", "server-move-changed"], ["environment-availability-changed"], []]) fire(changes);
    fire(undefined);
    b.subscriptions[0]!.callback(undefined);
    b.subscriptions[0]!.callback();
    await new Promise((r) => setTimeout(r, 150));
    expect(sync).not.toHaveBeenCalled();
    let n = 0;
    for (const relevant of ["plugins-changed", "plugin-install-jobs-changed", "plugin-update-jobs-changed"]) {
      fire(["ui-preferences-changed", relevant]);
      n++;
      await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(n));
      await new Promise((r) => setTimeout(r, 40));
    }
    run.controller.abort();
    await run.done;
    await b.harness.lifecycle.dispose();
  });
});

describe("identifier length in the contract", () => {
  const long = "x".repeat(101);
  const ok = "x".repeat(100);
  const version = { iteration: 1, headSha: "h", dirty: false, contextSha: null, techSha: null, tzSha: null };
  it("workId, pluginId and attemptId are limited to 100 characters", async () => {
    const b = await boot({ settings: TASKS });
    const calls: Array<[string, (id: string) => unknown]> = [
      ["work", (id) => ({ workId: id })],
      ["file", (id) => ({ workId: id, path: "a" })],
      ["plugin", (id) => ({ pluginId: id })],
      ["rework", (id) => ({ pluginId: id, request: "x" })],
      ["restartStage", (id) => ({ workId: id, expectedStage: 1 })],
      ["review", (id) => ({ workId: id, expectedStage: 1 })],
      ["stopReviews", (id) => ({ workId: id, expectedStage: 1 })],
      ["handOver", (id) => ({ workId: id, expectedStage: 1, expectedVersion: null, note: "", force: false })],
      ["sendBack", (id) => ({ workId: id, expectedStage: 2, toStage: 1, reason: "x" })],
      ["cancel", (id) => ({ workId: id, reason: "" })],
      ["enter", (id) => ({ workId: id, expectedVersion: version, force: false })],
      ["accept", (id) => ({ workId: id, expectedVersion: version, attemptId: "a", force: false, note: "" })],
      ["accept", (id) => ({ workId: "w", expectedVersion: version, attemptId: id, force: false, note: "" })],
      ["rollback", (id) => ({ pluginId: id, reason: "x" })],
      ["reinstall", (id) => ({ pluginId: id })],
      ["cancelInstall", (id) => ({ pluginId: id })],
      ["setEnabled", (id) => ({ pluginId: id, on: false })],
    ];
    for (const [method, input] of calls) {
      const tooLong = (await rpc(b, method, input(long)).catch((e: Error) => e)) as Error;
      expect(tooLong, method).toBeInstanceOf(Error);
      expect(tooLong.message, method).not.toMatch(/not found|not on the board/);
      const fits = await rpc(b, method, input(ok)).catch((e: Error) => e);
      // With an allowed length the call reaches the code and is refused on the merits, not on the form.
      expect(String((fits as Error)?.message ?? ""), method).toMatch(/not found|not on the board|no rollback point|a retry is only possible|no install is running|not installed|list/);
    }
    await b.harness.lifecycle.dispose();
  });
});

describe("board", () => {
  it("columns and cards; git is not read on every request", async () => {
    const b = await boot();
    install(b, "mail");
    install(b, "notes");
    await b.w.catalog.sync();
    const git = vi.spyOn(b.ports.git, "facts");
    const out = (await rpc(b, "board")) as { columns: Array<{ key: string }>; plugins: Array<{ id: string }> };
    await rpc(b, "board");
    expect(out.columns.map((c) => c.key)).toEqual(["context", "tech", "tz", "mockup", "build", "live", "off"]);
    expect(out.plugins.map((p) => p.id)).toEqual(["mail", "notes"]);
    expect(git).not.toHaveBeenCalled();
    await b.harness.lifecycle.dispose();
  });

  it("a change of a work refreshes the git facts of its plugin first, then tells the interface", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "mail", request: "x" })) as { workId: string };
    await vi.waitFor(() => expect(b.harness.realtimeSignals.length).toBeGreaterThan(0));
    const before = b.harness.realtimeSignals.length;
    b.ports.git.setRepo(pluginDir("mail"), { dirtyCount: 5 });
    b.ports.changed(workId);
    await vi.waitFor(() => expect(b.harness.realtimeSignals.length).toBeGreaterThan(before));
    expect(b.harness.realtimeSignals.at(-1)).toEqual({ channel: SELF_ID, payload: { workId, pluginId: "mail" } });
    const card = ((await rpc(b, "board")) as { plugins: Array<{ id: string; availability: unknown; labels: string[] }> }).plugins.find((p) => p.id === "mail")!;
    expect(card).toBeDefined();
    // The board sees the new git facts without a new read: changes in the copy now close «Rework» for other works.
    const facts = await b.w.catalog.cachedFacts();
    expect(facts.find((f) => f.row.id === "mail")!.git!.dirtyCount).toBe(5);
    await b.harness.lifecycle.dispose();
  });

  it("actions on a plugin without a work refresh its facts and signal the interface too", async () => {
    const b = await boot();
    install(b, "mail");
    await b.w.catalog.sync();
    const before = b.harness.realtimeSignals.length;
    await rpc(b, "setEnabled", { pluginId: "mail", on: false });
    expect(b.harness.realtimeSignals.length).toBeGreaterThan(before);
    expect(b.harness.realtimeSignals.at(-1)).toEqual({ channel: SELF_ID, payload: { workId: null, pluginId: "mail" } });
    await b.harness.lifecycle.dispose();
  });
});

describe("reconcile", () => {
  it("one tick runs the three reconciliations; one failing does not stop the others", async () => {
    const b = await boot();
    const spies = {
      engine: vi.spyOn(b.w.engine, "reconcileAll").mockRejectedValue(new Error("engine crashed")),
      creation: vi.spyOn(b.w.creation, "advanceAll").mockResolvedValue(),
      rollout: vi.spyOn(b.w.rollout, "advanceAll").mockRejectedValue(new Error("rollout crashed")),
    };
    await b.w.tick();
    expect([spies.engine, spies.creation, spies.rollout].map((s) => s.mock.calls.length)).toEqual([1, 1, 1]);
    const warns = b.harness.logEntries.filter((e) => e.level === "warn").map((e) => e.message);
    expect(warns.some((m) => m.includes("engine crashed"))).toBe(true);
    expect(warns.some((m) => m.includes("rollout crashed"))).toBe(true);
    await b.harness.lifecycle.dispose();
  });

  it("a hung scaffold does not hold up the attempts in the same tick, and no second creation pass starts while it runs", async () => {
    const b = await boot({ settings: TASKS });
    const s = await atVerify(b);
    // The «mail» rollout waits for the build lock.
    b.ports.lock.occupy(true);
    expect(await rpc(b, "enter", { workId: s.id, expectedVersion: await versionOf(s), force: false })).toMatchObject({ ok: true });
    expect(b.store.currentAttempt("mail")).toMatchObject({ step: "locking" });
    b.ports.lock.occupy(false);
    // The new plugin's scaffold hangs: `flock -w 900` waits for the build lock up to 15 minutes.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const scaffold = b.ports.fs.scaffold.bind(b.ports.fs);
    const hung = vi.spyOn(b.ports.fs, "scaffold").mockImplementation(async (id, tmp) => {
      await gate;
      await scaffold(id, tmp);
    });
    const created = rpc(b, "newPlugin", { name: "Hello", id: "hello", request: "x" }) as Promise<{ workId: string; error: string | null }>;
    await vi.waitFor(() => expect(hung).toHaveBeenCalledTimes(1));
    const creationAll = vi.spyOn(b.w.creation, "advanceAll");
    const first = await Promise.race([b.w.tick().then(() => "tick"), new Promise((r) => setTimeout(() => r("hung"), 1_000))]);
    expect(first).toBe("tick");
    // The rollout attempt moved on in the same tick: the lock is taken, the install started.
    expect(b.store.currentAttempt("mail")).toMatchObject({ step: "installed", job_id: "job_1" });
    await b.w.tick();
    expect(creationAll).toHaveBeenCalledTimes(1);
    release();
    const { workId, error } = await created;
    expect(error).toBeNull();
    await vi.waitFor(() => expect(b.store.work(workId)!.created).toBe(1));
    // The previous pass ended — the next tick starts a new one.
    await vi.waitFor(async () => {
      await b.w.tick();
      expect(creationAll).toHaveBeenCalledTimes(2);
    });
    expect(hung).toHaveBeenCalledTimes(1);
    await b.harness.lifecycle.dispose();
  });

  it("a tick finishes a creation that was interrupted, and reconciles the work", async () => {
    const b = await boot({ settings: TASKS });
    b.ports.failAt("scaffold", "before");
    const { workId } = (await rpc(b, "newPlugin", { name: "Hello", id: "hello", request: "x" })) as { workId: string };
    expect(b.store.work(workId)!.created).toBe(0);
    b.ports.failAt(null);
    b.ports.t += 5 * 60_000; // the scaffold is retried after five minutes at the earliest
    await b.w.tick();
    // The tick does not wait for creation (the scaffold may wait for the build lock): it completes on its own.
    await vi.waitFor(() => expect(b.store.work(workId)).toMatchObject({ created: 1 }));
    expect(b.store.runs(workId)).toHaveLength(1);
    await b.harness.lifecycle.dispose();
  });

  it("a tick continues an attempt that waits for the lock", async () => {
    const b = await boot();
    install(b, "mail");
    await b.w.catalog.sync();
    b.store.addAttempt({ id: "att_1", plugin_id: "mail", work_id: null, kind: "enter", before_sha: "a", target_sha: "a", migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1, started_at: 1 });
    const advance = vi.spyOn(b.w.rollout, "advance");
    await b.w.tick();
    expect(advance).toHaveBeenCalledWith("att_1");
    await b.harness.lifecycle.dispose();
  });

  it("thread events speed up the reconcile of that thread's work, and only of known threads", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "mail", request: "x" })) as { workId: string };
    const thread = b.store.runs(workId)[0]!.thread_id;
    const reconcile = vi.spyOn(b.w.engine, "reconcile");
    for (const ev of ["thread.idle", "thread.failed", "thread.active"] as const) {
      await b.harness.emitThreadEvent(ev, { thread: makeThreadResponse({ id: thread }) } as never);
    }
    expect(reconcile.mock.calls.map((c) => c[0])).toEqual([workId, workId, workId]);
    await b.harness.emitThreadEvent("thread.idle", { thread: makeThreadResponse({ id: "thr_stranger" }) } as never);
    expect(reconcile).toHaveBeenCalledTimes(3);
    await b.harness.lifecycle.dispose();
  });

  it("the service syncs the catalog first, subscribes to system:changed, and goes on to the minute ticks", async () => {
    const b = await boot();
    install(b, "mail");
    const tick = vi.spyOn(b.w, "tick");
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    expect(b.subscriptions).toHaveLength(1);
    expect(b.subscriptions[0]!.event).toBe("system:changed");
    expect(b.store.plugin("mail")).not.toBeNull();
    run.controller.abort();
    await run.done;
    expect(b.unsubscribe).toHaveBeenCalledTimes(1);
    await b.harness.lifecycle.dispose();
    expect(b.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("system:changed re-syncs the catalog; a burst collapses into few passes", async () => {
    const b = await boot();
    install(b, "mail");
    const tick = vi.spyOn(b.w, "tick");
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    install(b, "notes");
    const sync = vi.spyOn(b.w.catalog, "sync");
    for (let i = 0; i < 5; i++) b.subscriptions[0]!.callback(SYSTEM_PLUGINS);
    await vi.waitFor(() => expect(b.store.plugin("notes")).not.toBeNull());
    expect(sync.mock.calls.length).toBeLessThanOrEqual(2);
    run.controller.abort();
    await run.done;
    await b.harness.lifecycle.dispose();
  });

  it("events do not trigger a sync more often than the minimal gap", async () => {
    const b = await boot({ minGapMs: 60_000 });
    const tick = vi.spyOn(b.w, "tick");
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    const sync = vi.spyOn(b.w.catalog, "sync");
    for (let i = 0; i < 3; i++) b.subscriptions[0]!.callback(SYSTEM_PLUGINS);
    await new Promise((r) => setTimeout(r, 120));
    expect(sync).not.toHaveBeenCalled();
    run.controller.abort();
    await run.done;
    await b.harness.lifecycle.dispose();
  });

  it("a failed catalog sync at start is logged and does not stop the service", async () => {
    const b = await boot();
    vi.spyOn(b.w.catalog, "sync").mockRejectedValue(new Error("the list did not arrive"));
    const tick = vi.spyOn(b.w, "tick");
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    expect(b.harness.logEntries.some((e) => e.level === "warn" && e.message.includes("the list did not arrive"))).toBe(true);
    run.controller.abort();
    await run.done;
    await b.harness.lifecycle.dispose();
  });

  it("dispose unsubscribes even if the service did not get to stop on its own", async () => {
    const b = await boot();
    const tick = vi.spyOn(b.w, "tick");
    const run = b.harness.runService("reconcile");
    await vi.waitFor(() => expect(tick).toHaveBeenCalled());
    await b.harness.lifecycle.dispose();
    await run.done;
    expect(b.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("CLI «bb plugin-workshop»", () => {
  it("list: column, id, state in bb, work", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    install(b, "notes");
    b.ports.plugins.add({ id: "tags", enabled: false, state: "disabled" });
    b.ports.git.setRepo(pluginDir("tags"), {});
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "mail", request: "x" })) as { workId: string };
    const key = b.store.work(workId)!.task_key!;
    const out = await b.harness.behavior.runCli(["list"]);
    expect(out.exitCode).toBe(0);
    const lines = out.stdout.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(new RegExp(`^${column("context")}\\s+mail\\s+running\\s+`));
    expect(lines[0]).toContain(key);
    expect(lines[1]).toMatch(new RegExp(`^${column("live")}\\s+notes\\s+running\\s+—$`));
    expect(lines[2]).toMatch(new RegExp(`^${column("off")}\\s+tags\\s+disabled\\s+—$`));
    await b.harness.lifecycle.dispose();
  });

  it("list --json is the board", async () => {
    const b = await boot();
    install(b, "mail");
    await b.w.catalog.sync();
    const out = await b.harness.behavior.runCli(["list", "--json"]);
    expect(JSON.parse(out.stdout)).toEqual(await rpc(b, "board"));
    await b.harness.lifecycle.dispose();
  });

  it("an empty board says so", async () => {
    const b = await boot();
    const out = await b.harness.behavior.runCli(["list"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("no plugins");
    await b.harness.lifecycle.dispose();
  });

  it("show by plugin id: the summary; by task key or work id: the work", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "mail", request: "x" })) as { workId: string };
    const key = b.store.work(workId)!.task_key!;
    const plugin = await b.harness.behavior.runCli(["show", "mail"]);
    expect(plugin.exitCode).toBe(0);
    expect(plugin.stdout).toContain("mail");
    expect(plugin.stdout).toContain(stageOf(1).title);
    expect(plugin.stdout).toContain(key);
    for (const ref of [key, key.toLowerCase(), workId]) {
      const work = await b.harness.behavior.runCli(["show", ref]);
      expect(work.exitCode, ref).toBe(0);
      expect(work.stdout, ref).toContain(`${key} «Rework of plugin «mail»»`);
      expect(work.stdout).toContain(`1. ${stageOf(1).title}`);
    }
    const json = await b.harness.behavior.runCli(["show", key, "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({ work: { id: workId } });
    const pj = await b.harness.behavior.runCli(["show", "mail", "--json"]);
    expect(JSON.parse(pj.stdout)).toMatchObject({ id: "mail" });
    await b.harness.lifecycle.dispose();
  });

  it("the error of an attempt is cut to 500 characters in the text output (the JSON keeps all of it)", async () => {
    const b = await boot({ settings: TASKS });
    install(b, "mail");
    await b.w.catalog.sync();
    const { workId } = (await rpc(b, "rework", { pluginId: "mail", request: "x" })) as { workId: string };
    b.store.addAttempt({ id: "att_big", plugin_id: "mail", work_id: workId, kind: "enter", before_sha: "a", target_sha: "b", migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1, started_at: 1 });
    b.store.closeAttempt("att_big", "failed", "я".repeat(2000), 2);
    for (const ref of ["mail", workId]) {
      const out = await b.harness.behavior.runCli(["show", ref]);
      expect(out.stdout, ref).toContain("я".repeat(500));
      expect(out.stdout, ref).not.toContain("я".repeat(501));
    }
    const json = await b.harness.behavior.runCli(["show", "mail", "--json"]);
    expect(JSON.parse(json.stdout).attempt.error).toHaveLength(2000);
    await b.harness.lifecycle.dispose();
  });

  it("show of something unknown, or without an argument, is a refusal", async () => {
    const b = await boot();
    expect((await b.harness.behavior.runCli(["show", "nobody"])).exitCode).toBe(1);
    expect((await b.harness.behavior.runCli(["show"])).exitCode).toBe(1);
    await b.harness.lifecycle.dispose();
  });

  it("show of a work that is still being created works", async () => {
    const b = await boot({ settings: TASKS });
    b.ports.failAt("scaffold", "before");
    const { workId } = (await rpc(b, "newPlugin", { name: "Hello", id: "hello", request: "x" })) as { workId: string };
    const out = await b.harness.behavior.runCli(["show", workId]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("being created");
    expect(out.stdout).toContain("scaffold");
    await b.harness.lifecycle.dispose();
  });
});
