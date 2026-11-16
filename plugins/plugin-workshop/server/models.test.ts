// Agent models of a work: chosen before the start per stage group, reviewers 0–2, reasoning effort, Implementation subagents.
import { describe, expect, test } from "vitest";
import type { WorkModels } from "../contract";
import { Catalog } from "./catalog";
import { DEFAULT_MODELS, checkModels, labelFor, modelsOf, reviewersOf } from "./models";
import { Pilot } from "./pilot";
import { kickoff, threadTitle } from "./regulations";
import { Rollout } from "./rollout";
import { stageOf } from "./stages";
import { idleStage, moveTo, reviewed, setup, started, versionOf } from "./test-utils";
import { verifyPath } from "./stages";

const custom: WorkModels = {
  docs: { providerId: "claude-code", model: "claude-sonnet-5-5", effort: "low", label: "Sonnet 5.5" },
  build: { providerId: "codex", model: "gpt-6-astra", effort: "high", label: "GPT-6-Astra" },
  check: DEFAULT_MODELS.check,
  pilot: { providerId: "claude-code", model: "claude-fable-5-1", effort: "max", label: "Fable 5.1" },
  subagents: { providerId: "claude-code", model: "claude-opus-5-5", effort: null, label: "Opus 5.5" },
  reviewers: [{ providerId: "claude-code", model: "claude-opus-5-5", effort: "high", label: "Opus 5.5" }],
};
/** A work with chosen models: the work row holds the choice as JSON (as Creation writes it). */
const withModels = (m: WorkModels) => started(setup(), { models: JSON.stringify(m) });

describe("work models", () => {
  test("without a choice — as before: Opus for stage agents, Fable and Astra reviewers, Sonnet subagents", () => {
    expect(modelsOf(null)).toEqual(DEFAULT_MODELS);
    expect(modelsOf("{corrupted")).toEqual(DEFAULT_MODELS);
    expect(reviewersOf(DEFAULT_MODELS)).toEqual(["fable", "astra"]);
  });

  test("stage agents and reviewers are spawned with the chosen provider, model and reasoning level; titles name the model", async () => {
    const s = await withModels(custom);
    const ctx = s.ports.threads.get(s.store.stageThread(s.id, 1)!.thread_id)!;
    expect(ctx).toMatchObject({ providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: "low" });
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.context}`, "# Context\n");
    expect((await s.engine.handOver(s.id, { expectedStage: 1, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    await s.engine.reconcile(s.id);
    const tech = s.ports.threads.get(s.store.stageThread(s.id, 2)!.thread_id)!;
    expect(tech).toMatchObject({ providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: "low" });
    idleStage(s, 2);
    await moveTo(s, 4);
    const build = s.ports.threads.get(s.store.stageThread(s.id, 4)!.thread_id)!;
    expect(build).toMatchObject({ providerId: "codex", model: "gpt-6-astra", reasoningLevel: "high" });
    await moveTo(s, 3);
    await s.engine.requestReview(s.id, 3);
    const reviews = s.store.runs(s.id).filter((r) => r.role === "review");
    expect(reviews.map((r) => r.who)).toEqual(["fable"]);
    const rv = s.ports.threads.get(reviews[0]!.thread_id)!;
    expect(rv).toMatchObject({ providerId: "claude-code", model: "claude-opus-5-5", reasoningLevel: "high" });
    expect(threadTitle(s.store.work(s.id)!, stageOf(3), "review", "fable", 1)).toBe(`${s.key} · review Opus 5.5 · high · ${stageOf(3).title} · r1`);
  });

  test("no reviewers: the gates do not wait for reviews, nothing starts by itself, «Send to review» says why", async () => {
    const s = await withModels({ ...custom, reviewers: [] });
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await moveTo(s, 3);
    await s.engine.reconcile(s.id);
    expect(s.store.runs(s.id).filter((r) => r.role === "review")).toHaveLength(0);
    const v = await s.engine.view(s.id);
    expect(v.blockers.join(" ")).not.toMatch(/review/i);
    await expect(s.engine.requestReview(s.id, 3)).rejects.toThrow("this work has no reviewers");
  });

  test("Implementation is told the subagents' model; the orchestrator runs on its own choice", async () => {
    const s = await withModels(custom);
    const w = s.store.work(s.id)!;
    // Implementation on Codex: no Claude subagents there — they run on the thread's model.
    expect(kickoff(w, stageOf(4), 1)).toContain("Run subagents on this thread's model");
    expect(kickoff({ ...w, models: JSON.stringify({ ...custom, build: DEFAULT_MODELS.build }) }, stageOf(4), 1)).toContain("task implementers — `opus`");
    expect(kickoff({ ...w, models: null }, stageOf(4), 1)).toContain("task implementers — `sonnet`");
    const catalog = new Catalog(s.store, s.ports);
    const pilot = new Pilot(s.store, s.ports, s.engine, new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true }));
    await pilot.start(s.id, "");
    expect(s.ports.threads.get(s.store.pilot(s.id)!.thread_id!)).toMatchObject({ providerId: "claude-code", model: "claude-fable-5-1", reasoningLevel: "max" });
  });

  test("a choice is checked against bb's list; labels come from bb; a default passes even when its provider does not answer", async () => {
    const s = setup();
    const catalog = { providers: await s.ports.modelCatalog() };
    expect(checkModels(DEFAULT_MODELS, catalog).problems).toEqual([]);
    expect(checkModels({ ...DEFAULT_MODELS, docs: { ...DEFAULT_MODELS.docs, model: "claude-nope" } }, catalog).problems).toEqual([
      "Documents (Context, Feasibility, Spec, Mockup): claude-code has no model claude-nope",
    ]);
    expect(checkModels({ ...DEFAULT_MODELS, check: { ...DEFAULT_MODELS.check, effort: "ultra" } }, catalog).problems).toEqual(["Verification and Rollout: claude-opus-5-5 has no effort level ultra"]);
    expect(checkModels({ ...DEFAULT_MODELS, subagents: { providerId: "codex", model: "gpt-6-astra", effort: null, label: "x" } }, catalog).problems[0]).toContain("Implementation subagents — Claude models only");
    // The label comes from bb's list, not from the form.
    expect(checkModels({ ...DEFAULT_MODELS, docs: { ...DEFAULT_MODELS.docs, label: "<script>" } }, catalog).models.docs.label).toBe("Opus 5.5");
    // Codex returned no models (login expired): the default reviewer passes, a hand-picked one does not.
    const noCodex = { providers: catalog.providers.map((p) => (p.id === "codex" ? { ...p, models: [], error: "auth_required" } : p)) };
    expect(checkModels(DEFAULT_MODELS, noCodex).problems).toEqual([]);
    expect(checkModels({ ...DEFAULT_MODELS, build: { providerId: "codex", model: "gpt-6-astra", effort: null, label: "GPT-6-Astra" } }, noCodex).problems).toEqual([
      "Implementation: codex is not returning models right now (auth_required)",
    ]);
    // No list at all — only the defaults.
    expect(checkModels(DEFAULT_MODELS, null).problems).toEqual([]);
    expect(checkModels({ ...DEFAULT_MODELS, docs: { ...DEFAULT_MODELS.docs, model: "claude-sonnet-5-5" } }, null).problems).toEqual([
      "Documents (Context, Feasibility, Spec, Mockup): the bb model list did not arrive — only the default is allowed right now",
    ]);
  });

  test("two reviewers on the same model are told apart by number", () => {
    const opus = { providerId: "claude-code", model: "claude-opus-5-5", effort: null, label: "Opus 5.5" };
    const m = { ...DEFAULT_MODELS, reviewers: [opus, opus] };
    expect([labelFor(m, "review", 3, "fable"), labelFor(m, "review", 3, "astra")]).toEqual(["Opus 5.5 · #1", "Opus 5.5 · #2"]);
    expect(labelFor(DEFAULT_MODELS, "review", 3, "astra")).toBe("GPT-6-Astra");
  });

  test("no reviewers: the agents are told so, the verifier writes no «Reviews» section, the work rolls out from Verification without reviews", async () => {
    const s = await withModels({ ...custom, reviewers: [] });
    const w = s.store.work(s.id)!;
    expect(kickoff(w, stageOf(3), 1)).toContain("This work has no reviews");
    expect(kickoff(w, stageOf(5), 1)).toContain("no «## Reviews» section is needed");
    expect(kickoff({ ...w, models: null }, stageOf(5), 1)).toContain("The reviewers (Fable 5.1, GPT-6-Astra)");
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await moveTo(s, 5);
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "all ok\nVERDICT: PASS");
    await s.engine.reconcile(s.id);
    expect(s.store.runs(s.id).filter((r) => r.role === "review")).toHaveLength(0);
    const v = await s.engine.view(s.id);
    expect(v.blockers).toEqual([]);
  });

  test("one reviewer: a round is one thread, and a missing one is filled in by that single slot", async () => {
    const s = await withModels(custom);
    idleStage(s);
    s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    await moveTo(s, 5);
    s.ports.files.set(`${s.env}:${verifyPath(s.key, 1)}`, "all ok\nVERDICT: PASS");
    reviewed(s, 5, "verify", await versionOf(s));
    const v = await s.engine.view(s.id);
    // reviewed() adds two; the work has one reviewer: the gate looks only at the "fable" slot.
    expect(v.blockers.filter((b) => b.includes("GPT-6-Astra"))).toEqual([]);
  });
});
