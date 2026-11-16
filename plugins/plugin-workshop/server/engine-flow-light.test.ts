// The lighter work path: automatic reviews, iteration addenda without making the spec stale, «Reconfirm»,
// «Send back to Implementation per report», the owner checklist, keys kept out of snapshots.
import { describe, expect, it } from "vitest";
import { navLines, ownerItems, placeAfter } from "./parse";
import { inputsChanged, kickoff, returnPacket } from "./regulations";
import { navGuidePath } from "./rules";
import { secretFileName } from "./snapshot";
import { iterationPath, ledgerPath, livePath, ownerPath, reviewPath, stageOf, verifyPath, type Who } from "./stages";
import { attempt, commitWork, entered, idleStage, moveTo, reviewed, setup, started, versionOf, type Started } from "./test-utils";

const auto = () => started(setup(2, 2, true));
const reviewers = (s: Started, stage: number) => s.store.runs(s.id).filter((r) => r.role === "review" && r.stage === stage);
/** The reviewer wrote its file and finished its turn. */
function reviewDone(s: Started, r: { thread_id: string; who: string; round: number; stage: number }, verdict = "CLEAR") {
  s.ports.files.set(`${s.env}:${reviewPath(s.key, r.stage === 3 ? "tz" : "verify", r.who as Who, r.round)}`, `findings\nVERDICT: ${verdict}`);
  s.ports.idle(r.thread_id);
}
/** A work on Spec whose spec agent finished its turn long ago (no Workshop messages since). */
async function onTz(): Promise<Started> {
  const s = await auto();
  idleStage(s);
  await moveTo(s, 3);
  s.ports.idle(s.store.stageThread(s.id, 3)!.thread_id);
  return s;
}
const tzReady = (s: Started) => s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");

describe("the spec review starts on its own", () => {
  it("starts round 1 once the agent finished its turn with a ready spec (the MIGRATIONS line), not before", async () => {
    const s = await onTz();
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\n");
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3)).toEqual([]);
    tzReady(s);
    s.ports.threads.get(s.store.stageThread(s.id, 3)!.thread_id)!.status = "active";
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3)).toEqual([]);
    s.ports.idle(s.store.stageThread(s.id, 3)!.thread_id);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3).map((r) => [r.who, r.round])).toEqual([["fable", 1], ["astra", 1]]);
    expect(s.store.events(s.id).map((e) => e.text)).toContain(`review «${stageOf(3).title}», round 1 — started automatically`);
    expect(s.store.work(s.id)).toMatchObject({ state: "reviews" });
  });

  it("waits while the agent may not have started on a message it just got, and says so on the card", async () => {
    const s = await onTz();
    tzReady(s);
    const tz = s.store.stageThread(s.id, 3)!.thread_id;
    // A Workshop message to the agent has just gone out (a return to the stage); the thread has not started its turn yet.
    s.store.beginOp("k", s.id, "send", null, s.ports.now());
    s.store.finishOp("k", tz, s.ports.now());
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3)).toEqual([]);
    expect(s.store.work(s.id)).toMatchObject({ state: "reviews", state_reason: "the spec review is about to start" });
    s.ports.t += 31_000;
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3)).toHaveLength(2);
  });

  it("runs a second round only after the agent closed a round with a blocking finding, and no third", async () => {
    const s = await onTz();
    tzReady(s);
    await s.engine.reconcile(s.id);
    const tz = s.store.stageThread(s.id, 3)!.thread_id;
    for (const r of reviewers(s, 3)) reviewDone(s, r, r.who === "astra" ? "BLOCKING" : "CLEAR");
    await s.engine.reconcile(s.id);
    // The files went to the agent — while it closes the items, there is no second round.
    expect(s.ports.sent.filter((m) => m.threadId === tz && m.text.includes(reviewPath(s.key, "tz", "astra", 1)))).toHaveLength(1);
    expect(new Set(reviewers(s, 3).map((r) => r.round))).toEqual(new Set([1]));
    s.ports.idle(tz);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3).filter((r) => r.round === 2)).toHaveLength(2);
    for (const r of reviewers(s, 3).filter((x) => x.round === 2)) reviewDone(s, r, "BLOCKING");
    await s.engine.reconcile(s.id);
    s.ports.idle(tz);
    await s.engine.reconcile(s.id);
    expect(Math.max(...reviewers(s, 3).map((r) => r.round))).toBe(2);
    const g = (await s.engine.view(s.id)).warnings;
    expect(g).toContain("Fable 5.1: a blocking finding remained after round 2 — see how the agent closed it in the «Review» section of the spec");
  });

  it("does not run a second round after a clear first one", async () => {
    const s = await onTz();
    tzReady(s);
    await s.engine.reconcile(s.id);
    for (const r of reviewers(s, 3)) reviewDone(s, r);
    await s.engine.reconcile(s.id);
    s.ports.idle(s.store.stageThread(s.id, 3)!.thread_id);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3)).toHaveLength(2);
    expect((await s.engine.view(s.id)).blockers).toEqual([]);
  });

  it("starts a fresh round on a new iteration once the spec changed, and none when switched off or stopped by the owner", async () => {
    const s = await onTz();
    tzReady(s);
    await s.engine.reconcile(s.id);
    for (const r of reviewers(s, 3)) reviewDone(s, r);
    await s.engine.reconcile(s.id);
    s.ports.idle(s.store.stageThread(s.id, 3)!.thread_id);
    // Back to Feasibility and on to Spec again: iteration 2 — the earlier round no longer holds.
    s.ports.files.set(`${s.env}:${ownerPath(s.key)}`, "- nothing\n");
    s.ports.files.set(`${s.env}:${s.docs.tech}`, "VERDICT: OK");
    await s.engine.sendBack(s.id, { expectedStage: 3, toStage: 2, reason: "x" });
    idleStage(s, 2);
    expect((await s.engine.handOver(s.id, { expectedStage: 2, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    s.ports.idle(s.store.stageThread(s.id, 3)!.thread_id);
    s.ports.t += 31_000;
    // The previous iteration's spec is not rewritten yet — it was already reviewed, no round runs.
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3).filter((r) => r.round === 2)).toEqual([]);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\n### Task 2: B\nMIGRATIONS: no\nNAV: none\n");
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3).filter((r) => r.round === 2)).toHaveLength(2);
    // The owner stopped the reviewers — they no longer start on their own.
    await s.engine.stopReviews(s.id, 3);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3)).toHaveLength(4);

    const off = await started(setup());
    idleStage(off);
    await moveTo(off, 3);
    tzReady(off);
    off.ports.idle(off.store.stageThread(off.id, 3)!.thread_id);
    await off.engine.reconcile(off.id);
    expect(reviewers(off, 3)).toEqual([]);
  });

  it("fills in a reviewer whose spawn failed", async () => {
    const s = await onTz();
    tzReady(s);
    // The round's second spawn (GPT-6-Astra) fails.
    s.ports.failSpawnNumber = s.ports.threads.size + 2;
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3).map((r) => r.who)).toEqual(["fable"]);
    expect(s.store.events(s.id).map((e) => e.text)).toContainEqual(expect.stringContaining("review not started: spawn failed"));
    reviewDone(s, reviewers(s, 3)[0]!);
    s.ports.t += 6 * 60_000;
    await s.engine.reconcile(s.id);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3).map((r) => [r.who, r.round])).toEqual([["fable", 1], ["astra", 1]]);
    expect(s.store.events(s.id).map((e) => e.text)).toContain(`review «${stageOf(3).title}», round 1 (GPT-6-Astra) — started automatically`);
  });
});

describe("the verification review runs together with the verifier", () => {
  it("starts with the verifier, once per code version, and hands the files to the verifier", async () => {
    const s = await auto();
    idleStage(s);
    await moveTo(s, 5);
    const verifier = s.store.stageThread(s.id, 5)!.thread_id;
    expect(reviewers(s, 5).map((r) => [r.who, r.round])).toEqual([["fable", 1], ["astra", 1]]);
    for (const r of reviewers(s, 5)) reviewDone(s, r, "BLOCKING");
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "VERDICT: PASS");
    expect((await s.engine.view(s.id)).blockers).toContain("reviews not yet handed to the verifier — wait a minute");
    await s.engine.reconcile(s.id);
    expect(s.ports.sent.filter((m) => m.threadId === verifier)).toHaveLength(1);
    s.ports.idle(verifier);
    await s.engine.reconcile(s.id);
    // Same code — no second round, even after blocking findings: the verifier deals with them.
    expect(reviewers(s, 5)).toHaveLength(2);
    const v = await s.engine.view(s.id);
    expect(v.blockers).toEqual([]);
    expect(v.warnings).toContain("GPT-6-Astra: a blocking finding — see how the verifier handled it in the «Reviews» section of the verification report");
  });

  it("does not review a moving or dirty tree, nor while the main branch is ahead", async () => {
    const s = await auto();
    idleStage(s);
    s.ports.dirty.add(s.env);
    await moveTo(s, 5);
    expect(reviewers(s, 5)).toEqual([]);
    s.ports.dirty.delete(s.env);
    s.ports.git.commit(s.dir);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 5)).toEqual([]);
  });
});

describe("reviews: restart, a broken round, stop by the owner", () => {
  it("a restarted verifier gets the review files again; until then «Roll out» waits", async () => {
    const s = await auto();
    idleStage(s);
    await moveTo(s, 5);
    const first = s.store.stageThread(s.id, 5)!.thread_id;
    for (const r of reviewers(s, 5)) reviewDone(s, r);
    await s.engine.reconcile(s.id);
    expect(s.ports.sent.filter((m) => m.threadId === first)).toHaveLength(1);
    s.ports.threads.get(first)!.status = "error";
    await s.engine.restartStage(s.id, 5);
    const second = s.store.stageThread(s.id, 5)!.thread_id;
    expect(second).not.toBe(first);
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 2)}`, "VERDICT: PASS");
    expect((await s.engine.view(s.id)).blockers).toContain("reviews not yet handed to the verifier — wait a minute");
    s.ports.idle(second);
    await s.engine.reconcile(s.id);
    expect(s.ports.sent.filter((m) => m.threadId === second && m.text.includes("verify-r2.md"))).toHaveLength(1);
    // The files were just handed over — the verifier may not have started yet: the rollout waits.
    s.ports.threads.get(second)!.status = "idle";
    await expect(s.engine.guard(s.id, { stage: 5 }, async () => 1)).rejects.toThrow("the work's agent is still working");
    s.ports.t += 31_000;
    expect(await s.engine.guard(s.id, { stage: 5 }, async () => 1)).toBe(1);
    expect((await s.engine.view(s.id)).blockers).toEqual([]);
  });

  it("a reviewer that ended without its file voids the round, and the round is run again (at most twice per version)", async () => {
    const s = await auto();
    idleStage(s);
    await moveTo(s, 5);
    const [fable, astra] = reviewers(s, 5);
    reviewDone(s, fable!);
    s.ports.idle(astra!.thread_id);
    await s.engine.reconcile(s.id);
    expect(s.store.run(astra!.thread_id)!.invalid_reason).toBe("the reviewer finished without a review file");
    expect(reviewers(s, 5).filter((r) => r.round === 2)).toHaveLength(2);
    for (const r of reviewers(s, 5).filter((x) => x.round === 2)) s.ports.idle(r.thread_id);
    await s.engine.reconcile(s.id);
    await s.engine.reconcile(s.id);
    expect(Math.max(...reviewers(s, 5).map((r) => r.round))).toBe(2);
  });

  it("stopping an extra round falls back to the round before it", async () => {
    const s = await onTz();
    tzReady(s);
    await s.engine.reconcile(s.id);
    for (const r of reviewers(s, 3)) reviewDone(s, r, r.who === "astra" ? "BLOCKING" : "CLEAR");
    await s.engine.reconcile(s.id);
    s.ports.idle(s.store.stageThread(s.id, 3)!.thread_id);
    await s.engine.reconcile(s.id);
    expect(reviewers(s, 3).filter((r) => r.round === 2)).toHaveLength(2);
    await s.engine.stopReviews(s.id, 3);
    const v = await s.engine.view(s.id);
    expect(v.blockers).toEqual([]);
    expect(v.warnings).toEqual(["GPT-6-Astra: a blocking finding remained after round 1 — see how the agent closed it in the «Review» section of the spec"]);
  });
});

describe("iteration addenda and «Reconfirm»", () => {
  it("counts tasks of iteration files in the progress and keeps the spec approved", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\n### Task 2: B\nMIGRATIONS: no\nNAV: none\n");
    await moveTo(s, 3);
    reviewed(s, 3, "tz", await versionOf(s));
    expect((await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    idleStage(s, 4);
    s.ports.files.set(`${s.env}:${ledgerPath(s.docs.tz)}`, "Task 1: complete\nTask 2: complete\n");
    s.ports.files.set(`${s.env}:${iterationPath(s.key, 2)}`, "### Task 3: fix per the report\n");
    const v = await s.engine.view(s.id);
    expect(v.stages.find((x) => x.no === 4)!.progress).toEqual({ done: 2, total: 3 });
    expect(v.stages.find((x) => x.no === 4)!.files.map((f) => f.label)).toContain("Iteration 2");
    expect(v.warnings).toEqual(["2 of 3 plan tasks done"]);
    // The spec is untouched — nothing is stale.
    expect(v.blockers).toEqual([]);
    expect((await s.engine.file(s.id, iterationPath(s.key, 2))).text).toContain("Task 3");
    await expect(s.engine.file(s.id, `docs/workshop/${s.key}/other.md`)).rejects.toThrow("this file cannot be opened");
  });

  it("reconfirms a stale document stage without restarting anyone, only for stages 1–3 and only the screen's version", async () => {
    const s = await started();
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "v1");
    expect((await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    idleStage(s, 2);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "v2");
    const old = await s.engine.view(s.id);
    expect(old.reconfirm).toEqual([1]);
    expect(old.blockers).toContain(`«${stageOf(1).title}» is stale: what you approved has changed since`);
    await expect(s.engine.reconfirm(s.id, { expectedStage: 2, stage: 4, expectedVersion: (await versionOf(s))! })).rejects.toThrow("only documents");
    await expect(s.engine.reconfirm(s.id, { expectedStage: 2, stage: 2, expectedVersion: (await versionOf(s))! })).rejects.toThrow("not stale");
    const screen = (await versionOf(s))!;
    s.ports.files.set(`${s.env}:${s.docs.context}`, "v3");
    await expect(s.engine.reconfirm(s.id, { expectedStage: 2, stage: 1, expectedVersion: screen })).rejects.toThrow("the version has changed");
    const sent = s.ports.sent.length;
    await s.engine.reconfirm(s.id, { expectedStage: 2, stage: 1, expectedVersion: (await versionOf(s))! });
    const now = await s.engine.view(s.id);
    expect(now.reconfirm).toEqual([]);
    expect(now.blockers).not.toContain(`«${stageOf(1).title}» is stale: what you approved has changed since`);
    expect(s.store.work(s.id)!.stage).toBe(2);
    expect(s.ports.sent.length).toBe(sent);
    expect(s.store.handovers(s.id).at(-1)).toMatchObject({ stage: 1, action: "reconfirm" });
    expect(s.store.events(s.id).map((e) => e.text)).toContain(`«${stageOf(1).title}» reconfirmed`);
  });
});

describe("«Send back to Implementation per report»", () => {
  it("offers a one-click return with the report path after a red verification, and nothing after a green one", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 5);
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "VERDICT: PASS");
    expect((await s.engine.view(s.id)).returnByReport).toBeNull();
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "failed\nVERDICT: FAIL");
    const offer = (await s.engine.view(s.id)).returnByReport!;
    expect(offer).toMatchObject({ toStage: 4, fixForward: false });
    expect(offer.reason).toContain(verifyPath(s.key, 1));
    await s.engine.sendBack(s.id, { expectedStage: 5, ...offer });
    expect(s.store.work(s.id)).toMatchObject({ stage: 4, iteration: 2 });
    const packet = s.ports.sent.at(-1)?.text ?? s.ports.threads.get(s.store.stageThread(s.id, 4)!.thread_id)!.prompt;
    expect(packet).toContain(iterationPath(s.key, 2));
  });

  it("on Rollout a red live check is fixed forward; after a rollback it is a plain return; over an undecided failure there is no button", async () => {
    const s = await started();
    idleStage(s);
    await entered(s);
    s.ports.files.set(`${s.env}:${livePath(s.key, 1)}`, "VERDICT: FAIL");
    expect((await s.engine.view(s.id)).returnByReport).toMatchObject({ toStage: 4, fixForward: true });
    attempt(s, { kind: "rollback" });
    expect((await s.engine.view(s.id)).returnByReport).toMatchObject({ toStage: 4, fixForward: false });
    attempt(s, { kind: "reinstall", status: "failed", step: "checked" });
    expect((await s.engine.view(s.id)).returnByReport).toBeNull();
  });
});

describe("what is needed from the owner", () => {
  it("is shown on the work page and warns when the work goes to Implementation", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 3);
    s.ports.files.set(`${s.env}:${ownerPath(s.key)}`, "- [x] API key — checked: GET /v1/accounts\n- [ ] scraper plan: paid, or collect less\n");
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    reviewed(s, 3, "tz", await versionOf(s));
    const v = await s.engine.view(s.id);
    expect(v.ownerNeeds).toEqual(["scraper plan: paid, or collect less"]);
    expect(v.warnings).toEqual(["needed from you before implementation: scraper plan: paid, or collect less"]);
    expect((await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(false);
    // Ticking an item makes nothing stale.
    s.ports.files.set(`${s.env}:${ownerPath(s.key)}`, "- [x] API key\n- [x] scraper plan — collecting less\n");
    expect((await s.engine.handOver(s.id, { expectedStage: 3, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    commitWork(s, "h9");
    expect((await s.engine.view(s.id)).ownerNeeds).toEqual([]);
  });

  it("parses the checklist and recognises key files by name", () => {
    expect(ownerItems("# Needed\n- [ ] key A\n  - [x] key B\n* [X] plan\n- nothing\n- [ ]\n")).toEqual({ open: ["key A"], done: 2 });
    for (const p of [".env", ".env.local", "x/keys.env", "a/b/secrets/token", "id.pem", "tls.key"]) expect(secretFileName(p), p).toBe(true);
    for (const p of ["docs/env.md", "keys.md", "secretsauce/x.md", "review-astra-tz-r1.md"]) expect(secretFileName(p), p).toBe(false);
  });
});

describe("regulations of the lighter path", () => {
  it("tell the agents about the owner list, iteration files, auto reviews and the verifier's part", async () => {
    const s = await started();
    const w = s.store.work(s.id)!;
    const k = (no: number) => kickoff(w, stageOf(no), 1);
    expect(k(2)).toContain(ownerPath(s.key));
    expect(k(2)).toContain("with the `secrets` skill");
    expect(k(3)).toContain("starts on its own");
    expect(k(3)).toContain("do not write the MIGRATIONS line");
    expect(k(4)).toContain("editing the spec after it was approved blocks the hand-over");
    expect(k(5)).toContain("«## Review Focus»");
    expect(k(5)).toContain("at the same time as you");
    expect(k(1)).toContain("do not ask for it in chat");
    expect(returnPacket({ ...w, iteration: 2 }, stageOf(4), stageOf(5), "FAIL", 2)).toContain(iterationPath(s.key, 2));
    expect(returnPacket({ ...w, iteration: 2 }, stageOf(2), stageOf(3), "x", 2)).not.toContain("iteration-");
    expect(inputsChanged(w, stageOf(4))).toContain(s.docs.tz);
    expect(inputsChanged(w, stageOf(2))).toContain(ownerPath(s.key));
    expect(returnPacket({ ...w, iteration: 2 }, stageOf(2), stageOf(4), "x", 2)).toContain(ownerPath(s.key));
    expect(returnPacket({ ...w, iteration: 2 }, stageOf(3), stageOf(4), "x", 2)).toContain("remove the MIGRATIONS line");
  });
});

describe("the navigation bar section is part of the work", () => {
  it("reads NAV lines: sections with neighbours, none, and contradictions", () => {
    expect(navLines("MIGRATIONS: no\nNAV: news/news after notes/notes\nNAV: news/stats\n")).toEqual([
      { panel: "news/news", after: "notes/notes" },
      { panel: "news/stats", after: null },
    ]);
    expect(navLines("NAV: none")).toEqual([]);
    expect(navLines("no lines")).toBeNull();
    expect(navLines("NAV: none\nNAV: a/b")).toBeNull();
    expect(navLines("NAV: just a section")).toBeNull();
    expect(placeAfter(["a/a", "notes/notes", "x/x"], "n/n", "notes/notes")).toEqual(["a/a", "notes/notes", "n/n", "x/x"]);
    expect(placeAfter(["a/a", "n/n", "notes/notes"], "n/n", "notes/notes")).toEqual(["a/a", "notes/notes", "n/n"]);
    expect(placeAfter(["a/a", "notes/notes", "n/n"], "n/n", "notes/notes")).toBeNull();
    expect(placeAfter(["a/a"], "n/n", "missing/x")).toEqual(["a/a", "n/n"]);
  });

  it("the spec gate wants NAV lines", async () => {
    const s = await started();
    idleStage(s);
    await moveTo(s, 3);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\n");
    reviewed(s, 3, "tz", await versionOf(s));
    expect((await s.engine.view(s.id)).blockers).toEqual(["the spec has no NAV: <plugin>/<section> after <neighbour> lines (or NAV: none) — the section's place on the navigation bar"]);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    expect((await s.engine.view(s.id)).blockers).toEqual([]);
  });

  it("entering Rollout puts the plugin's sections on the bar after their neighbour and makes them visible, once, and only its own", async () => {
    const s = await started();
    idleStage(s);
    s.ports.panels = { order: ["tasks/tasks", "notes/notes", "workshop/workshop"], orderRevision: 3, visible: ["tasks/tasks", "notes/notes"], visibleRevision: 5 };
    s.ports.files.set(`${s.env}:${s.docs.tz}`, `### Task 1: A\nMIGRATIONS: no\nNAV: ${s.w.plugin_id}/main after notes/notes\nNAV: mail/mail after notes/notes\n`);
    s.ports.files.set(`${s.env}:${iterationPath(s.key, 2)}`, `### Task 2: B\nNAV: ${s.w.plugin_id}/stats after ${s.w.plugin_id}/main\n`);
    await entered(s);
    expect(s.ports.panels.order).toEqual(["tasks/tasks", "notes/notes", `${s.w.plugin_id}/main`, `${s.w.plugin_id}/stats`, "workshop/workshop"]);
    expect(s.ports.panels.visible).toEqual(["tasks/tasks", "notes/notes", `${s.w.plugin_id}/main`, `${s.w.plugin_id}/stats`]);
    const events = s.store.events(s.id).map((e) => e.text);
    expect(events).toContain(`section on the navigation bar: ${s.w.plugin_id}/main after notes/notes, ${s.w.plugin_id}/stats after ${s.w.plugin_id}/main`);
    expect(events).toContain("NAV lines not about this plugin were skipped: mail/mail");
    // The live check starts after this; another reconcile moves nothing.
    expect(s.store.stageThread(s.id, 6)).not.toBeNull();
    const rev = s.ports.panels.orderRevision;
    await s.engine.reconcile(s.id);
    expect(s.ports.panels.orderRevision).toBe(rev);
  });

  it("a bar that could not be set does not hold the live check", async () => {
    const s = await started();
    idleStage(s);
    s.ports.uiFails = true;
    s.ports.files.set(`${s.env}:${s.docs.tz}`, `### Task 1: A\nMIGRATIONS: no\nNAV: ${s.w.plugin_id}/main after notes/notes\n`);
    await entered(s);
    expect(s.store.stageThread(s.id, 6)).not.toBeNull();
    expect(s.store.events(s.id).map((e) => e.text)).toContainEqual(expect.stringContaining("section not placed on the navigation bar: uiPreferences.list failed"));
  });

  it("tells the agents: section and badge are part of the work, not «outside the plugin»", async () => {
    const s = await started();
    const w = s.store.work(s.id)!;
    const k = (no: number) => kickoff(w, stageOf(no), 1);
    expect(k(1)).toContain("its badge code on the bar");
    expect(k(3)).toContain("NAV: none");
    expect(k(3)).toContain("This is part of the work, not «outside the plugin»");
    expect(k(5)).toContain("A missing badge or NAV line — FAIL");
    for (const no of [1, 2, 3, 4, 5, 6]) expect(k(no)).toContain(navGuidePath());
  });
});
