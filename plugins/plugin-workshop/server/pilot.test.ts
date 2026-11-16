// The work's autopilot: the orchestrator runs the work to the end on the owner's behalf, acting through the same methods as the buttons.
import { describe, expect, test, vi } from "vitest";
import { Catalog } from "./catalog";
import { Engine } from "./engine";
import { MAX_ACTIONS, MIN_FORCE_REASON, Pilot, QUIET_MS } from "./pilot";
import { Rollout } from "./rollout";
import { livePath, ownerPath, verifyPath } from "./stages";
import { commitWork, entered, idleStage, moveTo, reviewed, setup, started, versionOf, type Started } from "./test-utils";
import { GITHUB_TOKEN } from "./test-tokens";

async function rig(s?: Started) {
  const r = s ?? (await started());
  const catalog = new Catalog(r.store, r.ports);
  const rollout = new Rollout(r.store, r.ports, r.engine, catalog, { cancelSupported: true });
  const pilot = new Pilot(r.store, r.ports, r.engine, rollout);
  return { ...r, catalog, rollout, pilot };
}
type Rig = Awaited<ReturnType<typeof rig>>;
const pilotThread = (r: Rig) => r.store.pilot(r.id)!.thread_id!;
const sentTo = (r: Rig, thread: string) => r.ports.sent.filter((m) => m.threadId === thread);
/** The work waits for the owner: the stage agent finished its turn; the orchestrator is free; the engine's and the autopilot's reconciles ran. */
async function waiting(r: Rig): Promise<string> {
  const t = idleStage(r);
  r.ports.idle(pilotThread(r));
  await r.engine.reconcile(r.id);
  await r.pilot.tick(r.id);
  return t;
}

describe("start and the orchestrator's thread", () => {
  test("start spawns the orchestrator in its own worktree with the rules, the request and the state; only it gets the tools", async () => {
    const r = await rig(await started(undefined, { request: "Make a notes dashboard" }));
    await r.pilot.start(r.id, "no paid services");
    const p = r.store.pilot(r.id)!;
    expect(p).toMatchObject({ state: "on", notes: "no paid services", actions: 0 });
    const th = r.ports.threads.get(p.thread_id!)!;
    expect(th.metadata).toMatchObject({ workId: r.id, role: "pilot", opKey: p.op_key, stage: 0 });
    expect(th.environment.kind).toBe("new-worktree");
    expect(th.title).toBe(`${r.key} · Autopilot`);
    expect(th.prompt).toContain("You are the autopilot orchestrator");
    expect(th.prompt).toContain("Make a notes dashboard");
    expect(th.prompt).toContain("no paid services");
    expect(th.prompt).toContain("State:");
    expect([...r.ports.taskRows.values()].flatMap((t) => t.comments).some((c) => c.startsWith("Autopilot started"))).toBe(true);
    await expect(r.pilot.start(r.id, "")).rejects.toThrow("the autopilot is already running this work");
    // Only its thread gets the note and the tools: by the record; the spawn key in the metadata — only while the spawn is pending.
    expect(r.pilot.identity(p.thread_id!, {})).toContain("autopilot orchestrator of work");
    expect(r.pilot.identity("thr_other", { role: "pilot", workId: r.id, opKey: "foreign" })).toBeNull();
    await expect(r.pilot.statusTool("thr_other")).rejects.toThrow("only in a work's orchestrator thread");
    expect(await r.pilot.statusTool(p.thread_id!)).toContain(`Work ${r.key}`);
  });

  test("copied metadata gets no tools once the orchestrator's thread is recorded; while the spawn is pending the spawn key is enough", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    const p = r.store.pilot(r.id)!;
    const copied = { role: "pilot", workId: r.id, opKey: p.op_key };
    // Any API client or agent can write a thread's metadata: with the thread id recorded, a copy of the spawn metadata is not the autopilot.
    expect(r.pilot.identity("thr_copy", copied)).toBeNull();
    expect(r.pilot.identity(p.thread_id!, copied)).not.toBeNull();
    // configure runs at thread start, before spawn returns the id: then the spawn key identifies the new thread.
    r.store.patchPilot(r.id, { thread_id: null, spawned_at: r.ports.now() }, r.ports.now());
    expect(r.pilot.identity("thr_new", copied)).not.toBeNull();
    expect(r.pilot.identity("thr_new", { ...copied, opKey: "pilot:other" })).toBeNull();
    // Never spawned: nothing is pending.
    r.store.patchPilot(r.id, { spawned_at: null }, r.ports.now());
    expect(r.pilot.identity("thr_new", copied)).toBeNull();
  });
});

describe("waking", () => {
  test("the work waits for the owner — one wake with the state; the same situation does not wake twice", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    const before = sentTo(r, pilotThread(r)).length;
    await waiting(r);
    const wakes = sentTo(r, pilotThread(r)).slice(before);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]!.text).toContain("State: owner");
    expect(wakes[0]!.text).toContain("Actions: forward");
    await r.pilot.tick(r.id);
    expect(sentTo(r, pilotThread(r)).length).toBe(before + 1);
  });

  test("an answer goes to the stage agent as the owner's word; after its next turn the orchestrator is woken again", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    const stage = await waiting(r);
    const n = sentTo(r, pilotThread(r)).length;
    expect(await r.pilot.actTool(pilotThread(r), { action: "answer", text: "Badge colour — grey" })).toBe("answer sent to the stage agent");
    expect(sentTo(r, stage).at(-1)!.text).toBe("Owner (autopilot): Badge colour — grey");
    expect(r.store.pilot(r.id)!.actions).toBe(1);
    // The agent is working — no wake.
    await r.pilot.tick(r.id);
    expect(sentTo(r, pilotThread(r)).length).toBe(n);
    await waiting(r);
    expect(sentTo(r, pilotThread(r)).length).toBe(n + 1);
  });

  test("wait holds the wake until the situation changes; silence — a reminder, then a stop", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    await waiting(r);
    expect(await r.pilot.actTool(pilotThread(r), { action: "wait", text: "waiting for the reviews" })).toContain("waiting");
    const n = sentTo(r, pilotThread(r)).length;
    r.ports.t += QUIET_MS + 1;
    await r.pilot.tick(r.id);
    expect(sentTo(r, pilotThread(r)).length).toBe(n);

    const s = await rig();
    await s.pilot.start(s.id, "");
    await waiting(s);
    const m = sentTo(s, pilotThread(s)).length;
    // The orchestrator ended its turn without doing anything.
    s.ports.idle(pilotThread(s));
    s.ports.t += QUIET_MS + 1;
    await s.pilot.tick(s.id);
    expect(sentTo(s, pilotThread(s)).at(-1)!.text).toContain("Reminder");
    expect(sentTo(s, pilotThread(s)).length).toBe(m + 1);
    s.ports.idle(pilotThread(s));
    s.ports.t += QUIET_MS + 1;
    await s.pilot.tick(s.id);
    expect(s.store.pilot(s.id)).toMatchObject({ state: "stopped", reason: "the orchestrator does not respond to wakes" });
  });
});

describe("actions through the gates", () => {
  test("forward goes through the stage gate: blockers come back in words; with context.md the work moves on", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    await waiting(r);
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward" })).toContain(`not handed over. Blockers: no ${r.docs.context}`);
    expect(r.store.work(r.id)!.stage).toBe(1);
    r.ports.files.set(`${r.env}:${r.docs.context}`, "# Context\n");
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward", text: "context complete" })).toBe("handed over");
    expect(r.store.work(r.id)!.stage).toBe(2);
    expect(r.store.handovers(r.id).at(-1)!.note).toBe("autopilot: context complete");
    expect(r.store.events(r.id).some((e) => e.kind === "pilot" && e.text.startsWith("autopilot: handed over the «Context» stage"))).toBe(true);
  });

  test("a red check goes back to Implementation and counts; the third red in a row stops instead of returning", async () => {
    const r = await rig();
    idleStage(r);
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await moveTo(r, 5);
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 1)}`, "broken\nVERDICT: FAIL");
    reviewed(r, 5, "verify", await versionOf(r));
    await r.pilot.start(r.id, "");
    r.ports.idle(pilotThread(r));
    expect(await r.pilot.actTool(pilotThread(r), { action: "report_back" })).toBe("done");
    expect(r.store.work(r.id)!.stage).toBe(4);
    expect(r.store.pilot(r.id)!.reds).toBe(1);

    const s = await rig();
    idleStage(s);
    await moveTo(s, 5);
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "broken\nVERDICT: FAIL");
    reviewed(s, 5, "verify", await versionOf(s));
    await s.pilot.start(s.id, "");
    s.store.patchPilot(s.id, { reds: 2 }, s.ports.now());
    expect(await s.pilot.actTool(pilotThread(s), { action: "report_back" })).toContain("third red check in a row");
    expect(s.store.work(s.id)!.stage).toBe(5);
    expect(s.store.pilot(s.id)!.state).toBe("stopped");
  });

  test("after an answer the same situation does not wake twice while the agent has not started; after 10 quiet minutes it does, saying so", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    const stage = await waiting(r);
    await r.pilot.actTool(pilotThread(r), { action: "answer", text: "yes" });
    // The stage agent never started its turn (VesnALIA's queue): the thread is free again, the stamp comes from our message.
    r.ports.threads.get(stage)!.status = "idle";
    r.ports.idle(pilotThread(r));
    await r.engine.reconcile(r.id);
    const n = sentTo(r, pilotThread(r)).length;
    await r.pilot.tick(r.id);
    expect(sentTo(r, pilotThread(r)).length).toBe(n);
    r.ports.t += QUIET_MS + 1;
    await r.pilot.tick(r.id);
    expect(sentTo(r, pilotThread(r)).at(-1)!.text).toContain("the situation has not changed");
  });

  test("a red live check after an entry still counts: reds reset only on acceptance", async () => {
    const r = await rig();
    idleStage(r);
    await moveTo(r, 5);
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 1)}`, "ok\nVERDICT: PASS");
    r.ports.files.set(`${r.env}:${ownerPath(r.key)}`, "- [x] nothing needed — checked\n");
    reviewed(r, 5, "verify", await versionOf(r));
    r.ports.plugins.add({ id: "hello" });
    await r.pilot.start(r.id, "");
    r.store.patchPilot(r.id, { reds: 2 }, r.ports.now());
    r.ports.idle(pilotThread(r));
    expect(await r.pilot.actTool(pilotThread(r), { action: "enter" })).toBe("rollout started");
    expect(r.store.pilot(r.id)!.reds).toBe(2);
  });

  test("too many actions in one run stop the autopilot", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    await waiting(r);
    r.store.patchPilot(r.id, { actions: MAX_ACTIONS - 1 }, r.ports.now());
    await r.pilot.actTool(pilotThread(r), { action: "answer", text: "ok" });
    expect(r.store.pilot(r.id)).toMatchObject({ state: "stopped" });
    expect(r.store.pilot(r.id)!.reason).toContain("going in circles");
  });
});

describe("owner, end of the work, failures", () => {
  test("an owner's button pauses the autopilot; its actions are refused until «Resume autopilot»", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    await r.pilot.ownerActed(r.id, "Next");
    expect(r.store.pilot(r.id)).toMatchObject({ state: "paused" });
    expect(r.store.pilot(r.id)!.reason).toContain("the owner pressed «Next»");
    await expect(r.pilot.actTool(pilotThread(r), { action: "wait" })).rejects.toThrow("paused");
    await r.pilot.resume(r.id);
    expect(r.store.pilot(r.id)!.state).toBe("on");
    await r.pilot.stopByOwner(r.id);
    expect(r.store.pilot(r.id)).toMatchObject({ state: "stopped", reason: "stopped by the owner" });
  });

  test("a canceled work stops the autopilot; an accepted one gets the final report and the orchestrator's thread is archived", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    idleStage(r);
    await r.engine.cancel(r.id, "not needed");
    await r.pilot.tick(r.id);
    expect(r.store.pilot(r.id)).toMatchObject({ state: "done", reason: "the work was canceled" });
    expect(r.ports.archived).toContain(pilotThread(r));

    const s = await rig();
    await s.pilot.start(s.id, "");
    s.ports.idle(pilotThread(s));
    s.store.finish(s.id, "done", s.ports.now());
    await s.pilot.tick(s.id);
    expect(sentTo(s, pilotThread(s)).at(-1)!.text).toContain("Write the final report");
    expect(await s.pilot.actTool(pilotThread(s), { action: "report", text: "Done: the notes section. Decided for the owner: badge colour grey." })).toBe("report recorded");
    expect(s.store.pilot(s.id)).toMatchObject({ state: "done", report: "Done: the notes section. Decided for the owner: badge colour grey." });
    expect(s.ports.archived).toContain(pilotThread(s));
    expect([...s.ports.taskRows.values()].flatMap((t) => t.comments).some((c) => c.startsWith("Autopilot report"))).toBe(true);
  });

  test("the orchestrator's thread fails — a new one; fails again — stop", async () => {
    const r = await rig();
    await r.pilot.start(r.id, "");
    const first = pilotThread(r);
    r.ports.threads.get(first)!.status = "error";
    await r.pilot.tick(r.id);
    const second = pilotThread(r);
    expect(second).not.toBe(first);
    expect(r.store.pilot(r.id)!.thread_failures).toBe(1);
    r.ports.threads.get(second)!.status = "error";
    await r.pilot.tick(r.id);
    expect(r.store.pilot(r.id)).toMatchObject({ state: "stopped", reason: "the orchestrator thread crashed twice" });
  });
});

describe("hard stops: enforced before the action, not lifted by the orchestrator's force", () => {
  const REASON = "safe: the owner's notes allow exactly this";
  /** A work at Verification with a green report and reviews, the plugin installed — «Roll out» is open (like `ready` in the Rollout tests). */
  async function atVerification(): Promise<Rig> {
    const r = await rig();
    idleStage(r);
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await moveTo(r, 5);
    r.ports.files.set(`${r.env}:${verifyPath(r.key, 1)}`, "ok\nVERDICT: PASS");
    r.ports.files.set(`${r.env}:${ownerPath(r.key)}`, "- [x] nothing needed — checked\n");
    reviewed(r, 5, "verify", await versionOf(r));
    r.ports.plugins.add({ id: "hello" });
    await r.pilot.start(r.id, "");
    r.ports.idle(pilotThread(r));
    return r;
  }

  test("force needs a reason of at least 20 characters; the lifted warnings and the reason go to the journal", async () => {
    const r = await rig();
    idleStage(r);
    await moveTo(r, 4);
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\n### Task 2: B\nMIGRATIONS: no\nNAV: none\n");
    r.ports.files.set(`${r.env}:${ownerPath(r.key)}`, "- [x] nothing needed — checked\n");
    r.ports.files.set(`${r.env}:.superpowers/sdd/tz/progress.md`, "Task 1: complete\n");
    await r.pilot.start(r.id, "");
    r.ports.idle(pilotThread(r));
    await expect(r.pilot.actTool(pilotThread(r), { action: "forward", force: true })).rejects.toThrow(`at least ${MIN_FORCE_REASON} characters`);
    await expect(r.pilot.actTool(pilotThread(r), { action: "forward", force: true, text: "fine" })).rejects.toThrow("force needs a reason");
    expect(r.store.work(r.id)!.stage).toBe(4);
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward", force: true, text: REASON })).toBe("handed over");
    expect(r.store.work(r.id)!.stage).toBe(5);
    const line = r.store.events(r.id).find((e) => e.kind === "pilot" && e.text.startsWith("autopilot: handed over the «Implementation» stage"))!.text;
    expect(line).toContain("despite warnings: 1 of 2 plan tasks done");
    expect(line).toContain(REASON);
  });

  test("an IMPOSSIBLE verdict stops the autopilot at Feasibility; the owner's «Hand over anyway» still passes it", async () => {
    const r = await rig();
    idleStage(r);
    await moveTo(r, 2);
    r.ports.files.set(`${r.env}:${r.docs.tech}`, "it cannot be done\nVERDICT: IMPOSSIBLE");
    r.ports.files.set(`${r.env}:${ownerPath(r.key)}`, "- nothing\n");
    await r.pilot.start(r.id, "");
    r.ports.idle(pilotThread(r));
    const answer = await r.pilot.actTool(pilotThread(r), { action: "forward", force: true, text: REASON });
    expect(answer).toContain("hard stop");
    expect(r.store.work(r.id)!.stage).toBe(2);
    expect(r.store.pilot(r.id)).toMatchObject({ state: "stopped" });
    expect(r.store.pilot(r.id)!.reason).toContain("IMPOSSIBLE");
    expect([...r.ports.taskRows.values()].flatMap((t) => t.comments).some((c) => c.startsWith("Autopilot stopped") && c.includes("IMPOSSIBLE"))).toBe(true);
    // The owner's force semantics are unchanged: the verdict is a warning for them.
    expect(await r.engine.handOver(r.id, { expectedStage: 2, expectedVersion: await versionOf(r), note: "", force: true })).toMatchObject({ ok: true });
  });

  test("open owner.md items stop the autopilot on the way into Implementation, not before it", async () => {
    const r = await rig();
    idleStage(r);
    await moveTo(r, 2);
    r.ports.files.set(`${r.env}:${r.docs.tech}`, "fine\nVERDICT: OK");
    r.ports.files.set(`${r.env}:${ownerPath(r.key)}`, "- [ ] API key of the service\n- [x] account — checked: signed in\n");
    await r.pilot.start(r.id, "");
    r.ports.idle(pilotThread(r));
    // Feasibility → Spec does not enter Implementation.
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward" })).toBe("handed over");
    expect(r.store.work(r.id)!.stage).toBe(3);
    // Spec → Implementation (the Mockup stage is off in this setup): a hard stop, with force or without.
    const answer = await r.pilot.actTool(pilotThread(r), { action: "forward", force: true, text: REASON });
    expect(answer).toContain("owner.md has open items");
    expect(r.store.work(r.id)!.stage).toBe(3);
    expect(r.store.pilot(r.id)!.state).toBe("stopped");
    expect(r.store.pilot(r.id)!.reason).toContain("API key of the service");
  });

  test("a key finding on the work branch stops «Roll out» whatever the force; the owner sees the same finding as a blocker", async () => {
    const r = await atVerification();
    // A new commit with a key, not checked yet: the hard stop runs the check itself (scan only — nothing is pushed).
    commitWork(r, "h9");
    r.ports.git.commitFiles.set("h9", { "src/a.ts": `export const t = "${GITHUB_TOKEN}";\n` });
    const answer = await r.pilot.actTool(pilotThread(r), { action: "enter", force: true, text: REASON });
    expect(answer).toContain("looks like it contains keys");
    expect(r.store.work(r.id)!.stage).toBe(5);
    expect(r.store.currentAttempt("hello")).toBeFalsy();
    expect(r.store.pilot(r.id)).toMatchObject({ state: "stopped" });
    expect(await r.ports.github.remoteSha(r.dir, `alia/${r.env}`)).not.toBe("h9");
    expect((await r.engine.view(r.id)).blockers.some((b) => b.includes("looks like it contains keys"))).toBe(true);
  });

  test("an incomplete publication check — only a warning for the owner — is a hard stop for the autopilot", async () => {
    const r = await rig();
    r.ports.files.set(`${r.env}:${r.docs.context}`, "# Context\n");
    await r.pilot.start(r.id, "");
    await waiting(r);
    // The reconcile's push could not scan the new commit: its verdict is `failed`.
    commitWork(r, "h2");
    r.ports.github.logFails = "git log: exit 128";
    await r.engine.reconcile(r.id);
    expect(r.store.work(r.id)!.gh_scan).toContain('"state":"failed"');
    const answer = await r.pilot.actTool(pilotThread(r), { action: "forward" });
    expect(answer).toContain("the publication check of the work branch did not complete");
    expect(r.store.work(r.id)!.stage).toBe(1);
    expect(r.store.pilot(r.id)!.state).toBe("stopped");
    // A verdict about an older commit does not hold the current one: without a verdict the check runs now, and a clean one lets it through.
    const s = await rig();
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# Context\n");
    await s.pilot.start(s.id, "");
    await waiting(s);
    commitWork(s, "h2");
    expect(JSON.parse(s.store.work(s.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "clean" });
    expect(await s.pilot.actTool(pilotThread(s), { action: "forward" })).toBe("handed over");
    expect(JSON.parse(s.store.work(s.id)!.gh_scan!)).toMatchObject({ sha: "h2", state: "clean" });
  });

  test("a failure on the way to GitHub — the first push of main, the destination — is the commit's verdict: a warning for the owner, a hard stop for the autopilot", async () => {
    // The destination is public: nothing is pushed, and the refusal is recorded as `failed`.
    const r = await rig();
    await r.ports.github.setRemote(r.dir, "https://github.com/acme/bb-plugin-hello.git");
    r.ports.github.repoInfos.set("acme/alia-plugin-hello", { visibility: "PUBLIC", owner: "acme", nameWithOwner: "acme/alia-plugin-hello" });
    r.ports.files.set(`${r.env}:${r.docs.context}`, "# Context\n");
    await r.pilot.start(r.id, "");
    await waiting(r);
    expect(JSON.parse(r.store.work(r.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "failed", text: expect.stringContaining("is public") });
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward" })).toContain("stopped: the publication check of the work branch did not complete");
    expect(r.store.work(r.id)!.stage).toBe(1);
    // The first push of main finds a key in main's history: the work branch's commit gets `failed` with that reason, not only a journal line.
    const s = await rig();
    s.ports.git.commitFiles.set((await s.ports.git.facts(s.dir)).head!, { "old.ts": `const t = "${GITHUB_TOKEN}";\n` });
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# Context\n");
    await s.pilot.start(s.id, "");
    await waiting(s);
    expect(JSON.parse(s.store.work(s.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "failed", text: expect.stringContaining("main looks like it contains keys") });
    expect(await s.pilot.actTool(pilotThread(s), { action: "forward" })).toContain("stopped: the publication check of the work branch did not complete: main looks like it contains keys");
  });

  test("no verdict even after the synchronous check is a hard stop with the reason", async () => {
    const r = await rig();
    r.ports.files.set(`${r.env}:${r.docs.context}`, "# Context\n");
    await r.pilot.start(r.id, "");
    await waiting(r);
    vi.spyOn(r.engine, "ensureScan").mockResolvedValue({ state: "unscanned", text: "the work branch has no commit to check" });
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward" })).toContain("stopped: the work branch's current commit has no publication verdict: the work branch has no commit to check");
    expect(r.store.work(r.id)!.stage).toBe(1);
  });

  test("with GitHub off no publication condition applies: no check runs, nothing stops the autopilot", async () => {
    const base = setup();
    const off = { ...base, engine: new Engine(base.store, base.ports, () => ({ maxBuilding: 2, minFreeDiskGb: 2, autoReview: false, mockup: false, githubOwner: "" })) };
    const r = await rig(await started(off));
    r.ports.files.set(`${r.env}:${r.docs.context}`, "# Context\n");
    await r.pilot.start(r.id, "");
    await waiting(r);
    const scan = vi.spyOn(r.ports.github, "logLines");
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward" })).toBe("handed over");
    expect(scan).not.toHaveBeenCalled();
    expect(r.store.work(r.id)!.gh_scan).toBeNull();
  });

  test("owner.md is required once Feasibility is passed: missing or unreadable stops the autopilot on the way into Implementation", async () => {
    const r = await rig();
    idleStage(r);
    await moveTo(r, 3);
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await r.pilot.start(r.id, "");
    r.ports.idle(pilotThread(r));
    expect(await r.pilot.actTool(pilotThread(r), { action: "forward", force: true, text: REASON })).toContain("stopped: owner.md is missing");
    expect(r.store.work(r.id)!.stage).toBe(3);
    // Unreadable is not «nothing open» either.
    const u = await rig();
    idleStage(u);
    await moveTo(u, 3);
    u.ports.files.set(`${u.env}:${u.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    u.ports.files.set(`${u.env}:${ownerPath(u.key)}`, "- [x] nothing\n");
    await u.pilot.start(u.id, "");
    u.ports.idle(pilotThread(u));
    const read = u.ports.read.bind(u.ports);
    vi.spyOn(u.ports, "read").mockImplementation(async (env, rel) => {
      if (rel === ownerPath(u.key)) throw new Error("I/O error");
      return read(env, rel);
    });
    expect(await u.pilot.actTool(pilotThread(u), { action: "forward" })).toContain("stopped: owner.md could not be read (I/O error)");
    expect(u.store.work(u.id)!.stage).toBe(3);
  });

  test("accept: only on a green live check — red stops the autopilot even with force, no report yet is refused, green accepts", async () => {
    const r = await atVerification();
    const a = await entered(r);
    r.ports.idle(pilotThread(r));
    expect(await r.pilot.actTool(pilotThread(r), { action: "accept" })).toContain("not done: the autopilot accepts only on a green live check");
    expect(r.store.pilot(r.id)!.state).toBe("on");
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "the section does not open\nVERDICT: FAIL");
    const answer = await r.pilot.actTool(pilotThread(r), { action: "accept", force: true, text: REASON });
    expect(answer).toContain("the live check is red");
    expect(r.store.work(r.id)!.outcome).toBeNull();
    expect(r.store.pilot(r.id)!.state).toBe("stopped");
    // The owner may still accept a red live check with «Accept anyway».
    expect(await r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: a, force: true, note: "known issue" })).toMatchObject({ ok: true });

    const g = await atVerification();
    await entered(g);
    g.ports.idle(pilotThread(g));
    g.ports.files.set(`${g.env}:${livePath(g.key, 1)}`, "all items pass\nVERDICT: PASS");
    expect(await g.pilot.actTool(pilotThread(g), { action: "accept", text: "the live check is green" })).toContain("accepted");
    expect(g.store.work(g.id)!.outcome).toBe("done");
  });
});
