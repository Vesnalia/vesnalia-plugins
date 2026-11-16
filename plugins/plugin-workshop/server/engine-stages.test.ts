import { describe, expect, it, test } from "vitest";
import { Engine } from "./engine";
import { worktreeDirOf } from "./fake-ports";
import { gate } from "./gates";
import { kickoff, liveCheckPrompt, returnPacket } from "./regulations";
import { UNEXPECTED_COPY } from "./state";
import { docPaths, livePath, pluginDir, reviewPath, stageOf, type Who } from "./stages";
import { attempt, entered, idleStage, madeWork, moveTo, reviewed, setup, started, versionOf, type Started } from "./test-utils";
import { GITHUB_TOKEN } from "./test-tokens";

const reviewers = (s: Started, stage: number) => s.store.runs(s.id).filter((r) => r.role === "review" && r.stage === stage);
/** A spec that passes the stage 3 gate: tasks, the MIGRATIONS line and a clean review of this version. */
async function tzReady(s: Started): Promise<void> {
  s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
  reviewed(s, 3, "tz", await versionOf(s));
}

describe("Engine: stages 1–5", () => {
  test("send back from tz to tech is allowed", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 3);
    const tech = s.store.stageThread(s.id, 2);
    expect(tech).toBeNull();
    await s.engine.sendBack(s.id, { expectedStage: 3, toStage: 2, reason: "revisit the dependencies" });
    expect(s.store.work(s.id)).toMatchObject({ stage: 2, iteration: 2, entry: null });
    expect(s.store.handovers(s.id).at(-1)).toMatchObject({ stage: 3, action: "back", to_stage: 2, note: "revisit the dependencies" });
    const thread = s.ports.threads.get(s.store.stageThread(s.id, 2)!.thread_id)!;
    expect(thread.prompt).toContain(returnPacket(s.store.work(s.id)!, stageOf(2), stageOf(3), "revisit the dependencies", 2));
    expect(thread.environment).toEqual({ kind: "reuse", environmentId: s.env });
  });

  test("send back from stage 6 needs a rollback or fixForward", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    await entered(s);
    await expect(s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x" })).rejects.toThrow("first «Roll back» or «Fix forward»");
    expect(s.store.work(s.id)!.stage).toBe(6);
    await s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x", fixForward: true });
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, iteration: 2 });
    expect(s.store.events(s.id).map((e) => e.text)).toContainEqual(expect.stringContaining("(fix forward: the rolled-out code stays): x"));
  });

  test("send back from stage 6 is open once the plugin's current attempt is a finished rollback", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    attempt(s, { kind: "rollback", status: "failed", step: "installed" });
    await expect(s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x" })).rejects.toThrow("first «Roll back» or «Fix forward»");
    attempt(s, { kind: "rollback" });
    await s.engine.sendBack(s.id, { expectedStage: 6, toStage: 1, reason: "start over" });
    expect(s.store.work(s.id)!.stage).toBe(1);
  });

  test("third work entering build waits in the queue", async () => {
    const s = await started(setup(2), { pluginId: "c" });
    for (const p of ["a", "b"]) {
      const other = await madeWork(s, { pluginId: p });
      s.store.casStage(other, 1, p === "a" ? 4 : 5, 1, 1);
    }
    idleStage(s);
    await moveTo(s, 3);
    await tzReady(s);
    expect(await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: await versionOf(s), note: "", force: false })).toEqual({ ok: true, blockers: [], warnings: [] });
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, queued: 1 });
    expect(s.store.stageThread(s.id, 4)).toBeNull();
    expect(s.store.events(s.id).map((e) => e.text)).toContain("queued: the machine already has 2 works in Building");
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("queued");
    // A slot freed up: one of the works moved on to Rollout.
    s.store.casStage("w_a_2", 4, 6, 1, 2);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, queued: 0, entry: null });
    expect(s.store.stageThread(s.id, 4)).not.toBeNull();
  });

  test("base ahead is noticed by reconcile and blocks verify", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ base_ahead: 0, stale: 0 });
    const ahead = s.ports.git.commit(s.dir);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ base_ahead: 1, stale: 1 });
    expect(s.store.events(s.id).map((e) => e.text)).toContain("the working copy's main branch has moved ahead — the implementer is pulling it in");
    const v = await versionOf(s);
    expect(gate(await s.engine.gateFacts(s.store.work(s.id)!, v)).blockers).toContain("the working copy's main branch has moved ahead — the implementer is pulling it in");
    expect((await s.engine.view(s.id)).blockers).toContain("the working copy's main branch has moved ahead — the implementer is pulling it in");
    await expect(s.engine.requestReview(s.id, 5)).rejects.toThrow("the working copy's main branch has moved ahead");
    // The implementer pulled in the main branch: a merge in the work branch.
    s.ports.git.link("h2", ahead);
    s.ports.heads.set(s.env, "h2");
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.base_ahead).toBe(0);
  });

  test("base ahead is checked only against main of the working copy", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 4);
    s.ports.git.setRepo(s.dir, { branch: "fix/x", head: "elsewhere" });
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.base_ahead).toBe(0);
  });

  test("handOver at stage 5 is refused", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    const args5 = { expectedStage: 5, expectedVersion: await versionOf(s), note: "", force: true };
    await expect(s.engine.handOver(s.id, args5)).rejects.toThrow("«Roll out»");
    await expect(s.engine.handOver(s.id, args5)).rejects.toThrow("this is done by «Roll out»");
    await entered(s);
    await expect(s.engine.handOver(s.id, { ...args5, expectedStage: 6 })).rejects.toThrow("«Accept»");
    expect(s.store.work(s.id)!.stage).toBe(6);
  });

  test("guard refuses a stale screen version", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    const old = await versionOf(s);
    expect(await s.engine.guard(s.id, { stage: 5, version: old }, async () => 1)).toBe(1);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: edit");
    await expect(s.engine.guard(s.id, { stage: 5, version: old }, async () => 1)).rejects.toThrow("the version has changed");
    await expect(s.engine.guard(s.id, { stage: 4 }, async () => 1)).rejects.toThrow("the stage has already changed");
  });

  test("guard refuses while a thread of the work is busy", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 4);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A");
    s.ports.files.set(`${s.env}:.superpowers/sdd/tz/progress.md`, "Task 1: complete");
    expect((await s.engine.handOver(s.id, { expectedStage: 4, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    const verifier = s.store.stageThread(s.id, 5)!;
    expect(s.ports.threads.get(verifier.thread_id)!.status).toBe("active");
    await expect(s.engine.guard(s.id, { stage: 5 }, async () => 1)).rejects.toThrow("the work's agent is still working");
    s.ports.idle(verifier.thread_id);
    expect(await s.engine.guard(s.id, { stage: 5 }, async () => 1)).toBe(1);
  });

  test("no cancel, send back or restart during an attempt", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    const a = attempt(s, { kind: "reinstall", status: "running", step: "locking", work: null });
    const refusals = async () => {
      await expect(s.engine.cancel(s.id, "x")).rejects.toThrow("a rollout is running — wait");
      await expect(s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "x" })).rejects.toThrow("a rollout is running — wait");
      await expect(s.engine.restartStage(s.id, 5)).rejects.toThrow("a rollout is running — wait");
      await expect(s.engine.requestReview(s.id, 5)).rejects.toThrow("a rollout is running — wait");
      expect(await s.engine.guard(s.id, { stage: 5, duringAttempt: true }, async () => "rollout")).toBe("rollout");
    };
    await refusals();
    // The attempt is closed, but its holder may still be holding the lock.
    s.store.setLock(a, true, "tok", s.ports.now());
    s.store.closeAttempt(a, "unknown", null, s.ports.now());
    await refusals();
    s.store.setLock(a, false, null, s.ports.now());
    // The attempt is closed with an unknown outcome and the owner has not decided: a send-back is only «Fix forward» via «Hand over anyway».
    await s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "x", force: true, fixForward: true });
    expect(s.store.work(s.id)!.stage).toBe(4);
    expect(s.store.work(s.id)!.outcome).toBeNull();
  });

  test("a return from 5 or 6 over an undecided failed or unknown attempt needs force and resolves it in the same transaction", async () => {
    for (const status of ["failed", "unknown"] as const) {
      const s = await started();
      idleStage(s);
      await moveTo(s, 5);
      const a = attempt(s, { status, step: "installed" });
      const what = status === "failed" ? "rollout failed" : "install outcome unknown";
      await expect(s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "x" })).rejects.toThrow(
        `${what} — «Roll back», «Disable» or «Fix forward» via «Hand over anyway»`,
      );
      expect(s.store.work(s.id)!.stage).toBe(5);
      expect(s.store.attempt(a)!.resolved_at).toBeNull();
      // The "resolved" mark and the send-back are one transaction: a send-back that failed leaves no mark.
      const tx = s.store.tx.bind(s.store);
      s.store.tx = ((fn: () => unknown) => tx(() => {
        fn();
        throw new Error("failure in the send-back transaction");
      })) as typeof s.store.tx;
      await expect(s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "fixing forward", force: true, fixForward: true })).rejects.toThrow("failure in the send-back transaction");
      expect(s.store.attempt(a)!.resolved_at).toBeNull();
      expect(s.store.work(s.id)!.stage).toBe(5);
      s.store.tx = tx as typeof s.store.tx;
      await s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "fixing forward", force: true, fixForward: true });
      expect(s.store.work(s.id)).toMatchObject({ stage: 4, iteration: 2 });
      expect(s.store.attempt(a)!.resolved_at).toBe(s.ports.now());
      expect(s.store.events(s.id).map((e) => e.text)).toContainEqual(expect.stringContaining("(fix forward: the rolled-out code stays): fixing forward"));
    }
  });

  test("a failure the owner already resolved, or a failure of another work, does not hold a return", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    const a = attempt(s, { status: "failed", step: "installed" });
    s.store.resolveAttempt(a, s.ports.now());
    await s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "x" });
    expect(s.store.work(s.id)!.stage).toBe(4);
    const t = await started();
    idleStage(t);
    await moveTo(t, 5);
    attempt(t, { status: "failed", step: "installed", work: "w_other" });
    await t.engine.sendBack(t.id, { expectedStage: 5, toStage: 4, reason: "x" });
    expect(t.store.work(t.id)!.stage).toBe(4);
  });

  test("at Rollout a failed attempt is fixed forward only through force", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    const a = attempt(s, { kind: "reinstall", status: "failed", step: "checked" });
    await expect(s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x" })).rejects.toThrow("first «Roll back» or «Fix forward»");
    await expect(s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x", fixForward: true })).rejects.toThrow(
      "reinstall failed — «Roll back», «Disable» or «Fix forward» via «Hand over anyway»",
    );
    await s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x", fixForward: true, force: true });
    expect(s.store.work(s.id)!.stage).toBe(4);
    expect(s.store.attempt(a)!.resolved_at).not.toBeNull();
  });

  test("`force` alone never opens a return from Rollout: a finished rollback or fixForward is needed", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    // The rollout succeeded, there was no rollback: force alone is not enough, the work stays at Rollout.
    await expect(s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x", force: true })).rejects.toThrow("first «Roll back» or «Fix forward»");
    expect(s.store.work(s.id)!.stage).toBe(6);
    // The same on top of an undecided failure: force without fixForward does not let it through and does not mark the attempt resolved.
    const t = await started();
    idleStage(t);
    await entered(t);
    const a = attempt(t, { kind: "reinstall", status: "failed", step: "checked" });
    await expect(t.engine.sendBack(t.id, { expectedStage: 6, toStage: 4, reason: "x", force: true })).rejects.toThrow("first «Roll back» or «Fix forward»");
    expect(t.store.work(t.id)!.stage).toBe(6);
    expect(t.store.attempt(a)!.resolved_at).toBeNull();
    // After a finished rollback a plain send-back is still open.
    attempt(s, { kind: "rollback" });
    await s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "after the rollback" });
    expect(s.store.work(s.id)!.stage).toBe(4);
  });

  test("a return from Verification over an undecided failure needs force together with fixForward", async () => {
    for (const [name, extra] of [["force alone", { force: true }], ["fixForward alone", { fixForward: true }]] as const) {
      const s = await started();
      idleStage(s);
      await moveTo(s, 5);
      const a = attempt(s, { status: "failed", step: "installed" });
      await expect(s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: name, ...extra }), name).rejects.toThrow(
        "rollout failed — «Roll back», «Disable» or «Fix forward» via «Hand over anyway»",
      );
      expect(s.store.work(s.id)!.stage, name).toBe(5);
      expect(s.store.attempt(a)!.resolved_at, name).toBeNull();
    }
  });

  describe("view.sendBack tells the interface what the server will accept", () => {
    const offer = async (s: Started) => (await s.engine.view(s.id)).sendBack;

    test("a plain return on stages 1–5 without a failure", async () => {
      const s = await started();
      idleStage(s);
      expect(await offer(s)).toEqual({ needsForce: false, fixForwardOffered: false });
      await moveTo(s, 5);
      expect(await offer(s)).toEqual({ needsForce: false, fixForwardOffered: false });
    });

    test("Verification over an undecided failed or unknown attempt: fix forward through force", async () => {
      for (const status of ["failed", "unknown"] as const) {
        const s = await started();
        idleStage(s);
        await moveTo(s, 5);
        const a = attempt(s, { status, step: "installed" });
        expect(await offer(s), status).toEqual({ needsForce: true, fixForwardOffered: true });
        // A failure the owner resolved and a failure of another work — a plain send-back.
        s.store.resolveAttempt(a, s.ports.now());
        expect(await offer(s), `${status}, resolved`).toEqual({ needsForce: false, fixForwardOffered: false });
      }
      const t = await started();
      idleStage(t);
      await moveTo(t, 5);
      attempt(t, { status: "failed", step: "installed", work: "w_other" });
      expect(await offer(t)).toEqual({ needsForce: false, fixForwardOffered: false });
    });

    test("Rollout: fix forward after a good rollout, through force after a failure, a plain return only after a finished rollback", async () => {
      const s = await started();
      idleStage(s);
      await entered(s);
      expect(await offer(s)).toEqual({ needsForce: false, fixForwardOffered: true });
      const failed = attempt(s, { kind: "reinstall", status: "failed", step: "checked" });
      expect(await offer(s)).toEqual({ needsForce: true, fixForwardOffered: true });
      s.store.resolveAttempt(failed, s.ports.now());
      expect(await offer(s)).toEqual({ needsForce: false, fixForwardOffered: true });
      attempt(s, { kind: "rollback" });
      expect(await offer(s)).toEqual({ needsForce: false, fixForwardOffered: false });
      // A rollback that failed did not finish the rollback.
      attempt(s, { kind: "rollback", status: "failed", step: "installed" });
      expect(await offer(s)).toEqual({ needsForce: true, fixForwardOffered: true });
    });

    test("a finished work offers nothing", async () => {
      const s = await started();
      idleStage(s);
      await entered(s);
      s.store.finish(s.id, "canceled", s.ports.now());
      expect(await offer(s)).toEqual({ needsForce: false, fixForwardOffered: false });
    });

    test("what the view offers is what sendBack accepts", async () => {
      const s = await started();
      idleStage(s);
      await entered(s);
      attempt(s, { kind: "reinstall", status: "unknown", step: "installed" });
      const o = await offer(s);
      expect(o).toEqual({ needsForce: true, fixForwardOffered: true });
      await s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "fixing", fixForward: o.fixForwardOffered, force: o.needsForce });
      expect(s.store.work(s.id)!.stage).toBe(4);
    });
  });

  test("a return waits while an install of the plugin's folder runs; an unknown job list holds it too", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 4);
    s.ports.plugins.addJob({ id: "j_other", source: `path:${pluginDir("other")}`, state: "running" });
    s.ports.plugins.addJob({ id: "j1", source: s.dir, state: "cancelling" });
    await expect(s.engine.sendBack(s.id, { expectedStage: 4, toStage: 3, reason: "x" })).rejects.toThrow("an install is running — wait or cancel it");
    s.ports.plugins.setJob("j1", "cancelled");
    s.ports.plugins.failJobs = true;
    await expect(s.engine.sendBack(s.id, { expectedStage: 4, toStage: 3, reason: "x" })).rejects.toThrow("the install job list did not arrive — the action does not start");
    s.ports.plugins.failJobs = false;
    expect(s.store.work(s.id)!.stage).toBe(4);
    // A job of another plugin does not hold the send-back.
    await s.engine.sendBack(s.id, { expectedStage: 4, toStage: 3, reason: "x" });
    expect(s.store.work(s.id)!.stage).toBe(3);
  });

  test("returns on stages 1–3 do not touch the plugin and do not depend on the job list", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 3);
    s.ports.plugins.addJob({ id: "j1", source: s.dir, state: "running" });
    s.ports.plugins.failJobs = true;
    await s.engine.sendBack(s.id, { expectedStage: 3, toStage: 2, reason: "x" });
    expect(s.store.work(s.id)!.stage).toBe(2);
    idleStage(s, 2);
    s.ports.plugins.failJobs = false;
    await s.engine.sendBack(s.id, { expectedStage: 2, toStage: 1, reason: "x" });
    expect(s.store.work(s.id)!.stage).toBe(1);
  });

  test("reconcile ignores a work still being created", async () => {
    const s = setup();
    const t = await s.ports.tasks.create({ tasksProjectId: "tp1", title: "Hello", description: "" });
    s.store.upsertSeen({ id: "hello", name: "Hello", dir: pluginDir("hello"), source: null }, 1);
    s.store.addWork({ id: "w_new", plugin_id: "hello", kind: "new", tasks_project_id: "tp1", host_id: "host_1", title: "Hello", request: "R", created_at: 1 });
    s.store.setTask("w_new", t, 1);
    s.store.setProject("w_new", "p1", 1);
    s.store.setEntry("w_new", { key: "e", stage: 1, from: 0, packet: null, error: null }, 1);
    await s.engine.reconcile("w_new");
    await s.engine.reconcileAll();
    expect(s.ports.threads.size).toBe(0);
    expect(s.ports.taskRows.get(t.id)!.status).toBe("todo");
    expect(s.store.work("w_new")).toMatchObject({ created: 0, state: "new", entry: expect.any(String) });
  });

  test("handover snapshot has the docs, the owner list and iterations, but no key files", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# context");
    expect((await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    const snap = s.ports.saved.at(-1)!;
    expect(snap.what.files).toEqual([s.docs.context, s.docs.tech, s.docs.tz]);
    expect(snap.what.dirs).toEqual([`.superpowers/workshop/${s.key}`, ".superpowers/sdd/tz", `docs/workshop/${s.key}`]);
    expect(s.ports.savedFiles.get(`${s.id}:${s.docs.context}`)).toBe("# context");
    // Keys in the work folder (an agent kept them in keys.env) do not get into the snapshot; the owner checklist does.
    s.ports.files.set(`${s.env}:.superpowers/workshop/${s.key}/keys.env`, "API_KEY=x");
    s.ports.files.set(`${s.env}:.superpowers/workshop/${s.key}/secrets/token`, "x");
    s.ports.files.set(`${s.env}:docs/workshop/${s.key}/owner.md`, "- [ ] key");
    s.ports.files.set(`${s.env}:${s.docs.tech}`, "VERDICT: OK");
    idleStage(s, 2);
    expect((await s.engine.handOver(s.id, { expectedStage: 2, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    expect(s.ports.savedFiles.has(`${s.id}:.superpowers/workshop/${s.key}/keys.env`)).toBe(false);
    expect(s.ports.savedFiles.has(`${s.id}:.superpowers/workshop/${s.key}/secrets/token`)).toBe(false);
    expect(s.ports.savedFiles.get(`${s.id}:docs/workshop/${s.key}/owner.md`)).toBe("- [ ] key");
  });

  test("cancel with a failed snapshot keeps the worktree and threads", async () => {
    const s = await started();
    const t = idleStage(s);
    s.ports.failAt("snapshotTree");
    await expect(s.engine.cancel(s.id, "changed my mind")).rejects.toThrow("cancel snapshot failed (snapshot commit): failure before snapshotTree");
    expect(s.ports.archived).toEqual([]);
    expect(s.store.work(s.id)).toMatchObject({ outcome: null, state: "error", state_reason: "cancel snapshot failed (snapshot commit): failure before snapshotTree" });
    expect(s.ports.git.ref(s.dir, `refs/workshop/${s.key}/canceled`)).toBeNull();
    // The reason stays on the card after reconcile too — until the owner does something else with the work.
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: "cancel snapshot failed (snapshot commit): failure before snapshotTree" });
    s.ports.failAt(null);
    await s.engine.cancel(s.id, "changed my mind");
    expect(s.store.work(s.id)).toMatchObject({ outcome: "canceled", state: "canceled" });
    expect(s.ports.archived).toEqual([t]);
    expect(s.ports.git.ref(s.dir, `refs/workshop/${s.key}/canceled`)).not.toBeNull();
  });

  test("a failed cancel stops showing once the owner moves the work", async () => {
    const s = await started();
    idleStage(s);
    s.ports.failAt("updateRef");
    await expect(s.engine.cancel(s.id, "x")).rejects.toThrow("cancel snapshot failed");
    s.ports.failAt(null);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# context");
    await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: false });
    idleStage(s);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("owner");
  });

  test("cancel writes the names of files left out of the snapshot and their labels, not their content; nothing of them is kept", async () => {
    const s = await started();
    idleStage(s);
    const diff = "diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;\n";
    s.ports.git.setRepo(worktreeDirOf(s.env), { files: ["src/a.ts", "config.ts", "keys.env"], stagedDiff: diff });
    s.ports.files.set(`${s.env}:src/a.ts`, "export const a = 1;");
    s.ports.files.set(`${s.env}:config.ts`, `export const token = "${GITHUB_TOKEN}";`);
    s.ports.files.set(`${s.env}:keys.env`, "PASSWORD=hunter2");
    await s.engine.cancel(s.id, "x");
    const texts = s.store.events(s.id).map((e) => e.text);
    expect(texts.some((t) => t.includes("config.ts (ghp_, gh_token)") && t.includes("keys.env (key file by name)") && t.includes("not kept anywhere (listed in its manifest.json)"))).toBe(true);
    expect(texts.some((t) => t.includes("src/a.ts"))).toBe(false);
    expect(texts.join("\n")).not.toContain(GITHUB_TOKEN);
    expect(s.ports.texts.map((t) => t.relPath)).toEqual(["staged.patch", "manifest.json"]);
    expect(s.ports.texts[0]!.content).toBe(diff);
    expect([...s.ports.savedFiles.values()].join("\n")).not.toContain(GITHUB_TOKEN);
    expect([...s.ports.savedFiles.values()].join("\n")).not.toContain("hunter2");
  });

  test("cancel writes the names of nested repositories left out of the snapshot", async () => {
    const s = await started();
    idleStage(s);
    s.ports.git.setRepo(worktreeDirOf(s.env), { files: ["src/a.ts"], nested: ["vendor/ref"], stagedDiff: "" });
    s.ports.files.set(`${s.env}:src/a.ts`, "export const a = 1;");
    await s.engine.cancel(s.id, "x");
    const texts = s.store.events(s.id).map((e) => e.text);
    expect(texts.some((t) => t.includes("nested repository") && t.includes("vendor/ref"))).toBe(true);
  });

  test("no cancel on stage 6", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    await expect(s.engine.cancel(s.id, "x")).rejects.toThrow("there is no cancel at Rollout");
  });

  test("on stage 5 the review files go to the verifier, not to anyone else", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    await s.engine.requestReview(s.id, 5);
    for (const r of reviewers(s, 5)) {
      s.ports.files.set(`${s.env}:${reviewPath(s.key, "verify", r.who as Who, r.round)}`, "VERDICT: CLEAR");
      s.ports.idle(r.thread_id);
    }
    await s.engine.reconcile(s.id);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 5).filter((r) => r.done_at === null)).toEqual([]);
    expect(s.ports.sent.map((m) => m.threadId)).toEqual([s.store.stageThread(s.id, 5)!.thread_id]);
  });
});

describe("Engine: shared with Rollout", () => {
  test("the live check enters stage 6 by its entry: a fresh thread in the work's worktree with the attempt's facts", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    const a = await entered(s);
    const live = s.store.stageThread(s.id, 6)!;
    const th = s.ports.threads.get(live.thread_id)!;
    expect(th.environment).toEqual({ kind: "reuse", environmentId: s.env });
    expect(th.title).toBe(`${s.key} · ${stageOf(6).title} · r1`);
    const w = s.store.work(s.id)!;
    expect(th.prompt).toBe(kickoff(w, stageOf(6), 1, liveCheckPrompt(w, 1, s.store.attempt(a)!)));
    expect(th.prompt).toContain("`h1`");
    expect(th.prompt).toContain(livePath(s.key, 1));
    expect(s.engine.liveCheckEntry(s.store.work(s.id)!, s.store.attempt(a)!, 5)).toMatchObject({ stage: 6, attemptId: a, packet: null, error: null });
    expect(s.store.work(s.id)!.entry).toBeNull();
    expect(s.ports.taskRows.get(s.store.work(s.id)!.task_id!)!.status).toBe("in_review");
  });

  test("no live check to restart without a finished attempt", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    s.ports.threads.get(s.store.stageThread(s.id, 6)!.thread_id)!.status = "error";
    attempt(s, { kind: "reinstall", status: "failed", step: "installed" });
    await expect(s.engine.restartStage(s.id, 6)).rejects.toThrow("nothing to live-check");
    expect((await s.engine.view(s.id)).work.canRestart).toBe(false);
  });

  test("sendBackInTx writes inside the caller's transaction and rolls back with it", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    const w = s.store.work(s.id)!;
    expect(() =>
      s.store.tx(() => {
        s.engine.sendBackInTx(w, 4, "rollback", 5);
        throw new Error("failure after");
      }),
    ).toThrow("failure after");
    expect(s.store.work(s.id)).toMatchObject({ stage: 6, iteration: 1, entry: null });
    s.store.tx(() => s.engine.sendBackInTx(w, 4, "rollback", 5));
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, iteration: 2 });
    expect(s.store.entry(s.store.work(s.id)!)).toMatchObject({ stage: 4, from: 6 });
    expect(s.store.handovers(s.id).at(-1)).toMatchObject({ stage: 6, action: "back", to_stage: 4, note: "rollback" });
    expect(() => s.store.tx(() => s.engine.sendBackInTx(w, 4, "once more", 6))).toThrow("the stage has already changed");
    await s.engine.reconcile(s.id);
    expect(s.ports.threads.get(s.store.stageThread(s.id, 4)!.thread_id)!.prompt).toContain(returnPacket(s.store.work(s.id)!, stageOf(4), stageOf(6), "rollback", 2));
  });

  test("stopThreads stops the busy threads and says whether all stand", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    const live = s.store.stageThread(s.id, 6)!.thread_id;
    s.ports.threads.get(live)!.status = "active";
    s.ports.stopped.length = 0;
    expect(await s.engine.stopThreads(s.store.work(s.id)!)).toBe(true);
    expect(s.ports.stopped).toEqual([live]);
    // A freshly created thread may not have started its turn yet.
    s.store.setEntry(s.id, s.engine.liveCheckEntry(s.store.work(s.id)!, s.store.attempt(attempt(s, { kind: "reinstall" }))!, s.ports.now()), s.ports.now());
    await s.engine.reconcile(s.id);
    expect(await s.engine.stopThreads(s.store.work(s.id)!)).toBe(false);
  });

  test("firstStageEntry enters the Context from outside", () => {
    const s = setup();
    const w = { id: "w1", iteration: 1 } as Parameters<Engine["firstStageEntry"]>[0];
    expect(s.engine.firstStageEntry(w, 7)).toEqual({ key: "w1:enter:s1:i1:t7", stage: 1, from: 0, packet: null, error: null });
  });
});

describe("Engine: the card and the plugin attempt", () => {
  /** The catalog reconcile confirmed the plugin is disabled (this happens every five minutes; it is not an owner decision). */
  const catalogSaysDisabled = (s: Started) => s.store.setLastState(s.store.work(s.id)!.plugin_id, { state: "disabled", enabled: false }, s.ports.now());

  test("a closed failed attempt shows on stage 6 until the owner resolves it", async () => {
    const s = await started();
    idleStage(s);
    catalogSaysDisabled(s);
    await entered(s);
    const a = attempt(s, { kind: "reinstall", status: "failed", step: "installed" });
    await s.engine.reconcile(s.id);
    const failure = "reinstall failed: install failed — roll back or disable the plugin";
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: failure });
    for (let i = 0; i < 3; i++) {
      s.ports.t += 5 * 60_000;
      catalogSaysDisabled(s);
      await s.engine.reconcile(s.id);
      expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: failure });
    }
    // The owner decided («Disable» marks the attempt): the failure no longer hides the work's errors.
    expect(s.store.resolveAttempt(a, s.ports.now())).toBe(true);
    s.ports.machineDown = true;
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("machine");
    s.ports.machineDown = false;
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: "reinstall failed, plugin disabled — send the work back to the implementer («Fix forward»)" });
  });

  test("an unexpected copy and an unknown outcome do not fade with catalog syncs either", async () => {
    const cases = [
      { o: { status: "failed" as const, step: "moved" as const, error: `${UNEXPECTED_COPY}: HEAD c1` }, state: "unexpected" },
      { o: { status: "unknown" as const, step: "installed" as const }, state: "unknown" },
    ];
    for (const c of cases) {
      const s = await started();
      idleStage(s);
      catalogSaysDisabled(s);
      await moveTo(s, 5);
      attempt(s, c.o);
      for (let i = 0; i < 3; i++) {
        await s.engine.reconcile(s.id);
        expect(s.store.work(s.id)!.state).toBe(c.state);
        s.ports.t += 5 * 60_000;
        catalogSaysDisabled(s);
      }
    }
  });

  test("a failed enter leaves the work on stage 5 with a red card", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    const a = attempt(s, { status: "failed", step: "installed" });
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ stage: 5, state: "error", state_reason: "rollout failed: install failed — roll back or disable the plugin" });
    s.store.resolveAttempt(a, s.ports.now());
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("owner");
  });

  test("a resolved failed rollback at Rollout is called a failed rollback", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    const a = attempt(s, { kind: "rollback", status: "failed", step: "installed" });
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state_reason).toBe("rollback failed: install failed — disable the plugin");
    s.store.resolveAttempt(a, s.ports.now());
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state_reason).toBe("rollback failed, plugin disabled — send the work back to the implementer («Fix forward»)");
  });

  test("closed attempts of another work neither speak on this card nor open a return from Rollout", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    attempt(s, { kind: "rollback", work: "w_other" });
    await expect(s.engine.sendBack(s.id, { expectedStage: 6, toStage: 4, reason: "x" })).rejects.toThrow("first «Roll back» or «Fix forward»");
    attempt(s, { status: "failed", step: "installed", work: "w_other" });
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: "there is no rollout attempt — send the work back to the implementer" });
    s.ports.threads.get(s.store.stageThread(s.id, 6)!.thread_id)!.status = "error";
    await expect(s.engine.restartStage(s.id, 6)).rejects.toThrow("nothing to live-check");
  });

  test("an open attempt of the plugin speaks on any stage; a closed one off stages 5–6 does not", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 4);
    const a = attempt(s, { kind: "rollback", status: "running", step: "installed", work: null });
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "installing", state_reason: "rollback: the plugin is being installed" });
    s.store.closeAttempt(a, "failed", null, s.ports.now());
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("owner");
  });

  test("no stage 4–6 is entered while the plugin's attempt runs or may still hold the build lock", async () => {
    const s = await started();
    idleStage(s);
    const a = attempt(s, { kind: "reinstall", status: "running", step: "installed", work: null });
    s.store.tx(() => {
      s.store.casStage(s.id, 1, 4, 1, s.ports.now());
      s.store.setEntry(s.id, { key: "e4", stage: 4, from: 3, packet: null, error: null }, s.ports.now());
    });
    await s.engine.reconcile(s.id);
    expect(s.store.stageThread(s.id, 4)).toBeNull();
    expect(s.store.work(s.id)!.state).toBe("installing");
    s.store.setLock(a, true, "tok", s.ports.now());
    s.store.closeAttempt(a, "unknown", null, s.ports.now());
    await s.engine.reconcile(s.id);
    expect(s.store.stageThread(s.id, 4)).toBeNull();
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: `entry into the «${stageOf(4).title}» stage is waiting: the plugin has an install running or the build lock is held` });
    s.store.setLock(a, false, null, s.ports.now());
    await s.engine.reconcile(s.id);
    expect(s.store.stageThread(s.id, 4)).not.toBeNull();
    expect(s.store.work(s.id)!.entry).toBeNull();
  });

  test("stages 1–3 do not touch the plugin: their entry does not wait for an attempt or the build lock", async () => {
    const s = await started();
    idleStage(s);
    const a = attempt(s, { kind: "reinstall", status: "running", step: "installed", work: null });
    s.store.setLock(a, true, "tok", s.ports.now());
    s.store.tx(() => {
      s.store.casStage(s.id, 1, 2, 1, s.ports.now());
      s.store.setEntry(s.id, { key: "e2", stage: 2, from: 1, packet: null, error: null }, s.ports.now());
    });
    await s.engine.reconcile(s.id);
    expect(s.store.stageThread(s.id, 2)).not.toBeNull();
    expect(s.store.work(s.id)!.entry).toBeNull();
    // The card still talks about the plugin's running attempt — but there is no "entry is waiting" hint.
    expect(s.store.work(s.id)!.state_reason).toBe("reinstall: the plugin is being installed");
    s.store.closeAttempt(a, "unknown", null, s.ports.now());
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state_reason).not.toContain("is waiting");
  });
});

describe("Engine: stage texts", () => {
  it("names the seven stages in work order in the view and keeps stage 0 and 8 out; with «Mockup» off the view has six", async () => {
    const off = await started();
    expect((await off.engine.view(off.id)).stages.map((x) => x.no)).toEqual([1, 2, 3, 4, 5, 6]);
    const s = await started(setup(2, 2, false, true));
    const view = await s.engine.view(s.id);
    expect(view.stages.map((x) => x.title)).toEqual([1, 2, 3, 7, 4, 5, 6].map((no) => stageOf(no).title));
    expect(view.stages.map((x) => x.no)).toEqual([1, 2, 3, 7, 4, 5, 6]);
    expect(() => stageOf(8)).toThrow();
    expect(stageOf(view.work.stage).key).toBe("context");
    expect(docPaths(s.key).tech).toBe(`docs/workshop/${s.key}/tech.md`);
  });
});
