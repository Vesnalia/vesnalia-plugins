import { describe, expect, it } from "vitest";
import { worktreeDirOf } from "./fake-ports";
import { liveCheckPrompt } from "./regulations";
import { ledgerPath, livePath, ownerPath, stageOf, verifyPath } from "./stages";
import { attempt, commitWork, entered, idleStage, madeWork, moveTo, reviewed, setup, started, versionOf, type Started } from "./test-utils";

/** Two other works in Building: with maxBuilding = 2 there is no free slot. */
async function buildingFull(s: Started): Promise<string[]> {
  const others: string[] = [];
  for (const p of ["other-a", "other-b"]) {
    const id = await madeWork(s, { pluginId: p });
    s.store.casStage(id, 1, p === "other-a" ? 4 : 5, 1, 1);
    others.push(id);
  }
  return others;
}

describe("Engine: hand-over", () => {
  it("refuses while an agent works, and on a stale version", async () => {
    const s = await started();
    const v0 = await versionOf(s);
    await expect(s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: v0, note: "", force: true })).rejects.toThrow("is still working");
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# context");
    await expect(s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: v0, note: "", force: true })).rejects.toThrow("the version has changed");
  });

  it("does not let force skip a missing context.md", async () => {
    const s = await started();
    idleStage(s);
    const r = await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: true });
    expect(r.ok).toBe(false);
    expect(r.blockers).toEqual([`no ${s.docs.context}`]);
    expect(s.store.work(s.id)!.stage).toBe(1);
  });

  it("passes a blocking review only by force, atomically with its entry, and snapshots files", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 3);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none");
    const v = await versionOf(s);
    reviewed(s, 3, "tz", v, { astra: "BLOCKING" });
    const soft = await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: v, note: "", force: false });
    expect(soft).toEqual({ ok: false, blockers: [], warnings: ["GPT-6-Astra: a blocking finding remained after round 1 — see how the agent closed it in the «Review» section of the spec"] });
    const hard = await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: v, note: "accepting", force: true });
    expect(hard.ok).toBe(true);
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, entry: null, queued: 0 });
    expect(s.store.handovers(s.id).at(-1)).toMatchObject({ stage: 3, to_stage: 4, forced: true, version: v, note: "accepting" });
    const build = s.store.stageThread(s.id, 4)!;
    expect(s.ports.threads.get(build.thread_id)!.environment).toEqual({ kind: "reuse", environmentId: s.env });
    expect(s.ports.saved.at(-1)).toMatchObject({ workId: s.id, env: s.env, what: { files: [s.docs.context, s.docs.tech, s.docs.tz] } });
    expect(s.ports.savedFiles.get(`${s.id}:${s.docs.tz}`)).toBe("### Task 1: A\nMIGRATIONS: no\nNAV: none");
  });

  it("queues the build when the machine is full; a queued work cannot move on but can go back", async () => {
    const s = await started();
    await buildingFull(s);
    idleStage(s);
    await moveTo(s, 3);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none");
    reviewed(s, 3, "tz", await versionOf(s));
    await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: await versionOf(s), note: "", force: false });
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, queued: 1 });
    expect(s.store.entry(s.store.work(s.id)!)).toMatchObject({ stage: 4, from: 3 });
    expect(s.store.stageThread(s.id, 4)).toBeNull();
    const r = await s.engine.handOver(s.id, { expectedStage: 4, expectedVersion: await versionOf(s), note: "", force: true });
    expect(r.blockers).toContain("the work is queued for the machine");
    await s.engine.sendBack(s.id, { expectedStage: 4, toStage: 3, reason: "redo the spec" });
    expect(s.store.work(s.id)).toMatchObject({ stage: 3, queued: 0, iteration: 2, entry: null });
    expect(s.ports.sent.at(-1)).toMatchObject({ threadId: s.store.stageThread(s.id, 3)!.thread_id, text: expect.stringContaining("redo the spec") });
  });

  it("a work coming back into Building from outside 4–5 waits for a free slot, and stays queued going back inside it", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    await entered(s);
    await buildingFull(s);
    await s.engine.sendBack(s.id, { expectedStage: 6, toStage: 5, reason: "check again", fixForward: true });
    expect(s.store.work(s.id)).toMatchObject({ stage: 5, queued: 1 });
    await s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "finish it" });
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, queued: 1 });
    expect(s.store.entry(s.store.work(s.id)!)).toMatchObject({ stage: 4, from: -1 });
    expect(s.store.stageThread(s.id, 4)).toBeNull();
    // Spec needs no slot on the machine: a send-back there lifts the queue.
    await s.engine.sendBack(s.id, { expectedStage: 4, toStage: 3, reason: "redo the spec" });
    expect(s.store.work(s.id)).toMatchObject({ stage: 3, queued: 0, entry: null });
    expect(s.store.stageThread(s.id, 3)).not.toBeNull();
  });

  it("blocks a verification that no longer matches the code", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 4);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none");
    s.ports.files.set(`${s.env}:${ledgerPath(s.docs.tz)}`, "Task 1: complete");
    expect((await s.engine.handOver(s.id, { expectedStage: 4, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    idleStage(s, 5);
    const v = await versionOf(s);
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "all ok\nVERDICT: PASS");
    reviewed(s, 5, "verify", v);
    expect((await s.engine.view(s.id)).blockers).toEqual([]);
    commitWork(s, "h2");
    expect((await s.engine.view(s.id)).blockers).toContain("the verification report is unusable: the code changed (h1 → h2)");
    s.ports.heads.set(s.env, "h1");
    s.ports.dirty.add(s.env);
    expect((await s.engine.view(s.id)).blockers).toContain("the worktree has uncommitted changes — commit or discard them");
  });

  it("warns about an unfinished ledger and passes it by force", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 4);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\n### Task 2: B");
    s.ports.files.set(`${s.env}:${ledgerPath(s.docs.tz)}`, "Task 1: complete (x)");
    const v = await versionOf(s);
    expect(await s.engine.handOver(s.id, { expectedStage: 4, expectedVersion: v, note: "", force: false })).toEqual({ ok: false, blockers: [], warnings: ["1 of 2 plan tasks done"] });
    expect((await s.engine.handOver(s.id, { expectedStage: 4, expectedVersion: v, note: "", force: true })).ok).toBe(true);
    expect(s.store.work(s.id)!.stage).toBe(5);
    expect(s.store.stageThread(s.id, 5)!.round).toBe(1);
  });

  it("marks an earlier stage stale once what it approved changes", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "v1");
    expect((await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    idleStage(s, 2);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "v2");
    s.ports.files.set(`${s.env}:${s.docs.tech}`, "checked\nVERDICT: OK");
    s.ports.files.set(`${s.env}:${ownerPath(s.key)}`, "- nothing\n");
    const r = await s.engine.handOver(s.id, { expectedStage: 2, expectedVersion: await versionOf(s), note: "", force: true });
    expect(r.blockers).toEqual([`«${stageOf(1).title}» is stale: what you approved has changed since`]);
  });

  it("treats a review from an earlier iteration as invalid", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 3);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none");
    reviewed(s, 3, "tz", await versionOf(s));
    s.store.casStage(s.id, 3, 3, 2, 1);
    const r = await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: await versionOf(s), note: "", force: true });
    expect(r.blockers).toContain("review Fable 5.1 is invalid: the round ran on iteration 1, now it is 2");
  });

  it("keeps a committed handover when the next stage's spawn fails, and won't move on before it starts", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# context");
    s.ports.spawnFails = true;
    expect((await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    expect(s.store.work(s.id)!.stage).toBe(2);
    expect(s.store.entry(s.store.work(s.id)!)?.error).toContain("spawn failed");
    expect(s.store.handovers(s.id).at(-1)).toMatchObject({ stage: 1, to_stage: 2 });
    // The thread start may have happened after all: until it is declared failed — wait.
    await expect(s.engine.handOver(s.id, { expectedStage: 2, expectedVersion: await versionOf(s), note: "", force: true })).rejects.toThrow("not confirmed yet");
    s.ports.t += 6 * 60_000;
    await expect(s.engine.handOver(s.id, { expectedStage: 2, expectedVersion: await versionOf(s), note: "", force: true })).rejects.toThrow("has not started yet");
  });
});

describe("Engine: send-back, cancel, end", () => {
  it("sends the old thread a packet on return, and a fresh verifier each round", async () => {
    const s = await started();
    const context = idleStage(s);
    await moveTo(s, 4);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A");
    s.ports.files.set(`${s.env}:${ledgerPath(s.docs.tz)}`, "Task 1: complete");
    const toVerify = async () => expect((await s.engine.handOver(s.id, { expectedStage: 4, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    await toVerify();
    const v1 = idleStage(s, 5);
    expect(s.store.stageThread(s.id, 5)!.round).toBe(1);
    await s.engine.sendBack(s.id, { expectedStage: 5, toStage: 4, reason: "check again" });
    const build = s.store.stageThread(s.id, 4)!.thread_id;
    expect(s.ports.sent.at(-1)).toMatchObject({ threadId: build, text: expect.stringContaining("check again") });
    s.ports.idle(build);
    await toVerify();
    const second = s.store.stageThread(s.id, 5)!;
    expect(second).toMatchObject({ round: 2 });
    expect(second.thread_id).not.toBe(v1);
    expect(s.ports.threads.get(second.thread_id)!.title).toBe(`${s.key} · ${stageOf(5).title} · r2`);
    s.ports.idle(second.thread_id);
    await s.engine.sendBack(s.id, { expectedStage: 5, toStage: 1, reason: "wrong format" });
    expect(s.store.work(s.id)).toMatchObject({ stage: 1, iteration: 3, entry: null });
    expect(s.ports.sent.at(-1)).toMatchObject({ threadId: context, text: expect.stringContaining("wrong format") });
    s.ports.idle(context);
    await expect(s.engine.sendBack(s.id, { expectedStage: 1, toStage: 1, reason: "x" })).rejects.toThrow("left of the current one");
    await moveTo(s, 2);
    await expect(s.engine.sendBack(s.id, { expectedStage: 2, toStage: 1, reason: " " })).rejects.toThrow("a reason for sending back is required");
  });

  it("cancels only after the files are saved, then archives threads and the task", async () => {
    const s = await started();
    const t = idleStage(s);
    s.ports.saveFails = true;
    await expect(s.engine.cancel(s.id, "changed my mind")).rejects.toThrow("cancel snapshot failed (staged.patch): disk full");
    expect(s.ports.archived).toEqual([]);
    expect(s.store.work(s.id)!.outcome).toBeNull();
    s.ports.saveFails = false;
    await s.engine.cancel(s.id, "changed my mind");
    expect(s.store.work(s.id)).toMatchObject({ outcome: "canceled", state: "canceled", stage: 1, cleanup_done: 1, task_synced: "canceled" });
    expect(s.store.handovers(s.id).at(-1)).toMatchObject({ stage: 1, action: "cancel", note: "changed my mind" });
    expect(s.ports.archived).toEqual([t]);
    expect(s.ports.taskRows.get(s.w.task_id!)!.status).toBe("canceled");
    await expect(s.engine.cancel(s.id, "once more")).rejects.toThrow("the work is canceled");
  });

  it("refuses to finish when context.md vanishes during the final snapshot", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# context");
    s.ports.vanishOnSave.add(s.docs.context);
    await expect(s.engine.cancel(s.id, "x")).rejects.toThrow("work files not saved");
    expect(s.ports.archived).toEqual([]);
    expect(s.store.work(s.id)!.outcome).toBeNull();
  });

  it("cancels a work whose worktree VesnALIA already removed, keeping what the earlier snapshots hold", async () => {
    const s = await started();
    const t = idleStage(s);
    await moveTo(s, 2);
    s.ports.gone.add(s.env);
    await s.engine.cancel(s.id, "worktree removed");
    expect(s.store.work(s.id)).toMatchObject({ outcome: "canceled", state: "canceled", cleanup_done: 1, task_synced: "canceled" });
    const texts = s.store.events(s.id).map((e) => e.text);
    expect(texts).toContain("the worktree is already removed — no cancel snapshot, nothing more to lose; what was in earlier snapshots remains");
    expect(s.ports.count("snapshotTree")).toBe(0);
    expect(s.ports.git.ref(s.dir, `refs/workshop/${s.key}/canceled`)).toBeNull();
    expect(texts).toContain("the worktree is already removed — what was in earlier snapshots is kept");
    expect(s.ports.archived).toEqual([t, s.store.stageThread(s.id, 2)!.thread_id]);
  });

  it("keeps uncommitted changes in the cancel snapshot instead of asking", async () => {
    const s = await started();
    idleStage(s);
    s.ports.dirty.add(s.env);
    s.ports.git.setRepo(worktreeDirOf(s.env), { files: ["server.ts"], stagedDiff: "diff --git a/server.ts" });
    s.ports.files.set(`${s.env}:server.ts`, "export default 1;");
    await s.engine.cancel(s.id, "changed my mind");
    expect(s.store.work(s.id)).toMatchObject({ outcome: "canceled", cleanup_done: 1 });
    const ref = s.ports.git.ref(s.dir, `refs/workshop/${s.key}/canceled`);
    expect(ref).not.toBeNull();
    expect(s.ports.calls.find((c) => c.effect === "snapshotTree")!.args.slice(0, 2)).toEqual([worktreeDirOf(s.env), `refs/workshop/${s.key}/canceled`]);
    expect(s.ports.texts[0]).toEqual({ workId: s.id, label: `${s.ports.t}-canceled`, relPath: "staged.patch", content: "diff --git a/server.ts" });
    expect(s.ports.texts.map((t) => t.relPath)).toEqual(["staged.patch", "manifest.json"]);
    expect(s.store.events(s.id).map((e) => e.text)).toContain(`cancel snapshot: ${ref!.slice(0, 7)} under refs/workshop/${s.key}/canceled`);
  });

  it("refuses a cancel while the machine of the work is down: no snapshot, nothing archived", async () => {
    const s = await started();
    idleStage(s);
    s.ports.machineDown = true;
    await expect(s.engine.cancel(s.id, "machine is off")).rejects.toThrow("machine not responding");
    expect(s.store.work(s.id)!.outcome).toBeNull();
    expect(s.ports.archived).toEqual([]);
    expect(s.ports.count("snapshotTree")).toBe(0);
    s.ports.machineDown = false;
    await s.engine.cancel(s.id, "machine is back");
    expect(s.store.work(s.id)).toMatchObject({ outcome: "canceled", cleanup_done: 1 });
  });

  it("leaves cleanup pending when archiving fails", async () => {
    const s = await started();
    idleStage(s);
    s.ports.archiveFails = true;
    await s.engine.cancel(s.id, "x");
    expect(s.store.work(s.id)).toMatchObject({ outcome: "canceled", cleanup_done: 0 });
  });

  it("finishWork(done) keeps the stage, closes the work with its record in one transaction, then the task and the threads", async () => {
    const s = await started();
    idleStage(s);
    const a = await entered(s);
    const v = await versionOf(s);
    await s.engine.guard(s.id, { stage: 6, version: v, duringAttempt: true }, (w) =>
      s.engine.finishWork(w, "done", "accepted", { work_id: s.id, stage: 6, action: "forward", to_stage: 6, version: v, note: `accepted, attempt ${a}`, forced: false, problems: [], at: s.ports.now() }),
    );
    expect(s.store.work(s.id)).toMatchObject({ stage: 6, outcome: "done", state: "done", cleanup_done: 1, task_synced: "done" });
    expect(s.store.handovers(s.id).at(-1)).toMatchObject({ stage: 6, action: "forward", note: `accepted, attempt ${a}` });
    expect(s.ports.taskRows.get(s.w.task_id!)!.status).toBe("done");
    expect(s.ports.taskRows.get(s.w.task_id!)!.comments.at(-1)).toBe("The work is done. accepted");
    expect(s.ports.archived).toHaveLength(s.store.runs(s.id).length);
    expect(s.ports.saved.at(-1)!.label).toMatch(/final-done$/);
    expect(s.engine.board()[0]).toMatchObject({ id: s.id, stage: 6, state: "done" });
  });

  it("restarts a fallen live check with the installed commit of the attempt, not the current HEAD", async () => {
    const s = await started();
    idleStage(s);
    const a = await entered(s);
    const first = s.store.stageThread(s.id, 6)!;
    s.ports.threads.get(first.thread_id)!.status = "error";
    commitWork(s, "h2");
    await s.engine.restartStage(s.id, 6);
    const again = s.store.stageThread(s.id, 6)!;
    expect(again.round).toBe(2);
    const prompt = s.ports.threads.get(again.thread_id)!.prompt;
    expect(prompt).toContain(liveCheckPrompt(s.store.work(s.id)!, 2, s.store.attempt(a)!));
    expect(prompt).toContain("`h1`");
    expect(prompt).not.toContain("`h2`");
    expect(prompt).toContain(livePath(s.key, 2));
  });

  it("finishWork refuses when the final snapshot fails", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    s.ports.saveFails = true;
    const w = s.store.work(s.id)!;
    const record = { work_id: s.id, stage: 6, action: "forward" as const, to_stage: 6, version: null, note: "", forced: false, problems: [], at: 1 };
    await expect(s.engine.finishWork(w, "done", "", record)).rejects.toThrow("work files not saved");
    expect(s.store.work(s.id)!.outcome).toBeNull();
    expect(s.store.handovers(s.id)).toEqual([]);
    expect(s.ports.archived).toEqual([]);
  });

  it("an attempt on the plugin of another work does not block this one", async () => {
    const s = await started(setup(), { pluginId: "a" });
    idleStage(s);
    const other = await started(s, { pluginId: "b" });
    idleStage(other);
    attempt(other, { status: "running", step: "installed" });
    await moveTo(s, 2);
    await s.engine.sendBack(s.id, { expectedStage: 2, toStage: 1, reason: "x" });
    expect(s.store.work(s.id)!.stage).toBe(1);
    await expect(other.engine.cancel(other.id, "x")).rejects.toThrow("a rollout is running — wait");
  });
});

describe("Engine.view: what the wiring and the UI need", () => {
  it("names the plugin, the kind and the project, and says the work is created", async () => {
    const s = await started();
    const { work } = await s.engine.view(s.id);
    expect(work).toMatchObject({ id: s.id, key: s.key, pluginId: "hello", kind: "rework", created: true, projectId: "p1", stage: 1 });
  });
  it("tells whether the base branch went ahead", async () => {
    const s = await started();
    expect((await s.engine.view(s.id)).baseAhead).toBe(false);
    s.store.setBaseAhead(s.id, true, 1);
    expect((await s.engine.view(s.id)).baseAhead).toBe(true);
  });
  it("shows the attempt of this work with its id (for «Accept») and the rollback point", async () => {
    const s = await started();
    idleStage(s);
    expect((await s.engine.view(s.id)).attempt).toBeNull();
    const a = await entered(s);
    expect((await s.engine.view(s.id)).attempt).toEqual({ id: a, kind: "enter", step: "checked", status: "done", error: null, beforeSha: "c0", targetSha: "h1", note: null });
  });
  it("a failed attempt carries its error", async () => {
    const s = await started();
    attempt(s, { status: "failed", step: "installed", error: "install failed: x" });
    expect((await s.engine.view(s.id)).attempt).toMatchObject({ status: "failed", step: "installed", error: "install failed: x" });
  });
  it("an attempt of another work says nothing to this one", async () => {
    const s = await started();
    attempt(s, { work: "w_other" });
    expect((await s.engine.view(s.id)).attempt).toBeNull();
  });
});
