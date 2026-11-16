import { describe, expect, it, test } from "vitest";
import { cardState, UNEXPECTED_COPY, type AttemptFact, type StateFacts } from "./state";
import { gate, type GateFacts } from "./gates";
import { ledgerDone, migrationsFlag, normalizePlan, planTaskCount, reviewVerdict, techVerdict, verifyVerdict } from "./parse";
import { COLUMNS, PLUGINS_ROOT, STAGES, docPaths, ledgerPath, livePath, ownerPath, pluginDir, reviewPath, slugify, stageOf, verifyPath, workDir, type StageNo } from "./stages";
import { resultHolds, sameVersion, staleStages, type Version } from "./versions";

const v = (o: Partial<Version> = {}): Version => ({ iteration: 1, headSha: "a", dirty: false, contextSha: "c", techSha: "t", tzSha: "z", ...o });

describe("stages", () => {
  it("seven stages in work order map to columns; Mockup (7) stands between Spec and Implementation", () => {
    expect(STAGES.map((s) => [s.no, s.column])).toEqual([[1, "context"], [2, "tech"], [3, "tz"], [7, "mockup"], [4, "build"], [5, "build"], [6, "live"]]);
    expect(COLUMNS.map((c) => c.title)).toEqual(["Context", "Feasibility", "Spec", "Mockup", "Building", "In production", "Retired"]);
    expect(COLUMNS.map((c) => c.key)).toEqual(["context", "tech", "tz", "mockup", "build", "live", "off"]);
  });
  it("puts agents, reviews and task statuses where the spec puts them", () => {
    expect(STAGES.map((s) => [s.no, s.key, s.title])).toEqual([
      [1, "context", "Context"], [2, "tech", "Feasibility"], [3, "tz", "Spec"], [7, "mockup", "Mockup"], [4, "build", "Implementation"], [5, "verify", "Verification"], [6, "enter", "Rollout"],
    ]);
    expect(STAGES.every((s) => s.agent)).toBe(true);
    expect(STAGES.filter((s) => s.reviewed).map((s) => s.no)).toEqual([3, 5]);
    expect(STAGES.filter((s) => s.freshEachRound).map((s) => s.no)).toEqual([5, 6]);
    expect(STAGES.map((s) => s.taskStatus)).toEqual(["in_progress", "in_progress", "in_progress", "in_progress", "in_progress", "in_progress", "in_review"]);
    expect(STAGES.every((s) => s.ownerCheck.length > 0)).toBe(true);
    expect(stageOf(5).key).toBe("verify");
    expect(() => stageOf(0)).toThrow();
    expect(stageOf(7).key).toBe("mockup");
    expect(() => stageOf(8)).toThrow();
  });
  it("paths", () => {
    expect(docPaths("TEST-12")).toEqual({ context: "docs/workshop/TEST-12/context.md", tech: "docs/workshop/TEST-12/tech.md", tz: "docs/workshop/TEST-12/tz.md" });
    expect(livePath("TEST-12", 2)).toBe(".superpowers/workshop/TEST-12/live-r2.md");
    expect(pluginDir("hello")).toBe(`${PLUGINS_ROOT}/alia-plugin-hello`);
  });
  it("derives work files from the task key", () => {
    expect(workDir("TEST-1")).toBe(".superpowers/workshop/TEST-1");
    expect(reviewPath("TEST-1", "tz", "fable", 2)).toBe(".superpowers/workshop/TEST-1/review-fable-tz-r2.md");
    expect(reviewPath("TEST-1", "verify", "astra", 1)).toBe(".superpowers/workshop/TEST-1/review-astra-verify-r1.md");
    expect(verifyPath("TEST-1", 1)).toBe(".superpowers/workshop/TEST-1/verify-r1.md");
    expect(ledgerPath(docPaths("TEST-1").tz)).toBe(".superpowers/sdd/tz/progress.md");
    expect(ledgerPath("docs/plans/example-plan.md")).toBe(".superpowers/sdd/example-plan/progress.md");
    expect(slugify("Кнопка экспорта")).toBe("knopka-eksporta");
    expect(slugify("!!!")).toBe("work");
  });
});

describe("parse", () => {
  it("reads verdicts only from the last line and keeps review and verification apart", () => {
    expect(reviewVerdict("text\n\nVERDICT: BLOCKING\n")).toBe("blocking");
    expect(reviewVerdict("VERDICT: CLEAR\none more line")).toBeNull();
    expect(reviewVerdict("VERDICT: PASS")).toBeNull();
    expect(verifyVerdict("verdict: pass")).toBe("pass");
    expect(verifyVerdict("VERDICT: CLEAR")).toBeNull();
  });
  it("tech verdict is the exact last line", () => {
    expect(techVerdict("VERDICT: OK")).toBe("ok");
    expect(techVerdict("…\nVERDICT: OK_WITH_CAVEATS")).toBe("caveats");
    expect(techVerdict("VERDICT: IMPOSSIBLE\n")).toBe("impossible");
    expect(techVerdict("**VERDICT: OK**")).toBeNull();
    expect(techVerdict("VERDICT: OK\none more line")).toBeNull();
    expect(techVerdict("VERDICT: OK_MAYBE")).toBeNull();
    expect(techVerdict("VERDICT: PASS")).toBeNull();
    expect(techVerdict("")).toBeNull();
  });
  it("migrations flag", () => {
    expect(migrationsFlag("…\nMIGRATIONS: yes\nNAV: none\n…")).toBe(true);
    expect(migrationsFlag("MIGRATIONS: no")).toBe(false);
    expect(migrationsFlag("no migrations")).toBeNull();
    expect(migrationsFlag("text MIGRATIONS: yes in the middle of a line")).toBeNull();
    expect(migrationsFlag("MIGRATIONS: yes\nNAV: none\nMIGRATIONS: yes")).toBe(true);
    expect(migrationsFlag("MIGRATIONS: yes\nNAV: none\nMIGRATIONS: no")).toBeNull();
  });
  it("counts plan tasks and completed ledger tasks", () => {
    expect(planTaskCount("### Task 1: A\n### Task 2: B\n### Task 2: B again")).toBe(2);
    expect(ledgerDone("Task 1: complete (commits a..b, review clean)\nTask 2: fix round 1/5\nTask 2: complete (x)")).toBe(2);
  });
  it("ignores checkbox ticks when hashing a plan", () => {
    expect(normalizePlan("- [x] Step\n  * [X] Sub")).toBe("- [ ] Step\n  * [ ] Sub");
  });
});

describe("versions", () => {
  it("compares all six fields", () => {
    expect(sameVersion(v(), v())).toBe(true);
    expect(sameVersion(v(), v({ headSha: "b" }))).toBe(false);
    expect(sameVersion(v(), v({ dirty: true }))).toBe(false);
    expect(sameVersion(v(), v({ iteration: 2 }))).toBe(false);
    expect(sameVersion(v(), v({ contextSha: "c2" }))).toBe(false);
    expect(sameVersion(v(), v({ techSha: "t2" }))).toBe(false);
    expect(sameVersion(v(), v({ tzSha: "z2" }))).toBe(false);
    expect(sameVersion(v(), null)).toBe(false);
  });
  it("tz change makes stage 3 stale but not stage 2", () => {
    expect(staleStages([{ stage: 2, version: v() }, { stage: 3, version: v() }], v({ tzSha: "z2" }))).toEqual([3]);
    expect(staleStages([{ stage: 1, version: v() }], v({ techSha: "t2" }))).toEqual([]);
  });
  it("marks a stage stale only by what it approved", () => {
    const approvals = [1, 2, 3, 4, 5, 6].map((stage) => ({ stage, version: v() }));
    expect(staleStages(approvals, v())).toEqual([]);
    expect(staleStages(approvals, v({ contextSha: "c2" }))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(staleStages(approvals, v({ techSha: "t2" }))).toEqual([2, 3, 4, 5, 6]);
    expect(staleStages(approvals, v({ tzSha: "z2" }))).toEqual([3, 4, 5, 6]);
    expect(staleStages(approvals, v({ headSha: "b" }))).toEqual([4, 5, 6]);
    expect(staleStages(approvals, v({ dirty: true, iteration: 2 }))).toEqual([]);
    expect(staleStages([{ stage: 1, version: v() }, { stage: 1, version: v({ contextSha: "c2" }) }], v({ contextSha: "c2" }))).toEqual([]);
    expect(staleStages([{ stage: 3, version: null }], v({ tzSha: "z2" }))).toEqual([]);
  });
  it("holds a round's result by iteration, and from the build stage also by HEAD and a clean tree", () => {
    expect(resultHolds(1, v(), v({ contextSha: "c2", headSha: "b" }))).toBeNull();
    expect(resultHolds(3, v(), v({ techSha: "t2", tzSha: "z2", headSha: "b", dirty: true }))).toBeNull();
    expect(resultHolds(2, v(), v({ iteration: 2 }))).toMatch(/iteration 1/);
    expect(resultHolds(4, v(), v({ headSha: "b" }))).toMatch(/code changed/);
    expect(resultHolds(5, v(), v({ dirty: true }))).toMatch(/uncommitted changes/);
    expect(resultHolds(6, v(), v({ headSha: "b" }))).toMatch(/code changed/);
    expect(resultHolds(5, null, v())).toMatch(/unknown/);
    expect(resultHolds(5, v({ dirty: true }), v())).toMatch(/uncommitted tree/);
    expect(resultHolds(5, v(), v())).toBeNull();
  });
});

describe("gate", () => {
  const clear = [
    { who: "Fable 5.1", round: 1, started: true, verdict: "clear" as const, invalid: null },
    { who: "GPT-6-Astra", round: 1, started: true, verdict: "clear" as const, invalid: null },
  ];
  const none = { context: false, tech: false, tz: false };
  const ctxTech = { context: true, tech: true, tz: false };
  const all = { context: true, tech: true, tz: true };
  const main = { hasGit: true, branch: "main", head: "a", dirtyCount: 0 };
  const pass = { verdict: "pass" as const, invalid: null };
  const paths = { ...docPaths("TEST-12"), owner: ownerPath("TEST-12") };
  /** Empty facts: nothing exists, nothing is in the way. */
  const empty: GateFacts = {
    stage: 1, paths, owner: null, reviewsHanded: null, autoReview: true, exists: none, tech: null, migrations: null, reviews: null, progress: null, verify: null, live: null, attempt: null,
    copy: null, baseAhead: false, staleBefore: [], dirty: false, queued: false, freeDiskGb: null, minFreeDiskGb: 2,
  };
  const facts = (o: Partial<GateFacts>): GateFacts => ({ ...empty, ...o });
  /** Facts with which the stage gate opens without warnings. */
  const ok = (stage: StageNo): Partial<GateFacts> =>
    ({
      1: { exists: { ...none, context: true } },
      2: { exists: ctxTech, tech: "ok", owner: { open: [] } },
      3: { exists: all, migrations: false, reviews: clear },
      7: { exists: all, mockup: { index: true } },
      4: { exists: all, progress: { done: 3, total: 3 } },
      5: { exists: all, verify: pass, reviews: clear, reviewsHanded: true, copy: main, freeDiskGb: 40 },
      6: { exists: all, attempt: { kind: "enter", status: "done", step: "checked", error: null }, live: pass },
    })[stage] as Partial<GateFacts>;

  it("opens every stage's gate on its own facts", () => {
    for (const stage of [1, 2, 3, 4, 5, 6] as const) expect(gate(facts({ stage, ...ok(stage) }))).toEqual({ blockers: [], warnings: [] });
  });
  it("stage 1 needs context.md", () => {
    expect(gate(facts({ stage: 1 })).blockers).toEqual(["no docs/workshop/TEST-12/context.md"]);
    expect(gate(facts({ stage: 1, exists: { ...none, tech: true, tz: true } })).blockers).toEqual(["no docs/workshop/TEST-12/context.md"]);
  });
  it("stage 2 needs tech.md and its verdict; caveats pass, impossible is a warning", () => {
    expect(gate(facts({ stage: 2 })).blockers).toEqual(["no docs/workshop/TEST-12/tech.md", "no docs/workshop/TEST-12/owner.md — what is needed from you before implementation"]);
    expect(gate(facts({ stage: 2, exists: ctxTech, owner: { open: [] } })).blockers).toEqual(["tech.md has no verdict — last line VERDICT: OK | OK_WITH_CAVEATS | IMPOSSIBLE"]);
    expect(gate(facts({ stage: 2, exists: ctxTech, tech: "caveats", owner: { open: ["API key"] } }))).toEqual({ blockers: [], warnings: [] });
    expect(gate(facts({ stage: 2, exists: ctxTech, tech: "ok" })).blockers).toEqual(["no docs/workshop/TEST-12/owner.md — what is needed from you before implementation"]);
  });
  test("tech IMPOSSIBLE is a warning", () => expect(gate(facts({ stage: 2, exists: ctxTech, tech: "impossible", owner: { open: [] } }))).toEqual({ blockers: [], warnings: ["feasibility check: it cannot be done this way — hand over anyway?"] }));
  it("open owner items warn only when the work goes to Implementation (stage 3)", () => {
    const owner = { open: ["weather API key", "connect the mail account"] };
    expect(gate(facts({ stage: 3, ...ok(3), owner }))).toEqual({ blockers: [], warnings: ["needed from you before implementation: weather API key; connect the mail account"] });
    for (const stage of [4, 5, 6] as const) expect(gate(facts({ stage, ...ok(stage), owner }))).toEqual({ blockers: [], warnings: [] });
  });
  it("stage 3 needs tz.md, the MIGRATIONS line and two clear reviews", () => {
    expect(gate(facts({ stage: 3, migrations: false })).blockers).toEqual(["no docs/workshop/TEST-12/tz.md", "no review yet — it starts on its own when the agent finishes the spec (or «Send to review»)"]);
    expect(gate(facts({ stage: 3, exists: all, migrations: false, reviews: [clear[0]!, { who: "GPT-6-Astra", round: 1, started: false, verdict: null, invalid: null }] })).blockers).toEqual(["review GPT-6-Astra not started — «Send to review»"]);
    expect(gate(facts({ stage: 3, exists: all, migrations: true, reviews: [clear[0]!, { who: "GPT-6-Astra", round: 1, started: true, verdict: "clear", invalid: "code changed" }] })).blockers).toEqual(["review GPT-6-Astra is invalid: code changed"]);
    expect(gate(facts({ stage: 3, exists: all, migrations: true, reviews: [clear[0]!, { who: "GPT-6-Astra", round: 1, started: true, verdict: null, invalid: null }] })).blockers).toEqual(["review GPT-6-Astra is not ready or has no verdict"]);
    expect(gate(facts({ stage: 3, ...ok(3), migrations: true }))).toEqual({ blockers: [], warnings: [] });
  });
  test("tz without MIGRATIONS line", () => expect(gate(facts({ stage: 3, exists: all, migrations: null, reviews: clear })).blockers).toContain("the spec has no MIGRATIONS: yes|no line"));
  it("does not ask for MIGRATIONS of a tz that is not there", () => expect(gate(facts({ stage: 3, reviews: clear })).blockers).toEqual(["no docs/workshop/TEST-12/tz.md"]));
  it("only warns about blocking reviews, pointing to where the agent dealt with them", () => {
    const blocking = [clear[0]!, { who: "GPT-6-Astra", round: 2, started: true, verdict: "blocking" as const, invalid: null }];
    expect(gate(facts({ stage: 3, ...ok(3), reviews: blocking }))).toEqual({ blockers: [], warnings: ["GPT-6-Astra: a blocking finding remained after round 2 — see how the agent closed it in the «Review» section of the spec"] });
    expect(gate(facts({ stage: 5, ...ok(5), reviews: blocking }))).toEqual({ blockers: [], warnings: ["GPT-6-Astra: a blocking finding — see how the verifier handled it in the «Reviews» section of the verification report"] });
  });
  it("without auto reviews the gate asks for the button", () => {
    expect(gate(facts({ stage: 3, ...ok(3), reviews: null, autoReview: false })).blockers).toEqual(["no review yet — «Send to review»"]);
  });
  it("stage 5 waits until the verifier got the finished reviews", () => {
    expect(gate(facts({ stage: 5, ...ok(5), reviewsHanded: false })).blockers).toEqual(["reviews not yet handed to the verifier — wait a minute"]);
    expect(gate(facts({ stage: 5, ...ok(5), reviewsHanded: null })).blockers).toEqual([]);
  });
  it("asks for reviews only where they are held", () => {
    for (const stage of [1, 2, 4, 6] as const) expect(gate(facts({ stage, ...ok(stage), reviews: null })).blockers).toEqual([]);
    expect(gate(facts({ stage: 5, ...ok(5), reviews: null })).blockers).toEqual(["no review yet — it starts together with verification (or «Send to review»)"]);
  });
  it("stage 4 needs the ledger; an unfinished one is a warning", () => {
    expect(gate(facts({ stage: 4, exists: all })).blockers).toEqual(["no implementation ledger"]);
    expect(gate(facts({ stage: 4, exists: all, progress: { done: 2, total: 5 } }))).toEqual({ blockers: [], warnings: ["2 of 5 plan tasks done"] });
  });
  it("a dirty work tree blocks 4 and 5 and nothing else", () => {
    for (const stage of [4, 5] as const) expect(gate(facts({ stage, ...ok(stage), dirty: true })).blockers).toEqual(["the worktree has uncommitted changes — commit or discard them"]);
    for (const stage of [1, 2, 3, 6] as const) expect(gate(facts({ stage, ...ok(stage), dirty: true }))).toEqual({ blockers: [], warnings: [] });
  });
  test("base ahead blocks 4 and 5", () => {
    for (const stage of [4, 5] as const) expect(gate(facts({ stage, baseAhead: true, ...ok(stage) })).blockers).toContain("the working copy's main branch has moved ahead — the implementer is pulling it in");
    for (const stage of [1, 2, 3, 6] as const) expect(gate(facts({ stage, baseAhead: true, ...ok(stage) })).blockers).toEqual([]);
  });
  it("stage 5 needs a verification that holds and is green", () => {
    expect(gate(facts({ stage: 5, ...ok(5), verify: null })).blockers).toEqual(["there was no verification"]);
    expect(gate(facts({ stage: 5, ...ok(5), verify: { verdict: "pass", invalid: "code changed" } })).blockers).toEqual(["the verification report is unusable: code changed"]);
    expect(gate(facts({ stage: 5, ...ok(5), verify: { verdict: null, invalid: null } })).blockers).toEqual(["the verification report has no verdict"]);
    expect(gate(facts({ stage: 5, ...ok(5), verify: { verdict: "fail", invalid: null } })).blockers).toEqual(["verification is red — send it back to Implementation"]);
  });
  test("enter needs a clean working copy on main", () => {
    expect(gate(facts({ stage: 5, ...ok(5), copy: { hasGit: true, branch: "fix/x", head: "a", dirtyCount: 0 } })).blockers).toContain("the working copy is on branch fix/x, not main");
    expect(gate(facts({ stage: 5, ...ok(5), copy: { hasGit: true, branch: "main", head: "a", dirtyCount: 3 } })).blockers).toContain("the working copy has 3 uncommitted changes");
  });
  it("describes the working copy in plain English, singular and plural", () => {
    const dirty = (dirtyCount: number) => gate(facts({ stage: 5, ...ok(5), copy: { ...main, dirtyCount } })).blockers;
    expect(dirty(1)).toEqual(["the working copy has 1 uncommitted change"]);
    expect(dirty(2)).toEqual(["the working copy has 2 uncommitted changes"]);
    expect(dirty(11)).toEqual(["the working copy has 11 uncommitted changes"]);
    expect(dirty(21)).toEqual(["the working copy has 21 uncommitted changes"]);
    expect(gate(facts({ stage: 5, ...ok(5), copy: { hasGit: true, branch: null, head: "a", dirtyCount: 0 } })).blockers).toEqual(["the working copy is not on branch main (detached HEAD)"]);
    expect(gate(facts({ stage: 5, ...ok(5), copy: { hasGit: true, branch: "fix/x", head: "a", dirtyCount: 2 } })).blockers).toEqual(["the working copy is on branch fix/x, not main", "the working copy has 2 uncommitted changes"]);
  });
  it("blocks enter without a working copy or without git in it", () => {
    expect(gate(facts({ stage: 5, ...ok(5), copy: null })).blockers).toEqual(["no plugin working copy"]);
    expect(gate(facts({ stage: 5, ...ok(5), copy: { hasGit: false, branch: null, head: null, dirtyCount: 0 } })).blockers).toEqual(["the working copy has no git"]);
  });
  it("leaves the working copy alone at other stages", () => {
    for (const stage of [1, 2, 3, 4, 6] as const) expect(gate(facts({ stage, ...ok(stage), copy: { hasGit: true, branch: "fix/x", head: "a", dirtyCount: 3 }, freeDiskGb: 0.1 }))).toEqual({ blockers: [], warnings: [] });
  });
  test("low disk blocks enter", () => expect(gate(facts({ stage: 5, ...ok(5), freeDiskGb: 1.2 })).blockers).toContain("1.2 GB free on disk, at least 2 needed"));
  it("rounds the disk down and does not guess when it was not measured", () => {
    expect(gate(facts({ stage: 5, ...ok(5), freeDiskGb: 1.96 })).blockers).toEqual(["1.9 GB free on disk, at least 2 needed"]);
    expect(gate(facts({ stage: 5, ...ok(5), freeDiskGb: 2 })).blockers).toEqual([]);
    expect(gate(facts({ stage: 5, ...ok(5), freeDiskGb: null })).blockers).toEqual(["free disk space not measured — a blind rollout does not start"]);
    expect(gate(facts({ stage: 5, ...ok(5), freeDiskGb: 0.5, minFreeDiskGb: 1.5 })).blockers).toEqual(["0.5 GB free on disk, at least 1.5 needed"]);
  });
  const doneEnter: AttemptFact = { kind: "enter", status: "done", step: "checked", error: null };
  test("accept", () => {
    expect(gate(facts({ stage: 6, attempt: doneEnter, live: null })).blockers).toContain("no live check yet");
    expect(gate(facts({ stage: 6, attempt: doneEnter, live: { verdict: "fail", invalid: null } })).warnings).toContain("the live check is red — accept anyway?");
  });
  it("accepts only an attempt that is done", () => {
    const at = (status: AttemptFact["status"], step: AttemptFact["step"], o: Partial<AttemptFact> = {}) =>
      gate(facts({ stage: 6, attempt: { kind: "enter", status, step, error: null, ...o }, live: null })).blockers;
    expect(gate(facts({ stage: 6, live: null })).blockers).toEqual(["there was no rollout attempt"]);
    expect(at("running", "locking")).toEqual(["rollout still running — wait for it to finish"]);
    expect(at("running", "installed", { kind: "rollback" })).toEqual(["rollback still running — wait for it to finish"]);
    expect(at("running", "moved", { kind: "reinstall" })).toEqual(["reinstall still running — wait for it to finish"]);
    expect(at("unknown", "installing")).toEqual(["install outcome unknown — «Install again», «Roll back» or «Disable»"]);
  });
  it("says why an attempt failed in the words of the card", () => {
    const failed = (step: AttemptFact["step"], o: Partial<AttemptFact> = {}) => {
      const a: AttemptFact = { kind: "enter", status: "failed", step, error: null, ...o };
      const blockers = gate(facts({ stage: 6, attempt: a, live: null })).blockers;
      expect(blockers).toEqual([cardState({ stage: 6, outcome: null, queued: false, stageThread: "idle", reviewsPending: 0, machineError: null, pluginError: null, attempt: a }).reason]);
      return blockers[0];
    };
    expect(failed("installing")).toBe("rollout failed: install not started — roll back or disable the plugin");
    expect(failed("installed", { kind: "rollback" })).toBe("rollback failed: install failed — disable the plugin");
    // Before the merge and at it the working copy is intact: no advice to roll back.
    expect(failed("recorded")).toBe("rollout failed: nothing was touched");
    expect(failed("moved")).toBe("rollout failed: the working copy is unchanged");
    expect(failed("moved", { error: `${UNEXPECTED_COPY}: HEAD c1d2e3f` })).toBe("the working copy is in an unexpected state — the rollout is stopped, decide yourself");
  });
  it("after «Disable» does not advise to roll back or disable the plugin again", () => {
    const resolved = (status: "failed" | "unknown", kind: AttemptFact["kind"] = "enter") =>
      gate(facts({ stage: 6, attempt: { kind, status, step: "installed", error: null, resolved: true }, live: null })).blockers;
    expect(resolved("failed")).toEqual(["rollout failed, plugin disabled — send the work back to the implementer («Fix forward»)"]);
    expect(resolved("unknown")).toEqual(["install outcome unknown, plugin disabled — send the work back to the implementer («Fix forward»)"]);
    expect(resolved("failed", "rollback")).toEqual(["rollback failed, plugin disabled — send the work back to the implementer («Fix forward»)"]);
  });
  it("«Roll out» is not pressed over a running attempt or an undecided failure after the move", () => {
    const at = (a: AttemptFact) => gate(facts({ stage: 5, ...ok(5), attempt: a })).blockers;
    const enter = (status: AttemptFact["status"], step: AttemptFact["step"], o: Partial<AttemptFact> = {}): AttemptFact => ({ kind: "enter", status, step, error: null, ...o });
    expect(at(enter("running", "locking"))).toEqual(["rollout still running — wait for it to finish"]);
    expect(at(enter("failed", "installed"))).toEqual(["rollout failed: install failed — roll back or disable the plugin"]);
    expect(at(enter("unknown", "installing"))).toEqual(["install outcome unknown — «Install again», «Roll back» or «Disable»"]);
    // A failure before the install (the working copy is intact or awaits the owner's decision) does not block a new rollout: the gate re-checks the copy.
    expect(at(enter("failed", "moved"))).toEqual([]);
    expect(at(enter("failed", "moved", { error: `${UNEXPECTED_COPY}: HEAD c1` }))).toEqual([]);
    // A failure the owner has resolved, a finished rollout or a finished rollback is no obstacle.
    expect(at(enter("failed", "installed", { resolved: true }))).toEqual([]);
    expect(at(enter("done", "checked"))).toEqual([]);
    expect(at(enter("done", "checked", { kind: "rollback" }))).toEqual([]);
  });
  it("has nothing to accept after a rollback", () => {
    expect(gate(facts({ stage: 6, attempt: { kind: "rollback", status: "done", step: "checked", error: null }, live: pass })).blockers).toEqual([
      "the plugin was rolled back — nothing to accept, send the work back to the implementer",
    ]);
  });
  it("accepts only on a live report that holds", () => {
    const done = doneEnter;
    expect(gate(facts({ stage: 6, attempt: done, live: { verdict: "pass", invalid: "code changed" } })).blockers).toEqual(["the live check report is unusable: code changed"]);
    expect(gate(facts({ stage: 6, attempt: done, live: { verdict: null, invalid: null } })).blockers).toEqual(["the live check report has no verdict"]);
    expect(gate(facts({ stage: 6, attempt: done, live: { verdict: "fail", invalid: null } }))).toEqual({ blockers: [], warnings: ["the live check is red — accept anyway?"] });
  });
  it("blocks on a queue and on stale stages at any stage", () => {
    for (const stage of [1, 2, 3, 4, 5, 6] as const) {
      expect(gate(facts({ stage, ...ok(stage), queued: true })).blockers).toEqual(["the work is queued for the machine"]);
      expect(gate(facts({ stage, ...ok(stage), staleBefore: [stageOf(3).title] })).blockers).toEqual([`«${stageOf(3).title}» is stale: what you approved has changed since`]);
    }
  });
});

describe("cardState", () => {
  const sf = (o: Partial<StateFacts> = {}): StateFacts => ({ stage: 1, outcome: null, queued: false, stageThread: "idle", reviewsPending: 0, machineError: null, pluginError: null, attempt: null, ...o });
  it("orders reasons by what the owner must know first", () => {
    expect(cardState(sf()).state).toBe("owner");
    expect(cardState(sf({ stageThread: "active" })).state).toBe("agent");
    expect(cardState(sf({ reviewsPending: 1 })).state).toBe("reviews");
    expect(cardState(sf({ queued: true })).state).toBe("queued");
    expect(cardState(sf({ machineError: "no connection" })).state).toBe("machine");
    expect(cardState(sf({ pluginError: "x" })).state).toBe("error");
    expect(cardState(sf({ stageThread: "error" })).state).toBe("error");
    expect(cardState(sf({ stageThread: "unknown" })).state).toBe("error");
    expect(cardState(sf({ stageThread: null })).state).toBe("error");
    expect(cardState(sf({ outcome: "canceled" })).state).toBe("canceled");
    expect(cardState(sf({ outcome: "done" })).state).toBe("done");
    // what matters more: outcome > plugin error > machine error > queue > reviews > thread
    const all = sf({ pluginError: "p", machineError: "m", queued: true, reviewsPending: 2, stageThread: "error" });
    expect(cardState(all)).toMatchObject({ state: "error", reason: "p" });
    expect(cardState({ ...all, pluginError: null })).toMatchObject({ state: "machine" });
    expect(cardState({ ...all, pluginError: null, machineError: null }).state).toBe("queued");
    expect(cardState({ ...all, pluginError: null, machineError: null, queued: false }).state).toBe("reviews");
    expect(cardState({ ...all, pluginError: null, machineError: null, queued: false, reviewsPending: 0 }).state).toBe("error");
    expect(cardState({ ...all, outcome: "canceled" }).state).toBe("canceled");
    expect(cardState({ ...all, outcome: "done" }).state).toBe("done");
  });
  it("gives every stage an owner turn once its agent has stopped", () => {
    for (const stage of [1, 2, 3, 4, 5, 6]) expect(cardState(sf({ stage })).state).toBe("owner");
    for (const stage of [1, 2, 3, 4, 5, 6]) expect(cardState(sf({ stage, stageThread: null })).state).toBe("error");
    expect(cardState(sf({ stage: 6 })).reason).toContain("«Accept»");
    expect(cardState(sf({ stage: 3 })).reason).not.toContain("«Accept»");
  });
  /** An attempt among the card facts; by default — a rollout without an error. */
  const att = (status: AttemptFact["status"], step: AttemptFact["step"], o: Partial<AttemptFact> = {}): AttemptFact => ({ kind: "enter", status, step, error: null, ...o });
  const at = (a: AttemptFact) => cardState(sf({ stage: 6, attempt: a }));
  test("card states of an attempt", () => {
    expect(at(att("running", "locking")).state).toBe("locking");
    expect(at(att("unknown", "installing")).state).toBe("unknown");
  });
  it("names the rollback of a new plugin for what it is: switching the plugin off, no lock and no install", () => {
    for (const step of ["recorded", "state-set", "checked"] as const) expect(at(att("running", step, { kind: "rollback", disableOnly: true }))).toEqual({ state: "installing", reason: "rollback running: disabling the plugin" });
    expect(at(att("running", "state-set", { kind: "rollback" })).reason).toBe("rollback: enabling or disabling the plugin");
  });
  it("says «needs configuration» at Rollout when the plugin came up waiting for its settings", () => {
    expect(cardState(sf({ stage: 6, needsConfiguration: true }))).toEqual({
      state: "owner", reason: "plugin rolled out, needs configuration; the agent checked it live: «Accept», «Roll back» or send it back to the implementer",
    });
    expect(cardState(sf({ stage: 6 })).reason).not.toContain("needs configuration");
    expect(cardState(sf({ stage: 5, needsConfiguration: true })).reason).not.toContain("needs configuration");
  });
  it("tells a running attempt by whether the build lock is already taken", () => {
    for (const step of ["recorded", "moved", "locking"] as const) expect(at(att("running", step)).state).toBe("locking");
    for (const step of ["locked", "installing", "installed", "released", "state-set", "checked"] as const) expect(at(att("running", step)).state).toBe("installing");
  });
  it("reads a step as what the attempt is doing now", () => {
    const reasons = {
      recorded: "rollout: attempt recorded, setting refs to the commits",
      moved: "rollout: the working copy's main branch is moving to the work commit",
      locking: "rollout: waiting for the build lock — another build or install is running",
      locked: "rollout: build lock taken, starting the install",
      installing: "rollout: starting the install job",
      installed: "rollout: the plugin is being installed",
      released: "rollout: install finished, releasing the build lock",
      "state-set": "rollout: enabling or disabling the plugin",
      checked: "rollout: reconciling the plugin state",
    } as const;
    for (const [step, reason] of Object.entries(reasons) as [AttemptFact["step"], string][]) expect(at(att("running", step)).reason).toBe(reason);
  });
  it("calls a rollback and a reinstall by their names", () => {
    expect(at(att("running", "moved", { kind: "rollback" })).reason).toBe("rollback: the working copy's main branch is going back to the previous commit");
    expect(at(att("running", "installed", { kind: "rollback" })).reason).toBe("rollback: the plugin is being installed");
    expect(at(att("running", "state-set", { kind: "rollback" })).state).toBe("installing");
    expect(at(att("running", "moved", { kind: "reinstall" })).reason).toBe("reinstall: checking the working copy against the rolled-out commit");
    expect(at(att("running", "installed", { kind: "reinstall" })).reason).toBe("reinstall: the plugin is being installed");
    expect(at(att("failed", "installed", { kind: "rollback" }))).toEqual({ state: "error", reason: "rollback failed: install failed — disable the plugin" });
    expect(at(att("failed", "recorded", { kind: "rollback" }))).toEqual({ state: "error", reason: "rollback failed: nothing was touched" });
    expect(at(att("failed", "state-set", { kind: "reinstall" }))).toEqual({
      state: "error",
      reason: "reinstall failed: could not enable or disable the plugin — roll back or disable the plugin",
    });
    expect(at(att("failed", "moved", { kind: "rollback", error: UNEXPECTED_COPY }))).toEqual({ state: "unexpected", reason: `${UNEXPECTED_COPY} — the rollback is stopped, decide yourself` });
    expect(at(att("failed", "moved", { kind: "reinstall", error: UNEXPECTED_COPY })).reason).toBe(`${UNEXPECTED_COPY} — the reinstall is stopped, decide yourself`);
  });
  it("does not tell to roll back when the copy was not touched", () => {
    expect(at(att("failed", "recorded"))).toEqual({ state: "error", reason: "rollout failed: nothing was touched" });
    expect(at(att("failed", "moved"))).toEqual({ state: "error", reason: "rollout failed: the working copy is unchanged" });
    for (const step of ["recorded", "moved"] as const) expect(at(att("failed", step)).reason).not.toMatch(/roll back|disable/);
  });
  it("says what failed by the step the attempt was on", () => {
    const reasons = {
      locking: "rollout failed: build lock not taken — roll back or disable the plugin",
      locked: "rollout failed: install not started — roll back or disable the plugin",
      installing: "rollout failed: install not started — roll back or disable the plugin",
      installed: "rollout failed: install failed — roll back or disable the plugin",
      released: "rollout failed: build lock not released — roll back or disable the plugin",
      "state-set": "rollout failed: could not enable or disable the plugin — roll back or disable the plugin",
      checked: "rollout failed: the plugin is not in the expected state — roll back or disable the plugin",
    } as const;
    for (const [step, reason] of Object.entries(reasons) as [AttemptFact["step"], string][]) expect(at(att("failed", step))).toEqual({ state: "error", reason });
  });
  it("takes an unexpected working copy for a failure, not for an unknown outcome", () => {
    expect(UNEXPECTED_COPY).toBe("the working copy is in an unexpected state");
    expect(at(att("failed", "moved", { error: UNEXPECTED_COPY }))).toEqual({ state: "unexpected", reason: "the working copy is in an unexpected state — the rollout is stopped, decide yourself" });
    expect(at(att("failed", "moved", { error: `${UNEXPECTED_COPY}: HEAD c1d2e3f` })).state).toBe("unexpected");
    expect(at(att("failed", "moved", { error: "git: refused" })).state).toBe("error");
    expect(at(att("failed", "installed", { error: null })).state).toBe("error");
  });
  it("says only that the outcome is unknown, and leaves the choice to the buttons", () => {
    for (const step of ["recorded", "moved", "installing", "installed"] as const) {
      expect(at(att("unknown", step))).toEqual({ state: "unknown", reason: "install outcome unknown — choose an action" });
    }
    expect(at(att("unknown", "moved", { error: UNEXPECTED_COPY })).state).toBe("unknown");
    expect(at(att("unknown", "installed")).reason).not.toContain("Install again");
  });
  it("lets an attempt speak before the card's own faults, but not before the outcome", () => {
    const busy = sf({ stage: 6, attempt: att("running", "locking"), pluginError: "p", machineError: "m", queued: true, reviewsPending: 1 });
    expect(cardState(busy).state).toBe("locking");
    expect(cardState({ ...busy, attempt: att("unknown", "installed") }).state).toBe("unknown");
    expect(cardState({ ...busy, attempt: att("failed", "moved", { error: UNEXPECTED_COPY }) }).state).toBe("unexpected");
    expect(cardState({ ...busy, outcome: "canceled" }).state).toBe("canceled");
    expect(cardState({ ...busy, outcome: "done" }).state).toBe("done");
  });
  it("treats a finished attempt as no news", () => {
    expect(at(att("done", "checked")).state).toBe("owner");
    expect(cardState(sf({ stage: 6, attempt: att("done", "checked"), stageThread: "active" })).state).toBe("agent");
    expect(cardState(sf({ stage: 6, attempt: att("done", "checked"), pluginError: "p" })).state).toBe("error");
  });
});
