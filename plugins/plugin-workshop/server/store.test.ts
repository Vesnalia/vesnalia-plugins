import { describe, expect, it } from "vitest";
import type { NewWork, Store } from "./store";
import { memoryStore } from "./test-utils";

const work = (id: string, o: Partial<NewWork> = {}): NewWork => ({
  id, plugin_id: `plug_${id}`, kind: "rework", tasks_project_id: "tp1", host_id: "h1", title: "T", request: "R", created_at: 1, ...o,
});
/** A work with finished creation steps: it has a task and a project, created = 1. */
function made(s: Store, id: string, o: Partial<NewWork> = {}) {
  s.addWork(work(id, o));
  s.setTask(id, { id: `t_${id}`, key: `TEST-${id}` }, 1);
  s.setProject(id, "p1", 1);
  s.markCreated(id, 1);
}
const version = { iteration: 1, headSha: "a", dirty: false, contextSha: "s", techSha: null, tzSha: null };

const seen = (s: Store, id: string, now = 1) => s.upsertSeen({ id, name: id.toUpperCase(), dir: `/srv/plugins/alia-plugin-${id}`, source: `path:/srv/plugins/alia-plugin-${id}` }, now);
const attemptOf = (id: string, plugin: string, o: Partial<Parameters<Store["addAttempt"]>[0]> = {}): Parameters<Store["addAttempt"]>[0] => ({
  id, plugin_id: plugin, work_id: null, kind: "enter", before_sha: "a", target_sha: "b", migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1, started_at: 10, ...o,
});

describe("Store: works", () => {
  it("moves the stage only from the expected one, inside one transaction with its handover and entry", () => {
    const s = memoryStore();
    made(s, "1");
    const moved = s.tx(() => {
      if (!s.casStage("1", 1, 2, 1, 2)) return false;
      s.addHandover({ work_id: "1", stage: 1, action: "forward", to_stage: 2, version: null, note: "", forced: false, problems: [], at: 2 });
      s.setEntry("1", { key: "k", stage: 2, from: 1, packet: null, error: null }, 2);
      return true;
    });
    expect(moved).toBe(true);
    expect(s.casStage("1", 1, 2, 1, 3)).toBe(false);
    expect(s.entry(s.work("1")!)).toEqual({ key: "k", stage: 2, from: 1, packet: null, error: null });
    expect(() => s.tx(() => {
      s.casStage("1", 2, 3, 1, 4);
      throw new Error("boom");
    })).toThrow("boom");
    expect(s.work("1")!.stage).toBe(2);
    expect(() => s.addWork(work("1", { plugin_id: "other" }))).toThrow();
  });

  it("opens a work on the first stage, not yet created, with the new columns filled in", () => {
    const s = memoryStore();
    s.addWork(work("1", { plugin_id: "hello", kind: "new", host_id: "h9", tasks_project_id: "tpX" }));
    expect(s.work("1")).toMatchObject({
      plugin_id: "hello", kind: "new", created: 0, task_id: null, task_key: null, tasks_project_id: "tpX", project_id: null, host_id: "h9",
      stage: 1, iteration: 1, base_ahead: 0, queued: 0, outcome: null, created_at: 1, updated_at: 1,
    });
    expect(s.work("1")).not.toHaveProperty("spec_path");
    expect(s.work("1")).not.toHaveProperty("plan_path");
  });

  it("keeps one open work per plugin, and lets a new one in once the previous has finished", () => {
    const s = memoryStore();
    s.addWork(work("1", { plugin_id: "hello" }));
    expect(() => s.addWork(work("2", { plugin_id: "hello" }))).toThrow();
    s.addWork(work("3", { plugin_id: "mail" }));
    expect(s.openWorkOf("hello")?.id).toBe("1");
    expect(s.openWorkOf("nobody")).toBeNull();
    s.finish("1", "canceled", 2);
    expect(s.openWorkOf("hello")).toBeNull();
    s.addWork(work("2", { plugin_id: "hello", created_at: 3 }));
    expect(s.openWorkOf("hello")?.id).toBe("2");
    expect(s.pastWorks("hello").map((w) => w.id)).toEqual(["1"]);
    s.finish("2", "done", 4);
    expect(s.pastWorks("hello").map((w) => w.id)).toEqual(["2", "1"]);
    expect(s.pastWorks("mail")).toEqual([]);
  });

  it("keeps one open work per tracker task, while works without a task do not collide", () => {
    const s = memoryStore();
    s.addWork(work("1"));
    s.addWork(work("2", { created_at: 2 }));
    s.setTask("1", { id: "t_x", key: "TEST-1" }, 2);
    expect(() => s.setTask("2", { id: "t_x", key: "TEST-1" }, 2)).toThrow();
    expect(s.work("2")!.task_id).toBeNull();
    s.finish("1", "canceled", 3);
    s.setTask("2", { id: "t_x", key: "TEST-1" }, 4);
    expect(s.worksByTask("t_x").map((w) => w.id)).toEqual(["1", "2"]);
    expect(s.workByKey("TEST-1")?.id).toBe("2");
  });

  it("fills the task and the project once the creation steps get there", () => {
    const s = memoryStore();
    s.addWork(work("1"));
    s.setTask("1", { id: "t_1", key: "TEST-1" }, 5);
    s.setProject("1", "p7", 6);
    expect(s.work("1")).toMatchObject({ task_id: "t_1", task_key: "TEST-1", project_id: "p7", updated_at: 6 });
    s.setTask("1", { id: "t_1", key: "TEST-1" }, 7);
    expect(s.work("1")).toMatchObject({ task_id: "t_1", task_key: "TEST-1" });
  });

  it("separates works being created from created ones", () => {
    const s = memoryStore();
    s.addWork(work("1"));
    made(s, "2");
    s.addWork(work("3"));
    s.finish("3", "canceled", 2);
    expect(s.creatingWorks().map((w) => w.id)).toEqual(["1"]);
    expect(s.unsettledWorks().map((w) => w.id)).toEqual(["2"]);
    s.markCreated("1", 5);
    expect(s.work("1")).toMatchObject({ created: 1, updated_at: 5 });
    expect(s.creatingWorks()).toEqual([]);
    expect(s.unsettledWorks().map((w) => w.id)).toEqual(["1", "2"]);
    expect(s.openWorkOf("plug_3")).toBeNull();
  });

  it("does not hand a work being created to the reconcile, even finished with cleanup pending", () => {
    const s = memoryStore();
    s.addWork(work("1"));
    s.finish("1", "canceled", 2);
    expect(s.unsettledWorks()).toEqual([]);
    expect(s.creatingWorks()).toEqual([]);
  });

  it("notices a base branch that moved ahead only on a change", () => {
    const s = memoryStore();
    made(s, "1");
    expect(s.setBaseAhead("1", false, 2)).toBe(false);
    expect(s.setBaseAhead("1", true, 3)).toBe(true);
    expect(s.work("1")).toMatchObject({ base_ahead: 1, updated_at: 3 });
    expect(s.setBaseAhead("1", true, 4)).toBe(false);
    expect(s.setBaseAhead("1", false, 5)).toBe(true);
    expect(s.work("1")!.base_ahead).toBe(0);
  });

  it("counts building works per machine: stages 4 and 5, without queued and finished ones", () => {
    const s = memoryStore();
    for (const id of ["1", "2", "3", "4", "6", "7"]) made(s, id);
    made(s, "5", { host_id: "h2" });
    s.casStage("1", 1, 4, 1, 2);
    s.casStage("2", 1, 5, 1, 2);
    s.casStage("3", 1, 4, 1, 2);
    s.setQueued("3", true, 3);
    s.casStage("4", 1, 4, 1, 2);
    s.finish("4", "canceled", 4);
    s.casStage("5", 1, 4, 1, 2);
    s.casStage("6", 1, 3, 1, 2);
    s.casStage("7", 1, 6, 1, 2);
    expect(s.activeBuilding("h1", "x")).toBe(2);
    expect(s.activeBuilding("h1", "1")).toBe(1);
    expect(s.activeBuilding("h2", "x")).toBe(1);
    expect(s.activeBuilding("h3", "x")).toBe(0);
  });

  it("finishing sets the card state and leaves cleanup pending", () => {
    const s = memoryStore();
    made(s, "1");
    s.setState("1", "agent", "the agent is working", true, 2);
    expect(s.finish("1", "done", 3)).toBe(true);
    expect(s.work("1")).toMatchObject({ outcome: "done", stage: 1, state: "done", state_reason: "done", stale: 0, cleanup_done: 0, entry: null });
    expect(s.finish("1", "canceled", 4)).toBe(false);
    expect(s.unsettledWorks().map((w) => w.id)).toEqual(["1"]);
    s.setCleanupDone("1");
    s.setTaskSynced("1", "done");
    expect(s.unsettledWorks()).toEqual([]);
  });

  it("keeps runs, rounds and ops idempotent", () => {
    const s = memoryStore();
    made(s, "1");
    const run = { thread_id: "thr_1", work_id: "1", stage: 1, role: "stage" as const, who: "claude", round: 1, input_version: version, regulation_sha: "r", created_at: 5 };
    s.addRun(run);
    s.addRun(run);
    expect(s.runs("1")).toHaveLength(1);
    expect(s.runs("1")[0]).toMatchObject({ attached: 0, input_version: JSON.stringify(version) });
    s.markAttached("thr_1");
    expect(s.runs("1")[0]!.attached).toBe(1);
    expect(s.maxRound("1", 1, "stage")).toBe(1);
    expect(s.maxRound("1", 1, "review")).toBe(0);
    expect(s.stageThread("1", 1)?.thread_id).toBe("thr_1");
    s.beginOp("k", "1", "spawn", '{"round":1}', 10);
    s.beginOp("k", "1", "spawn", '{"round":1}', 20);
    expect(s.op("k")).toMatchObject({ status: "pending", created_at: 10, payload: '{"round":1}' });
    expect(s.pendingOps("1").map((o) => o.key)).toEqual(["k"]);
    s.finishOp("k", "thr_1", 30);
    expect(s.op("k")).toMatchObject({ status: "done", result: "thr_1" });
    s.beginOp("k", "1", "spawn", null, 35);
    s.failOp("k", "too late", 36);
    expect(s.op("k")).toMatchObject({ status: "done", result: "thr_1", error: null });
    expect(s.pendingOps("1")).toEqual([]);
    s.beginOp("f", "1", "spawn", null, 40);
    s.failOp("f", "no", 41);
    s.beginOp("f", "1", "spawn", null, 50);
    expect(s.op("f")).toMatchObject({ status: "pending", created_at: 50 });
  });

  it("stores handovers with versions and reports state changes once", () => {
    const s = memoryStore();
    made(s, "1");
    s.addHandover({ work_id: "1", stage: 1, action: "forward", to_stage: 2, version, note: "", forced: true, problems: ["x"], at: 5 });
    expect(s.handovers("1")[0]).toMatchObject({ forced: true, problems: ["x"], version: { headSha: "a" } });
    expect(s.setState("1", "owner", "waiting", false, 6)).toBe(true);
    expect(s.setState("1", "owner", "waiting", false, 7)).toBe(false);
  });

  it("folds a repeated journal line into the latest one instead of flooding the journal", () => {
    const s = memoryStore();
    made(s, "1");
    made(s, "2");
    s.log("1", "warn", "reconcile: failure", 10);
    s.log("1", "warn", "reconcile: failure", 20);
    expect(s.events("1")).toEqual([{ id: expect.any(Number), at: 20, kind: "warn", text: "reconcile: failure" }]);
    s.log("1", "warn", "something else", 30);
    s.log("1", "warn", "reconcile: failure", 40);
    s.log("1", "info", "reconcile: failure", 50);
    s.log("2", "info", "reconcile: failure", 60);
    expect(s.events("1").map((e) => [e.at, e.kind, e.text])).toEqual([
      [50, "info", "reconcile: failure"],
      [40, "warn", "reconcile: failure"],
      [30, "warn", "something else"],
      [20, "warn", "reconcile: failure"],
    ]);
    expect(s.events("2")).toHaveLength(1);
  });
});

describe("Store: plugins", () => {
  it("records a plugin once seen and keeps what the sync does not own", () => {
    const s = memoryStore();
    expect(s.plugin("hello")).toBeNull();
    seen(s, "hello", 10);
    expect(s.plugin("hello")).toEqual({
      id: "hello", name: "HELLO", dir: "/srv/plugins/alia-plugin-hello", source: "path:/srv/plugins/alia-plugin-hello", project_id: null,
      installed_sha: null, current_attempt: null, last_state: null, last_enabled: null, state_at: null, list_failed_at: null,
      first_seen: 10, last_seen: 10, gone_reason: null,
      gh_remote: null, gh_ahead: null, gh_behind: null, gh_checked_at: null, gh_error: null, gh_rolled: 0, hidden_at: null,
    });
    s.setPluginProject("hello", "p1");
    s.setInstalled("hello", "abc");
    s.setLastState("hello", { state: "running", enabled: true }, 15);
    s.upsertSeen({ id: "hello", name: "Hello 2", dir: null, source: "path:/elsewhere" }, 20);
    expect(s.plugin("hello")).toMatchObject({
      name: "Hello 2", dir: null, source: "path:/elsewhere", first_seen: 10, last_seen: 20,
      project_id: "p1", installed_sha: "abc", last_state: "running", last_enabled: 1, state_at: 15,
    });
  });

  it("lists plugins by id and forgets none of them", () => {
    const s = memoryStore();
    seen(s, "mail");
    seen(s, "docs");
    seen(s, "notes");
    expect(s.plugins().map((p) => p.id)).toEqual(["docs", "mail", "notes"]);
    s.markGone("notes", "no folder and no install", 5);
    expect(s.plugins().map((p) => p.id)).toEqual(["docs", "mail", "notes"]);
  });

  it("keeps the last confirmed state when the list did not come, and marks the failure", () => {
    const s = memoryStore();
    seen(s, "mail");
    s.setLastState("mail", { state: "running", enabled: true }, 10);
    expect(s.plugin("mail")).toMatchObject({ last_state: "running", last_enabled: 1, state_at: 10, list_failed_at: null });
    s.setLastState("mail", null, 20);
    expect(s.plugin("mail")).toMatchObject({ last_state: "running", last_enabled: 1, state_at: 10, list_failed_at: 20 });
    s.setLastState("mail", { state: "disabled", enabled: false }, 30);
    expect(s.plugin("mail")).toMatchObject({ last_state: "disabled", last_enabled: 0, state_at: 30, list_failed_at: null });
  });

  it("marks a vanished plugin with its reason, and takes it back once seen again", () => {
    const s = memoryStore();
    seen(s, "chat", 1);
    s.setLastState("chat", { state: "running", enabled: true }, 2);
    s.markGone("chat", "no folder and no install", 9);
    expect(s.plugin("chat")).toMatchObject({ gone_reason: "no folder and no install", last_state: null, last_enabled: null, state_at: 9, last_seen: 1 });
    seen(s, "chat", 12);
    expect(s.plugin("chat")).toMatchObject({ gone_reason: null, last_seen: 12, first_seen: 1 });
  });

  it("setNotInstalled drops the confirmed state and the failure mark, but not the plugin, its source or its installed commit", () => {
    const s = memoryStore();
    seen(s, "tags");
    s.setInstalled("tags", "abc");
    s.setLastState("tags", { state: "running", enabled: true }, 10);
    s.setLastState("tags", null, 15);
    s.setNotInstalled("tags", 20);
    expect(s.plugin("tags")).toMatchObject({ last_state: null, last_enabled: null, state_at: 20, list_failed_at: null, gone_reason: null, installed_sha: "abc", source: "path:/srv/plugins/alia-plugin-tags" });
  });
});

describe("Store: attempts", () => {
  it("records an attempt and makes it the plugin's current one in the same transaction", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.addAttempt(attemptOf("a1", "hello", { work_id: "w1", migrations: 1, was_installed: 0, was_enabled: 0 }));
    expect(s.plugin("hello")!.current_attempt).toBe("a1");
    expect(s.attempt("a1")).toEqual({
      id: "a1", plugin_id: "hello", work_id: "w1", kind: "enter", before_sha: "a", target_sha: "b", migrations: 1, was_installed: 0, was_enabled: 0, want_enabled: 1,
      step: "recorded", status: "running", known_job_ids: null, foreign_job_id: null, job_id: null, error: null, lock_token: null, lock_held: 0,
      started_at: 10, updated_at: 10, resolved_at: null, origin_id: null, note: null, job_state: null, from_sha: null,
    });
    expect(s.currentAttempt("hello")?.id).toBe("a1");
    expect(s.openAttemptOf("hello")?.id).toBe("a1");
    expect(s.openAttempts().map((a) => a.id)).toEqual(["a1"]);
    expect(s.attempt("nope")).toBeNull();
    expect(s.currentAttempt("nobody")).toBeNull();
  });

  it("allows one running attempt per plugin, and leaves the pointer alone when a second one is refused", () => {
    const s = memoryStore();
    seen(s, "hello");
    seen(s, "mail");
    s.addAttempt(attemptOf("a1", "hello"));
    expect(() => s.addAttempt(attemptOf("a2", "hello", { started_at: 11 }))).toThrow();
    expect(s.attempt("a2")).toBeNull();
    expect(s.plugin("hello")!.current_attempt).toBe("a1");
    s.addAttempt(attemptOf("a3", "mail"));
    expect(s.openAttempts().map((a) => a.id)).toEqual(["a1", "a3"]);
  });

  it("refuses an attempt for a plugin that is not on the board, leaving nothing behind", () => {
    const s = memoryStore();
    expect(() => s.addAttempt(attemptOf("a1", "ghost"))).toThrow();
    expect(s.attempt("a1")).toBeNull();
  });

  it("keeps a closed attempt as the current one, and lets the next one in", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.addAttempt(attemptOf("a1", "hello"));
    expect(s.closeAttempt("a1", "failed", "build failed", 12)).toBe(true);
    expect(s.attempt("a1")).toMatchObject({ status: "failed", error: "build failed", updated_at: 12 });
    expect(s.currentAttempt("hello")?.id).toBe("a1");
    expect(s.openAttemptOf("hello")).toBeNull();
    expect(s.openAttempts()).toEqual([]);
    s.addAttempt(attemptOf("a2", "hello", { kind: "rollback", started_at: 20, origin_id: "a1", note: "broke" }));
    expect(s.attempt("a2")).toMatchObject({ origin_id: "a1", note: "broke" });
    expect(s.currentAttempt("hello")?.id).toBe("a2");
    expect(s.openAttemptOf("hello")?.id).toBe("a2");
    expect(s.closeAttempt("a2", "done", null, 25)).toBe(true);
    expect(s.currentAttempt("hello")).toMatchObject({ id: "a2", status: "done", error: null });
    // An already closed one does not change, and the caller knows it (the attempt's outcome in a transaction does not pass silently).
    expect(s.closeAttempt("a2", "failed", "too late", 26)).toBe(false);
    expect(s.attempt("a2")).toMatchObject({ status: "done", error: null, updated_at: 25 });
  });

  it("moves a step only while the named fields are as expected", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.addAttempt(attemptOf("a1", "hello"));
    expect(s.stepAttempt("a1", "recorded", "installing", { known_job_ids: "[]" }, 11)).toBe(true);
    // A foreign job is recorded only while there is none yet and no own job id.
    expect(s.stepAttempt("a1", "installing", "installing", { foreign_job_id: "j1", known_job_ids: null }, 12, { foreign_job_id: null, job_id: null })).toBe(true);
    expect(s.stepAttempt("a1", "installing", "installing", { foreign_job_id: "j2" }, 13, { foreign_job_id: null })).toBe(false);
    expect(s.attempt("a1")).toMatchObject({ foreign_job_id: "j1", known_job_ids: null, updated_at: 12 });
    // The second start happens once: the condition is that the known ids are not rewritten yet.
    expect(s.stepAttempt("a1", "installing", "installing", { known_job_ids: '["j1"]' }, 14, { known_job_ids: null, foreign_job_id: "j1" })).toBe(true);
    expect(s.stepAttempt("a1", "installing", "installing", { known_job_ids: '["j1","j2"]' }, 15, { known_job_ids: null, foreign_job_id: "j1" })).toBe(false);
    expect(s.stepAttempt("a1", "installing", "installed", { job_id: "j3" }, 16, { job_id: null })).toBe(true);
    expect(s.attempt("a1")).toMatchObject({ step: "installed", job_id: "j3", known_job_ids: '["j1"]', updated_at: 16 });
  });

  it("takes the lock generation once, together with the step, and remembers the job's end state", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.addAttempt(attemptOf("a1", "hello"));
    s.stepAttempt("a1", "recorded", "locking", {}, 11);
    expect(s.stepAttempt("a1", "locking", "locking", { lock_token: "t1", lock_held: 1 }, 12, { lock_token: null })).toBe(true);
    expect(s.stepAttempt("a1", "locking", "locking", { lock_token: "t2", lock_held: 1 }, 13, { lock_token: null })).toBe(false);
    expect(s.attempt("a1")).toMatchObject({ lock_token: "t1", lock_held: 1 });
    expect(s.lockedAttempts().map((a) => a.id)).toEqual(["a1"]);
    s.stepAttempt("a1", "locking", "installed", {}, 14);
    expect(s.stepAttempt("a1", "installed", "released", { job_state: "failed" }, 15)).toBe(true);
    expect(s.attempt("a1")).toMatchObject({ step: "released", job_state: "failed" });
  });

  it("marks an attempt resolved by the owner only once it is closed, and only once", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.addAttempt(attemptOf("a1", "hello"));
    expect(s.resolveAttempt("a1", 11)).toBe(false);
    expect(s.attempt("a1")!.resolved_at).toBeNull();
    s.closeAttempt("a1", "failed", "build failed", 12);
    expect(s.resolveAttempt("a1", 13)).toBe(true);
    expect(s.attempt("a1")).toMatchObject({ status: "failed", error: "build failed", updated_at: 12, resolved_at: 13 });
    expect(s.resolveAttempt("a1", 14)).toBe(false);
    expect(s.attempt("a1")!.resolved_at).toBe(13);
    expect(s.resolveAttempt("nope", 15)).toBe(false);
  });

  it("moves a step only from the expected one, and never on a closed attempt", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.addAttempt(attemptOf("a1", "hello"));
    expect(s.stepAttempt("a1", "moved", "locking", {}, 11)).toBe(false);
    expect(s.attempt("a1")).toMatchObject({ step: "recorded", updated_at: 10 });
    expect(s.stepAttempt("a1", "recorded", "moved", {}, 11)).toBe(true);
    expect(s.stepAttempt("a1", "recorded", "moved", {}, 12)).toBe(false);
    expect(s.attempt("a1")).toMatchObject({ step: "moved", updated_at: 11 });
    s.closeAttempt("a1", "unknown", "unknown", 13);
    expect(s.stepAttempt("a1", "moved", "locking", {}, 14)).toBe(false);
    expect(s.attempt("a1")).toMatchObject({ step: "moved", status: "unknown", updated_at: 13 });
    expect(s.stepAttempt("nope", "recorded", "moved", {}, 14)).toBe(false);
  });

  it("writes the patch together with the step, only the fields it names", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.addAttempt(attemptOf("a1", "hello"));
    expect(s.stepAttempt("a1", "recorded", "moved", { known_job_ids: '["j1"]', error: "previous" }, 11)).toBe(true);
    expect(s.stepAttempt("a1", "moved", "installing", { job_id: "j2", error: null }, 12)).toBe(true);
    expect(s.attempt("a1")).toMatchObject({ step: "installing", known_job_ids: '["j1"]', job_id: "j2", foreign_job_id: null, error: null });
    expect(s.stepAttempt("a1", "installing", "installed", { foreign_job_id: "j9" }, 13)).toBe(true);
    expect(s.attempt("a1")).toMatchObject({ step: "installed", job_id: "j2", foreign_job_id: "j9" });
    expect(s.stepAttempt("a1", "installed", "released", { job_id: "j3" }, 14)).toBe(true);
    expect(s.attempt("a1")!.job_id).toBe("j3");
    expect(s.stepAttempt("a1", "recorded", "moved", { job_id: "late" }, 15)).toBe(false);
    expect(s.attempt("a1")!.job_id).toBe("j3");
  });

  it("remembers the lock holder generation and reports every attempt that may still hold the lock", () => {
    const s = memoryStore();
    seen(s, "hello");
    seen(s, "mail");
    seen(s, "notes");
    s.addAttempt(attemptOf("a1", "hello"));
    s.addAttempt(attemptOf("a2", "mail"));
    s.addAttempt(attemptOf("a3", "notes"));
    expect(s.lockedAttempts()).toEqual([]);
    s.setLock("a1", true, "tok1", 11);
    s.setLock("a2", true, "tok2", 11);
    s.setLock("a3", true, "tok3", 11);
    expect(s.attempt("a1")).toMatchObject({ lock_held: 1, lock_token: "tok1", updated_at: 11 });
    s.closeAttempt("a1", "unknown", "the install did not answer", 12);
    s.closeAttempt("a2", "failed", "refused", 12);
    s.closeAttempt("a3", "done", null, 12);
    s.setLock("a2", false, null, 13);
    s.setLock("a3", false, "tok3", 13);
    expect(s.lockedAttempts().map((a) => [a.id, a.status, a.lock_held, a.lock_token])).toEqual([["a1", "unknown", 1, "tok1"]]);
    expect(s.attempt("a3")).toMatchObject({ lock_held: 0, lock_token: "tok3" });
    expect(s.attempt("a2")).toMatchObject({ lock_held: 0, lock_token: null });
  });

  it("remembers the commit the plugin entered, and forgets it on request", () => {
    const s = memoryStore();
    seen(s, "hello");
    s.setInstalled("hello", "abc");
    expect(s.plugin("hello")!.installed_sha).toBe("abc");
    s.setInstalled("hello", null);
    expect(s.plugin("hello")!.installed_sha).toBeNull();
  });
});
