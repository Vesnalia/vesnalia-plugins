import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import { identity, reviewsForVerifier, reviewsReady, threadTitle } from "./regulations";
import { livePath, reviewPath, stageOf, verifyPath, type Who } from "./stages";
import { attempt, commitWork, entered, idleStage, madeWork, moveTo, setup, started, versionOf, type Started } from "./test-utils";

/** A work at Spec (a stage with a review and "close the items"); the Spec agent finished its turn. */
async function onTz() {
  const s = await started();
  idleStage(s);
  await moveTo(s, 3);
  return { ...s, tz: s.store.stageThread(s.id, 3)!.thread_id };
}
const reviewers = (s: Started, stage = 3) => s.store.runs(s.id).filter((r) => r.role === "review" && r.stage === stage);
/** The opening of a regulations message up to its file list: recognises the message without repeating its wording. */
const opening = (text: string) => text.slice(0, text.indexOf("`F`"));
/** "Reviews ready" to the Spec agent; the verifier gets a different message (`reviewsForVerifier`). */
const readyMessages = (s: Started) => s.ports.sent.filter((m) => m.text.startsWith(opening(reviewsReady(s.store.work(s.id)!, ["F"]))));
/** The round's review files, Fable first. */
const roundFiles = (s: Started, stage: "tz" | "verify", round = 1) => (["fable", "astra"] as Who[]).map((who) => reviewPath(s.key, stage, who, round));
/** The reviewer wrote its file with a verdict and finished its turn. */
function reviewDone(s: Started, r: { thread_id: string; who: string; round: number; stage: number }, verdict = "CLEAR") {
  s.ports.files.set(`${s.env}:${reviewPath(s.key, r.stage === 3 ? "tz" : "verify", r.who as Who, r.round)}`, `VERDICT: ${verdict}`);
  s.ports.idle(r.thread_id);
}

describe("Engine: reviews", () => {
  it("spawns both reviewers hidden in the work's worktree; a new request replaces the ones not yet closed", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    expect(reviewers(s).map((r) => [r.who, r.round])).toEqual([["fable", 1], ["astra", 1]]);
    const astra = s.ports.threads.get(reviewers(s)[1]!.thread_id)!;
    expect(astra).toMatchObject({ providerId: "codex", model: "gpt-6-astra", hidden: true, environment: { kind: "reuse", environmentId: s.env }, title: threadTitle(s.store.work(s.id)!, stageOf(3), "review", "astra", 1) });
    expect(astra.prompt).toContain(reviewPath(s.key, "tz", "astra", 1));
    // While the reviewers work there is no new round: the guard waits for all the work's threads.
    await expect(s.engine.requestReview(s.id, 3)).rejects.toThrow("reviewers are still working — wait or press «Stop reviewers»");
    for (const r of reviewers(s)) s.ports.idle(r.thread_id);
    await s.engine.requestReview(s.id, 3);
    const all = reviewers(s);
    expect(all.filter((r) => r.round === 1).every((r) => r.invalid_reason === "replaced by a new review round")).toBe(true);
    expect(all.filter((r) => r.round === 2)).toHaveLength(2);
  });

  it("refuses a review while the stage agent works, and where there is no review", async () => {
    const s = await onTz();
    await s.ports.send(s.tz, "one more question");
    await expect(s.engine.requestReview(s.id, 3)).rejects.toThrow("the work's agent is still working");
    s.ports.idle(s.tz);
    await moveTo(s, 4);
    await expect(s.engine.requestReview(s.id, 4)).rejects.toThrow(`the «${stageOf(4).title}» stage has no review`);
  });

  it("fills in a reviewer whose spawn failed, in the same round", async () => {
    const s = await onTz();
    s.ports.failSpawnNumber = 4; // 1 — Context, 2 — Spec, 3 — Fable, 4 — Astra
    await expect(s.engine.requestReview(s.id, 3)).rejects.toThrow("spawn failed");
    const facts = await s.engine.gateFacts(s.store.work(s.id)!, await versionOf(s));
    expect(facts.reviews).toEqual([
      { who: "Fable 5.1", round: 1, started: true, verdict: null, invalid: null },
      { who: "GPT-6-Astra", round: 1, started: false, verdict: null, invalid: null },
    ]);
    await expect(s.engine.requestReview(s.id, 3)).rejects.toThrow("not confirmed yet");
    s.ports.t += 6 * 60_000;
    s.ports.idle(reviewers(s)[0]!.thread_id);
    await s.engine.requestReview(s.id, 3);
    expect(reviewers(s).map((r) => [r.who, r.round])).toEqual([["fable", 1], ["astra", 1]]);
    expect(reviewers(s).every((r) => r.invalid_reason === null)).toBe(true);
  });

  it("closes reviews by their files, tells the stage agent once, stops the reviewers", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    for (const r of reviewers(s)) reviewDone(s, r);
    await s.engine.reconcile(s.id);
    await s.engine.reconcile(s.id);
    expect(reviewers(s).filter((r) => r.done_at === null)).toEqual([]);
    expect(s.ports.stopped).toEqual(expect.arrayContaining(reviewers(s).map((r) => r.thread_id)));
    expect(readyMessages(s)).toEqual([{ threadId: s.tz, text: reviewsReady(s.store.work(s.id)!, roundFiles(s, "tz")) }]);
  });

  it("invalidates a review when HEAD moved under it", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    const fable = reviewers(s).find((r) => r.who === "fable")!;
    reviewDone(s, fable);
    commitWork(s, "h2");
    await s.engine.reconcile(s.id);
    expect(s.store.run(fable.thread_id)!.invalid_reason).toBe("the code changed during the review (h1 → h2)");
  });

  it("lets the owner stop hung reviewers", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    await s.engine.stopReviews(s.id, 3);
    expect(reviewers(s).every((r) => r.done_at !== null && r.invalid_reason === "stopped by the owner")).toBe(true);
    await expect(s.engine.stopReviews(s.id, 2)).rejects.toThrow("the stage has already changed");
  });

  it("does not close a living reviewer on a transient status error", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    const fable = reviewers(s).find((r) => r.who === "fable")!;
    reviewDone(s, fable);
    s.ports.statusFails.add(fable.thread_id);
    await s.engine.reconcile(s.id);
    expect(s.store.run(fable.thread_id)!.done_at).toBeNull();
    expect(s.store.work(s.id)!.state).toBe("error");
    s.ports.statusFails.clear();
    await s.engine.reconcile(s.id);
    expect(s.store.run(fable.thread_id)!.done_at).not.toBeNull();
  });

  it("tells the stage agent nothing until both reviewers are done; on stage 5 the verifier gets the files once it is idle", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    reviewDone(s, reviewers(s).find((r) => r.who === "fable")!);
    await s.engine.reconcile(s.id);
    expect(readyMessages(s)).toHaveLength(0);
    await s.engine.stopReviews(s.id, 3);
    await moveTo(s, 5);
    const verifier = s.store.stageThread(s.id, 5)!.thread_id;
    await s.engine.requestReview(s.id, 5);
    for (const r of reviewers(s, 5)) reviewDone(s, r);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 5).filter((x) => x.done_at === null)).toEqual([]);
    expect(readyMessages(s)).toHaveLength(0);
    const toVerifier = s.ports.sent.filter((m) => m.threadId === verifier);
    expect(toVerifier).toHaveLength(1);
    expect(toVerifier[0]!.text).toBe(reviewsForVerifier(s.store.work(s.id)!, roundFiles(s, "verify"), 1));
    expect(toVerifier[0]!.text).toContain("verify-r1.md");
    // Another reconcile — no second message.
    s.ports.idle(verifier);
    await s.engine.reconcile(s.id);
    expect(s.ports.sent.filter((m) => m.threadId === verifier)).toHaveLength(1);
  });

  it("does not interrupt a busy agent with the review files: they go once it finished its turn", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    const tz = s.store.stageThread(s.id, 3)!.thread_id;
    s.ports.threads.get(tz)!.status = "active";
    for (const r of reviewers(s)) reviewDone(s, r);
    await s.engine.reconcile(s.id);
    expect(readyMessages(s)).toHaveLength(0);
    s.ports.idle(tz);
    await s.engine.reconcile(s.id);
    expect(readyMessages(s)).toHaveLength(1);
  });

  it("retries the reviews-ready message after a failed send, exactly once", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    for (const r of reviewers(s)) reviewDone(s, r);
    s.ports.sendFails = 1;
    await s.engine.reconcile(s.id);
    expect(readyMessages(s)).toHaveLength(0);
    await s.engine.reconcile(s.id);
    await s.engine.reconcile(s.id);
    expect(readyMessages(s)).toHaveLength(1);
  });

  it("tells a reviewer it is a reviewer before its run row exists — configure fires before recordRun", async () => {
    const s = await onTz();
    await s.engine.requestReview(s.id, 3);
    const astra = reviewers(s).find((r) => r.who === "astra")!;
    expect(s.ports.threads.get(astra.thread_id)!.metadata).toMatchObject({ workId: s.id, stage: 3, role: "review", who: "astra" });
    const w = s.store.work(s.id)!;
    expect(s.engine.identityOf("thr_unknown", { workId: s.id, stage: 3, role: "review", who: "astra" })).toBe(identity(w, stageOf(3), "review"));
    expect(s.engine.identityOf("thr_unknown", { workId: s.id, stage: 5, role: "review", who: "fable" })).toBe(identity(w, stageOf(5), "review"));
    expect(s.engine.identityOf(astra.thread_id, null)).toBe(identity(w, stageOf(3), "review"));
    const plain = s.engine.identityOf("thr_unknown", { workId: s.id });
    expect(plain).toBe(identity(w, stageOf(3), "stage"));
    expect(s.engine.identityOf("thr_unknown", { workId: s.id, stage: 6 })).toBe(identity(w, stageOf(6), "stage"));
    // The metadata is untrusted: invalid values count as absent.
    expect(s.engine.identityOf("thr_unknown", { workId: s.id, stage: 7 })).toBe(identity(w, stageOf(7), "stage"));
    expect(s.engine.identityOf("thr_unknown", { workId: s.id, stage: 8, role: "boss" })).toBe(plain);
    expect(s.engine.identityOf("thr_unknown", { workId: s.id, stage: 0, role: "stage" })).toBe(plain);
    expect(s.engine.identityOf("thr_unknown", { workId: s.id, stage: "5", role: "review" })).toBe(identity(w, stageOf(3), "review"));
    expect(s.engine.identityOf("thr_unknown", { workId: "w_nope", stage: 1, role: "review" })).toBeNull();
    expect(s.engine.identityOf("thr_unknown", null)).toBeNull();
  });
});

describe("Engine: reconcile", () => {
  it("finishes a spawn interrupted by a crash with a new engine over the same store", async () => {
    const s = setup();
    const id = await madeWork(s);
    s.ports.spawnThenThrow = true;
    s.ports.findFails = 1;
    await s.engine.reconcile(id);
    expect(s.store.stageThread(id, 1)).toBeNull();
    expect(s.store.entry(s.store.work(id)!)?.error).toBeTruthy();
    s.ports.spawnThenThrow = false;
    const restarted = new Engine(s.store, s.ports, () => ({ maxBuilding: 2, minFreeDiskGb: 2 }));
    await restarted.reconcile(id);
    expect(s.ports.threads.size).toBe(1);
    expect(s.store.stageThread(id, 1)).not.toBeNull();
    expect(s.store.work(id)).toMatchObject({ entry: null, environment_id: "env_1" });
    expect(s.ports.sent).toEqual([]);
  });

  it("adopts a thread that showed up only after the failed spawn call, never spawning a second", async () => {
    const s = setup();
    const id = await madeWork(s);
    s.ports.spawnThenThrow = true;
    s.ports.findMisses = 1;
    await s.engine.reconcile(id);
    expect(s.store.stageThread(id, 1)).toBeNull();
    s.ports.spawnThenThrow = false;
    await s.engine.reconcile(id);
    expect(s.ports.threads.size).toBe(1);
    expect(s.store.stageThread(id, 1)).not.toBeNull();
    expect(s.store.work(id)!.entry).toBeNull();
  });

  it("derives the card state, marks stale and survives a dead machine", async () => {
    const s = await started();
    const context = idleStage(s);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "owner", stale: 0 });
    s.ports.files.set(`${s.env}:${s.docs.context}`, "v1");
    await s.ports.send(context, "clarify");
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "agent", state_reason: "agent at work" });
    s.ports.idle(context);
    expect((await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "v2");
    idleStage(s, 2);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ stale: 1, state: "owner" });
    s.ports.machineDown = true;
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "machine", state_reason: "machine unavailable: machine not responding" });
    s.ports.machineDown = false;
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("owner");
  });

  it("at Rollout a commit after the rollout makes Verification stale and blocks «Accept»", async () => {
    const s = await started();
    idleStage(s);
    const v = await versionOf(s);
    for (const stage of [3, 4, 5]) s.store.addHandover({ work_id: s.id, stage, action: "forward", to_stage: stage + 1, version: v, note: "", forced: false, problems: [], at: 1 });
    await entered(s);
    s.ports.files.set(`${s.env}:${livePath(s.key, 1)}`, "all works\nVERDICT: PASS");
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ stale: 0, state: "owner" });
    expect((await s.engine.view(s.id)).blockers).toEqual([]);
    commitWork(s, "h2");
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.stale).toBe(1);
    const view = await s.engine.view(s.id);
    // The spec does not rest on the code: Implementation and Verification went stale.
    expect(view.stages.filter((x) => x.stale).map((x) => x.no)).toEqual([4, 5]);
    expect(view.blockers).toContain(`«${stageOf(5).title}» is stale: what you approved has changed since`);
    expect(view.blockers).toContain("the live check report is unusable: the code changed (h1 → h2)");
  });

  it("starts a queued build once a slot frees up", async () => {
    const s = setup(1);
    const a = await madeWork(s, { pluginId: "a" });
    const b = await madeWork(s, { pluginId: "b" });
    s.store.casStage(a, 1, 4, 1, 1);
    s.store.tx(() => {
      s.store.casStage(b, 1, 4, 1, 1);
      s.store.setQueued(b, true, 1);
      s.store.setEntry(b, { key: "eb", stage: 4, from: 3, packet: null, error: null }, 1);
    });
    await s.engine.reconcile(b);
    expect(s.store.work(b)).toMatchObject({ queued: 1, state: "queued", state_reason: "waiting for a free slot on the machine" });
    expect(s.store.stageThread(b, 4)).toBeNull();
    s.store.finish(a, "canceled", 2);
    await s.engine.reconcile(b);
    expect(s.store.work(b)).toMatchObject({ queued: 0, entry: null });
    expect(s.store.stageThread(b, 4)).not.toBeNull();
    expect(s.store.events(b).map((e) => e.text)).toContain("a slot on the machine freed up");
  });

  it("does not count works on stages 1–3 and 6 against the build limit", async () => {
    const s = setup(1);
    for (const [p, stage] of [["a", 3], ["b", 6]] as const) s.store.casStage(await madeWork(s, { pluginId: p }), 1, stage, 1, 1);
    const c = await madeWork(s, { pluginId: "c" });
    s.store.tx(() => {
      s.store.casStage(c, 1, 4, 1, 1);
      s.store.setEntry(c, { key: "ec", stage: 4, from: 3, packet: null, error: null }, 1);
    });
    await s.engine.reconcile(c);
    expect(s.store.work(c)).toMatchObject({ queued: 0, entry: null });
  });

  it("says the worktree is gone instead of a generic reconcile error", async () => {
    const s = await started();
    idleStage(s);
    s.ports.gone.add(s.env);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: "the work's worktree was removed — cancel the work" });
  });

  it("retries cleanup of a finished work and keeps its card final", async () => {
    const s = await started();
    idleStage(s);
    s.ports.archiveFails = true;
    await s.engine.cancel(s.id, "x");
    expect(s.store.work(s.id)).toMatchObject({ state: "canceled", cleanup_done: 0 });
    s.ports.archiveFails = false;
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "canceled", cleanup_done: 1 });
  });

  it("speaks of a failed enter until the owner decides — catalog syncs are not a decision — then lets the machine speak", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    const a = attempt(s, { status: "failed", step: "moved" });
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: "rollout failed: the working copy is unchanged" });
    s.ports.t += 10 * 60_000;
    s.store.setLastState(s.store.work(s.id)!.plugin_id, { state: "disabled", enabled: false }, s.ports.now());
    await s.engine.reconcile(s.id);
    // The working copy is intact — no advice to roll back; a disabled plugin does not count as the owner's decision.
    expect(s.store.work(s.id)).toMatchObject({ state: "error", state_reason: "rollout failed: the working copy is unchanged" });
    expect(s.store.resolveAttempt(a, s.ports.now())).toBe(true);
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("owner");
    s.ports.machineDown = true;
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("machine");
  });
});

describe("Engine: views", () => {
  it("serves the board, the work view and only allowed files — from the snapshot once finished", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# context");
    s.ports.files.set(`${s.env}:${s.docs.tech}`, "checked\nVERDICT: OK_WITH_CAVEATS");
    await s.engine.reconcile(s.id);
    expect(s.engine.board()[0]).toMatchObject({ id: s.id, key: s.key, stage: 1, state: "owner", projectId: "p1" });
    const view = await s.engine.view(s.id);
    expect(view.stages).toHaveLength(6);
    expect(view.stages[0]!.files.map((f) => f.path)).toEqual([s.docs.context]);
    expect(view.stages[1]!.files).toEqual([{ path: s.docs.tech, label: "Feasibility", verdict: "caveats" }]);
    expect(view.blockers).toEqual([]);
    expect(view.version).toMatchObject({ iteration: 1, headSha: "h1" });
    expect(view.work).toMatchObject({ key: s.key, stage: 1, canRestart: false, projectId: "p1" });
    expect((await s.engine.file(s.id, s.docs.context)).text).toBe("# context");
    expect((await s.engine.file(s.id, s.docs.tech)).text).toContain("VERDICT");
    await expect(s.engine.file(s.id, "../../etc/passwd")).rejects.toThrow("this file cannot be opened");
    await expect(s.engine.file(s.id, "src/secret.ts")).rejects.toThrow("this file cannot be opened");
    await expect(s.engine.file(s.id, `docs/workshop/${s.key}/../../secret.md`)).rejects.toThrow("this file cannot be opened");
    await expect(s.engine.file(s.id, `.superpowers/workshop/${s.key}/../../secret.md`)).rejects.toThrow("this file cannot be opened");
    await expect(s.engine.file(s.id, ".superpowers/workshop/OTHER-1/x.md")).rejects.toThrow("this file cannot be opened");
    await expect(s.engine.file(s.id, verifyPath(s.key, 1))).rejects.toThrow("no such file");
    const shot = `.superpowers/workshop/${s.key}/shots/desktop.png`;
    s.ports.files.set(`${s.env}:${shot}`, "png");
    s.ports.files.set(`${s.env}:${livePath(s.key, 1)}`, "VERDICT: PASS");
    await s.engine.cancel(s.id, "x");
    s.ports.files.clear();
    expect((await s.engine.file(s.id, s.docs.context)).text).toBe("# context");
    expect((await s.engine.file(s.id, shot)).text).toBe("png");
    const done = await s.engine.view(s.id);
    expect(done.version).toBeNull();
    expect(done.stages[0]!.files.map((f) => f.path)).toEqual([s.docs.context]);
    expect(done.stages.find((x) => x.no === 6)!.files.map((f) => f.path)).toContain(shot);
    expect(done.work).toMatchObject({ outcome: "canceled", stage: 1 });
  });
});
