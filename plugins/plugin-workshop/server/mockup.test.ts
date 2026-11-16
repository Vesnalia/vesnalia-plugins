// The «Mockup» stage and «Adopt as rolled out».
import { describe, expect, it } from "vitest";
import { Api } from "./api";
import { Catalog, columnOf, reworkBlockers } from "./catalog";
import { renderPlugin } from "./cli";
import { gate } from "./gates";
import { inputsChanged, kickoff, liveCheckPrompt, returnPacket, reviewerPrompt } from "./regulations";
import { Rollout, touchesData } from "./rollout";
import { mockupGuidePath } from "./rules";
import { COLUMNS, STAGE_ORDER, atOrAfter, before, mockupDir, nextStage, pluginDir, stageOf } from "./stages";
import { staleStages } from "./versions";
import { attempt, commitWork, idleStage, moveTo, reviewed, setup, started, versionOf, type Started } from "./test-utils";

const withMockup = () => started(setup(2, 2, false, true));
const tz = (s: Started) => s.ports.files.set(`${s.env}:${s.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
const index = (s: Started) => `${mockupDir(s.key)}/index.html`;
/** The agent draws the mockup and commits it (the mockup fingerprint is cached per clean HEAD). */
let commits = 0;
const draw = (s: Started, html = "<html><body>mockup</body></html>") => {
  s.ports.files.set(`${s.env}:${index(s)}`, html);
  commitWork(s, `m${++commits}`);
};
const put = (s: Started, rel: string, text: string) => {
  s.ports.files.set(`${s.env}:${rel}`, text);
  commitWork(s, `m${++commits}`);
};
const forward = async (s: Started) => s.engine.handOver(s.id, { expectedStage: s.store.work(s.id)!.stage, expectedVersion: await versionOf(s), note: "", force: false });

/** A work on Spec with a finished spec and a clean review. */
async function onTz(s: Started): Promise<void> {
  idleStage(s);
  await moveTo(s, 3);
  tz(s);
  reviewed(s, 3, "tz", await versionOf(s));
}

describe("stage order", () => {
  it("puts «Mockup» (7) between Spec and Implementation and compares by order, not by number", () => {
    expect(STAGE_ORDER).toEqual([1, 2, 3, 7, 4, 5, 6]);
    expect(before(7, 4)).toBe(true);
    expect(before(3, 7)).toBe(true);
    expect(before(6, 7)).toBe(false);
    expect(atOrAfter(4, 7)).toBe(true);
    expect(nextStage(3, true)).toBe(7);
    expect(nextStage(7, true)).toBe(4);
    expect(nextStage(3, false)).toBe(4);
    expect(() => nextStage(6, true)).toThrow("nothing to hand over to");
    expect(stageOf(7)).toMatchObject({ title: COLUMNS.find((c) => c.key === "mockup")!.title, column: "mockup", reviewed: false, agent: true });
  });
});

describe("the «Mockup» stage", () => {
  it("goes Spec → Mockup → Implementation; Mockup needs mockup/index.html; with the stage switched off Spec → Implementation", async () => {
    const s = await withMockup();
    await onTz(s);
    expect((await forward(s)).ok).toBe(true);
    expect(s.store.work(s.id)!.stage).toBe(7);
    const agent = s.store.stageThread(s.id, 7)!;
    const prompt = s.ports.threads.get(agent.thread_id)!.prompt;
    expect(prompt).toContain(`You are the agent of the «${stageOf(7).title}» stage`);
    expect(prompt).toContain(index(s));
    expect(prompt).toContain("::inline-vis");
    expect(prompt).toContain(mockupGuidePath());
    idleStage(s, 7);
    const v = await s.engine.view(s.id);
    expect(v.blockers).toEqual([`no ${index(s)} — no mockup yet`]);
    expect((await forward(s)).ok).toBe(false);
    draw(s);
    expect((await forward(s)).ok).toBe(true);
    expect(s.store.work(s.id)!.stage).toBe(4);

    const off = await started(setup());
    await onTz(off);
    expect((await forward(off)).ok).toBe(true);
    expect(off.store.work(off.id)!.stage).toBe(4);
  });

  it("warns about open owner items on the step into Implementation — from Mockup, not from Spec", async () => {
    const s = await withMockup();
    await onTz(s);
    s.ports.files.set(`${s.env}:docs/workshop/${s.key}/owner.md`, "- [ ] weather API key\n");
    expect((await s.engine.view(s.id)).warnings).toEqual([]);
    expect((await forward(s)).ok).toBe(true);
    idleStage(s, 7);
    draw(s);
    expect((await s.engine.view(s.id)).warnings).toEqual(["needed from you before implementation: weather API key"]);
  });

  it("a mockup changed after approval makes Mockup stale; «Reconfirm» takes it back without agents; Spec changes stale both", async () => {
    const s = await withMockup();
    await onTz(s);
    await forward(s);
    idleStage(s, 7);
    draw(s);
    await forward(s);
    idleStage(s, 4);
    expect((await s.engine.view(s.id)).reconfirm).toEqual([]);
    draw(s, "<html><body>another mockup</body></html>");
    const v = await s.engine.view(s.id);
    expect(v.reconfirm).toEqual([7]);
    expect(v.blockers).toContain(`«${stageOf(7).title}» is stale: what you approved has changed since`);
    await s.engine.reconfirm(s.id, { expectedStage: 4, stage: 7, expectedVersion: (await versionOf(s))! });
    expect((await s.engine.view(s.id)).reconfirm).toEqual([]);
    // Snapshots are derived: changing them makes nothing stale.
    put(s, `${mockupDir(s.key)}/desktop.png`, "png");
    expect((await s.engine.view(s.id)).reconfirm).toEqual([]);
    // The spec is an input of Mockup too: a spec change makes both stale, in work order.
    put(s, s.docs.tz, "### Task 1: B\nMIGRATIONS: no\nNAV: none\n");
    expect((await s.engine.view(s.id)).reconfirm).toEqual([3, 7]);
  });

  it("returns go by work order: Implementation → Mockup and Mockup → Spec are allowed, Mockup → Implementation is not", async () => {
    const s = await withMockup();
    await onTz(s);
    await forward(s);
    idleStage(s, 7);
    await expect(s.engine.sendBack(s.id, { expectedStage: 7, toStage: 4, reason: "x" })).rejects.toThrow("left of the current one");
    draw(s);
    await forward(s);
    idleStage(s, 4);
    await s.engine.sendBack(s.id, { expectedStage: 4, toStage: 7, reason: "fix the mockup" });
    expect(s.store.work(s.id)).toMatchObject({ stage: 7, iteration: 2 });
    idleStage(s, 7);
    await s.engine.sendBack(s.id, { expectedStage: 7, toStage: 3, reason: "the spec does not add up" });
    expect(s.store.work(s.id)).toMatchObject({ stage: 3, iteration: 3 });
  });

  it("shows the mockup on the work page (index first, then snapshots), serves its files and nothing outside", async () => {
    const s = await withMockup();
    await onTz(s);
    await forward(s);
    idleStage(s, 7);
    s.ports.files.set(`${s.env}:${mockupDir(s.key)}/phone.png`, "png");
    s.ports.files.set(`${s.env}:${mockupDir(s.key)}/desktop.png`, "png");
    draw(s);
    const v = await s.engine.view(s.id);
    expect(v.stages.map((x) => x.no)).toEqual([1, 2, 3, 7, 4, 5, 6]);
    expect(v.stages.find((x) => x.no === 7)!.files.map((f) => f.label)).toEqual(["Mockup", "Mockup · desktop.png", "Mockup · phone.png"]);
    expect((await s.engine.file(s.id, index(s))).text).toContain("mockup");
    await expect(s.engine.file(s.id, `${mockupDir(s.key)}/../tz.md`)).rejects.toThrow("this file cannot be opened");
    expect(columnOf({ work: s.store.work(s.id)!, row: {} as never, installed: null, git: null } as never)).toBe("mockup");
  });

  it("the mockup fingerprint follows its text files only; versions written before «Mockup» are not stale", async () => {
    const s = await withMockup();
    expect((await versionOf(s))!.mockupSha).toBeNull();
    draw(s);
    const a = (await versionOf(s))!.mockupSha;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    put(s, `${mockupDir(s.key)}/desktop.png`, "png");
    expect((await versionOf(s))!.mockupSha).toBe(a);
    put(s, `${mockupDir(s.key)}/icons/x.svg`, "<svg/>");
    expect((await versionOf(s))!.mockupSha).toBe(a);
    put(s, `${mockupDir(s.key)}/extra.css`, "body{}");
    expect((await versionOf(s))!.mockupSha).not.toBe(a);
    // A hand-over recorded before «Mockup» existed has no such field: for a work without a mockup it does not go stale.
    const t = await started(setup(2, 2, false, true));
    idleStage(t);
    const v = (await versionOf(t))!;
    const { mockupSha: _drop, ...old } = v;
    t.store.addHandover({ work_id: t.id, stage: 1, action: "forward", to_stage: 2, version: old, note: "", forced: false, problems: [], at: 1 });
    t.store.casStage(t.id, 1, 2, 1, 2);
    expect((await t.engine.view(t.id)).reconfirm).toEqual([]);
  });

  it("the gate of Mockup is its own; a work on Implementation still reads its stages by order", () => {
    const base = {
      stage: 7 as const, paths: { context: "c", tech: "t", tz: "docs/workshop/K/tz.md", owner: "o" }, owner: null, reviewsHanded: null, autoReview: true,
      exists: { context: true, tech: true, tz: true }, tech: null, migrations: null, reviews: null, progress: null, verify: null, live: null, attempt: null,
      copy: null, baseAhead: false, staleBefore: [], dirty: false, queued: false, freeDiskGb: null, minFreeDiskGb: 2, mockupStage: true,
    };
    expect(gate({ ...base, mockup: { index: false } }).blockers).toEqual(["no docs/workshop/K/mockup/index.html — no mockup yet"]);
    expect(gate({ ...base, mockup: { index: true } })).toEqual({ blockers: [], warnings: [] });
  });

  it("makes the mockup an obligation for Implementation, Verification, the reviewers and the live check", async () => {
    const s = await withMockup();
    const w = s.store.work(s.id)!;
    const dir = mockupDir(s.key);
    expect(kickoff(w, stageOf(4), 1)).toContain(`The interface follows the approved mockup \`${dir}/\``);
    expect(kickoff(w, stageOf(5), 1)).toContain(`Compare the interface with the approved mockup \`${dir}/index.html\``);
    expect(kickoff(w, stageOf(3), 1)).toContain("The next stage is «Mockup»");
    expect(reviewerPrompt(w, stageOf(5), "astra", 1)).toContain(`does the interface match the approved mockup \`${dir}/\``);
    const a = attempt(s);
    expect(liveCheckPrompt(w, 1, s.store.attempt(a)!)).toContain(`${dir}/desktop.png`);
    expect(kickoff(w, stageOf(7), 1)).toContain("frontend-design");
  });
});

describe("«Adopt as rolled out»", () => {
  async function rig(o: { dirty?: boolean; migrations?: boolean; work?: boolean } = {}) {
    const s = await started(setup());
    const dir = pluginDir("mail");
    s.ports.plugins.add({ id: "mail" });
    s.ports.git.setRepo(dir, {});
    const catalog = new Catalog(s.store, s.ports);
    const rollout = new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true });
    await catalog.sync();
    const introduced = (await s.ports.git.facts(dir)).head!;
    s.store.setInstalled("mail", introduced);
    const head = s.ports.git.commit(dir);
    if (o.migrations) s.ports.git.diffs.set(`${introduced}..${head}`, ["server/migrations.ts"]);
    if (o.dirty) s.ports.git.setRepo(dir, { dirtyCount: 2 });
    await catalog.sync();
    return { ...s, catalog, rollout, dir, introduced, head };
  }
  const finish = async (r: Awaited<ReturnType<typeof rig>>) => {
    for (const j of await r.ports.plugins.jobs()) if (["queued", "running"].includes(j.state)) r.ports.plugins.setJob(j.id, "succeeded");
    const a = r.store.currentAttempt("mail")!;
    await r.rollout.advance(a.id);
    return r.store.attempt(a.id)!;
  };

  it("installs the current main under the lock, records it as introduced and keeps the old commit as the rollback point", async () => {
    const r = await rig();
    expect((await r.rollout.availability("mail")).adopt).toBeNull();
    await r.rollout.adopt("mail", "MCP server fix");
    const a = await finish(r);
    expect(a).toMatchObject({ kind: "enter", work_id: null, before_sha: r.introduced, target_sha: r.head, migrations: 0, status: "done" });
    expect(a.note).toBe("adopted as rolled out: MCP server fix");
    expect(r.store.plugin("mail")!.installed_sha).toBe(r.head);
    await r.catalog.sync();
    const av = await r.rollout.availability("mail");
    expect(av.adopt).toBe("the main branch is at the rolled-out commit — nothing to adopt");
    expect(av.rollback).toBeNull();
  });

  it("a change that touched migrations closes the rollback after adoption", async () => {
    const r = await rig({ migrations: true });
    await r.rollout.adopt("mail", "x");
    expect(await finish(r)).toMatchObject({ migrations: 1, status: "done" });
    await r.catalog.sync();
    expect((await r.rollout.availability("mail")).rollback).toBe("the adopted change touched data (migrations) or is too large to check — rollback is impossible, only «Disable»");
  });

  it("refuses without a reason, on a dirty copy, while a work is open, for the Workshop itself and when there is nothing to adopt", async () => {
    const r = await rig({ dirty: true });
    await expect(r.rollout.adopt("mail", "  ")).rejects.toThrow("a reason is required");
    await expect(r.rollout.adopt("mail", "x")).rejects.toThrow("uncommitted changes in the working copy — commit or discard first");
    const s = await rig();
    // A work on the `hello` plugin itself (started) is open: adopting goes through it.
    s.ports.plugins.add({ id: "hello" });
    s.store.setInstalled("hello", "c0");
    await s.catalog.sync();
    expect((await s.rollout.availability("hello")).adopt).toMatch(/^work TEST-\d+ is open on the plugin — the change goes through it$/);
    const t = await rig();
    t.store.setInstalled("mail", t.head);
    await t.catalog.sync();
    expect((await t.rollout.availability("mail")).adopt).toBe("the main branch is at the rolled-out commit — nothing to adopt");
  });
});

describe("«Mockup» review fixes", () => {
  it("a work already on Mockup goes on when the stage is switched off; with it off a return to Mockup is refused and the view hides it", async () => {
    expect(nextStage(7, false)).toBe(4);
    const s = await withMockup();
    await onTz(s);
    await forward(s);
    idleStage(s, 7);
    draw(s);
    // The same engine, but the stage was switched off while the work stood on «Mockup».
    const off = new (s.engine.constructor as new (...a: unknown[]) => typeof s.engine)(s.store, s.ports, () => ({ maxBuilding: 2, minFreeDiskGb: 2, autoReview: false, mockup: false }));
    expect((await off.handOver(s.id, { expectedStage: 7, expectedVersion: await versionOf(s), note: "", force: false })).ok).toBe(true);
    expect(s.store.work(s.id)!.stage).toBe(4);
    // The work has been on «Mockup», so it stays the work's stage: it can be sent back there.
    idleStage(s, 4);
    expect((await off.view(s.id)).stages.map((x) => x.no)).toContain(7);
    const t = await started(setup());
    idleStage(t);
    await moveTo(t, 4);
    await expect(t.engine.sendBack(t.id, { expectedStage: 4, toStage: 7, reason: "x" })).rejects.toThrow("the «Mockup» stage is off — the work cannot be sent back to it");
    expect((await t.engine.view(t.id)).stages.map((x) => x.no)).not.toContain(7);
  });

  it("an attempt without a work (adopted change) is not the work's own and its rollback waits while a work is open", async () => {
    const s = await started(setup());
    idleStage(s);
    await moveTo(s, 5);
    attempt(s, { work: null });
    expect((await s.engine.view(s.id)).attempt).toBeNull();
    s.ports.plugins.add({ id: s.w.plugin_id });
    const catalog = new Catalog(s.store, s.ports);
    const rollout = new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true });
    await catalog.sync();
    expect((await rollout.availability(s.w.plugin_id)).rollback).toMatch(/^work TEST-\d+ is open on the plugin — it goes first$/);
  });

  it("decides whether an adopted change touched data by the diff: code with schema or migrations — yes; docs and tests — no", () => {
    const d = (file: string, ...lines: string[]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...lines].join("\n");
    expect(touchesData(["server/expert.ts"], d("server/expert.ts", "+  const prompt = 'MCP server';"), false)).toBe(false);
    expect(touchesData(["server.ts"], d("server.ts", "+  db.exec('ALTER TABLE runs ADD COLUMN x');"), false)).toBe(true);
    expect(touchesData(["server/store.ts"], d("server/store.ts", "-  const MIGRATIONS = [];"), false)).toBe(true);
    expect(touchesData(["server/migrations.ts"], "", false)).toBe(true);
    expect(touchesData(["docs/migrations.md", "server/migrations.test.ts"], d("docs/migrations.md", "+ CREATE TABLE in the text"), false)).toBe(false);
    expect(touchesData([], "", true)).toBe(true);
  });

  it("stale stages come in work order; returns to Mockup tell what to do with the mockup", async () => {
    const s = await withMockup();
    const w = s.store.work(s.id)!;
    expect(staleStages([{ stage: 7, version: { iteration: 1, headSha: null, dirty: false, contextSha: "x", techSha: null, tzSha: null } }, { stage: 6, version: { iteration: 1, headSha: null, dirty: false, contextSha: "x", techSha: null, tzSha: null } }], { iteration: 1, headSha: null, dirty: false, contextSha: "y", techSha: null, tzSha: null })).toEqual([7, 6]);
    const back = returnPacket({ ...w, iteration: 2 }, stageOf(7), stageOf(4), "move the button to the right", 2);
    expect(back).toContain(`Edit the mockup \`${mockupDir(s.key)}/index.html\``);
    expect(back).toContain(`\`::inline-vis{file="${mockupDir(s.key)}/index.html" height="900"}\` — in the message on a line of its own and without backticks`);
    expect(inputsChanged(w, stageOf(7))).toContain("Edit the mockup");
    const k = kickoff(w, stageOf(7), 1);
    expect(k).toContain(`sample: \`::inline-vis{file="${mockupDir(s.key)}/index.html" height="900"}\``);
    expect(k).toContain("without backticks");
    // The packet goes to the thread as a message: it has no directive outside backticks, so bb does not render it as «file not found».
    for (const text of [k, back]) expect(text.replace(/`[^`]*`/g, "")).not.toContain("::inline-vis");
  });

  it("a mockup folder that cannot be read is a blocker in words, not a broken page", async () => {
    const s = await withMockup();
    await onTz(s);
    await forward(s);
    idleStage(s, 7);
    const list = s.ports.list.bind(s.ports);
    s.ports.list = (async (env: string, dir: string) => {
      if (dir.endsWith("/mockup")) throw new Error("too many files in docs/workshop/X/mockup");
      return list(env, dir);
    }) as typeof s.ports.list;
    commitWork(s, "many-files");
    const v = await s.engine.view(s.id);
    expect(v.blockers).toContain("mockup not read: too many files in docs/workshop/X/mockup");
    expect(v.version!.mockupSha).toMatch(/^unreadable:/);
    // The failure is not cached: once the folder reads again, the fingerprint on the same HEAD is the real one.
    s.ports.list = list;
    expect((await s.engine.view(s.id)).version!.mockupSha).toBeNull();
  });

  it("an unresolved adoption closes «Rework» until the owner decides it; the CLI shows why it was adopted", async () => {
    const s = await started(setup());
    const dir = pluginDir("mail");
    s.ports.plugins.add({ id: "mail" });
    s.ports.git.setRepo(dir, {});
    const catalog = new Catalog(s.store, s.ports);
    const rollout = new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true });
    await catalog.sync();
    s.store.setInstalled("mail", (await s.ports.git.facts(dir)).head!);
    s.ports.git.commit(dir);
    await catalog.sync();
    await rollout.adopt("mail", "MCP fix");
    const blockers = async () => reworkBlockers((await catalog.one("mail"))!);
    expect(await blockers()).toContain("the plugin is being installed — wait");
    for (const j of await s.ports.plugins.jobs()) if (["queued", "running"].includes(j.state)) s.ports.plugins.setJob(j.id, "failed");
    await rollout.advance(s.store.currentAttempt("mail")!.id);
    expect(s.store.currentAttempt("mail")!.status).toBe("failed");
    expect(await blockers()).toContain("the last plugin installation is unresolved — first «Roll back», «Install again» or «Disable»");
    const api = new Api({ store: s.store, catalog, engine: s.engine, rollout });
    expect(renderPlugin(await api.plugin("mail"))).toContain("; adopted as rolled out: MCP fix");
    await rollout.setEnabled("mail", false);
    expect((await blockers()).some((b) => b.startsWith("the last plugin installation"))).toBe(false);
  });

  it("reads more schema changes as data and an unparsable diff header as code", () => {
    const d = (head: string, ...lines: string[]) => [head, ...lines].join("\n");
    expect(touchesData(["server/db.ts"], d("diff --git a/server/db.ts b/server/db.ts", "+  db.pragma('user_version = 3');"), false)).toBe(true);
    expect(touchesData(["server/db.ts"], d("diff --git a/server/db.ts b/server/db.ts", "+  CREATE UNIQUE INDEX one ON t(x);"), false)).toBe(true);
    expect(touchesData(["server/db.ts"], d("diff --git a/server/db.ts b/server/db.ts", "+  CREATE VIRTUAL TABLE f USING fts5(x);"), false)).toBe(true);
    // A document, then a file with a space in its path: its lines do not count as the document.
    const quoted = d("diff --git a/docs/a.md b/docs/a.md", "+ text", 'diff --git "a/server/my store.ts" "b/server/my store.ts"', "+ ALTER TABLE t ADD c");
    expect(touchesData(["docs/a.md", "server/my store.ts"], quoted, false)).toBe(true);
    // A document renamed to code is code.
    expect(touchesData(["server/x.ts"], d("diff --git a/docs/x.md b/server/x.ts", "+ DROP TABLE t"), false)).toBe(true);
  });

  it("the board shows the Mockup column only while the stage is on or a work stands on it", async () => {
    const off = await started(setup());
    const cat = new Catalog(off.store, off.ports);
    const api = (s: Started, c: Catalog) => new Api({ store: s.store, catalog: c, engine: s.engine, rollout: new Rollout(s.store, s.ports, s.engine, c, { cancelSupported: true }) });
    expect((await api(off, cat).board()).columns.map((c) => c.key)).not.toContain("mockup");
    const on = await withMockup();
    expect((await api(on, new Catalog(on.store, on.ports)).board()).columns.map((c) => c.key)).toContain("mockup");
  });
});
