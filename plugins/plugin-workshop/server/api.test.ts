import { describe, expect, it, vi } from "vitest";
import { Api, cardOf } from "./api";
import { Catalog } from "./catalog";
import { Rollout } from "./rollout";
import { COLUMNS, pluginDir, SELF_ID } from "./stages";
import { entered, idleStage, setup, started } from "./test-utils";

/** A board over the work «hello» (stage 1): the plugin is installed and running, the catalog is reconciled. */
async function rig(o: { installed?: boolean } = {}) {
  const s = await started(setup());
  if (o.installed !== false) s.ports.plugins.add({ id: "hello" });
  const catalog = new Catalog(s.store, s.ports);
  const rollout = new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true });
  const api = new Api({ store: s.store, catalog, engine: s.engine, rollout });
  await catalog.sync();
  return { ...s, catalog, rollout, api };
}
type Rig = Awaited<ReturnType<typeof rig>>;
const card = async (r: Rig, id: string) => (await r.api.board()).plugins.find((p) => p.id === id)!;

describe("Api.board", () => {
  it("columns in order («Mockup» hidden while its stage is off and empty) and a card per plugin, by id", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: "mail" });
    r.ports.git.setRepo(pluginDir("mail"), {});
    await r.catalog.sync();
    const b = await r.api.board();
    expect(b.columns).toEqual(COLUMNS.filter((c) => c.key !== "mockup").map((c) => ({ key: c.key, title: c.title })));
    expect(b.columns.map((c) => c.key)).toEqual(["context", "tech", "tz", "build", "live", "off"]);
    expect(b.plugins.map((p) => p.id)).toEqual(["hello", "mail"]);
  });

  it("a card with a work sits in the column of its stage and carries the work", async () => {
    const r = await rig();
    expect(await card(r, "hello")).toMatchObject({
      id: "hello", name: "hello", column: "context", bbState: "running", stateStale: false,
      work: { id: r.id, key: r.key, stage: 1, state: "agent", stale: false },
    });
  });

  it("without a work: installed and enabled — «In production», disabled or not installed — «Retired»", async () => {
    const r = await rig();
    r.store.finish(r.id, "canceled", 1);
    r.ports.plugins.add({ id: "mail" });
    r.ports.plugins.add({ id: "tags", enabled: false, state: "disabled" });
    r.ports.git.setRepo(pluginDir("mail"), {});
    r.ports.git.setRepo(pluginDir("tags"), {});
    r.ports.fs.put(pluginDir("raw"));
    r.ports.git.setRepo(pluginDir("raw"), {});
    await r.catalog.sync();
    expect(await card(r, "hello")).toMatchObject({ column: "live", work: null });
    expect(await card(r, "mail")).toMatchObject({ column: "live", bbState: "running", work: null });
    expect(await card(r, "tags")).toMatchObject({ column: "off", bbState: "disabled" });
    expect(await card(r, "raw")).toMatchObject({ column: "off", bbState: "not-installed", labels: expect.arrayContaining(["not installed"]) });
  });

  it("the state in bb is shown beside the column; a list that did not come is «stale data»", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: "hello", state: "error", error: "boom" });
    await r.catalog.sync();
    expect(await card(r, "hello")).toMatchObject({ column: "context", bbState: "error", stateStale: false });
    r.ports.plugins.failList = true;
    await r.catalog.sync();
    expect(await card(r, "hello")).toMatchObject({ bbState: "error", stateStale: true, labels: expect.arrayContaining(["stale data"]) });
  });

  it("«needs configuration» is a label, not a failure", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: "hello", state: "needs-configuration" });
    await r.catalog.sync();
    expect(await card(r, "hello")).toMatchObject({ bbState: "needs-configuration", labels: expect.arrayContaining(["needs configuration"]) });
  });

  it("a vanished plugin lands in «Retired» with the reason as a label", async () => {
    const r = await rig();
    r.store.finish(r.id, "canceled", 1);
    r.ports.plugins.items.delete("hello");
    await r.ports.fs.remove(pluginDir("hello"));
    await r.catalog.sync();
    const c = await card(r, "hello");
    expect(c).toMatchObject({ column: "off", bbState: "not-installed" });
    expect(c.labels).toContain("gone: plugin not installed, no folder");
  });

  it("the reasons «Rework» is closed are the catalog's", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: "mail" });
    r.ports.git.setRepo(pluginDir("mail"), { dirtyCount: 4 });
    await r.catalog.sync();
    expect((await card(r, "mail")).reworkBlockers).toContain("4 uncommitted changes in the working copy");
    expect((await card(r, "hello")).reworkBlockers).toEqual([`work ${r.key} is already in progress`]);
  });

  it("availability comes from Rollout, per card", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: "tags", enabled: false, state: "disabled" });
    r.ports.git.setRepo(pluginDir("tags"), {});
    await r.catalog.sync();
    expect((await card(r, "hello")).availability).toMatchObject({ disable: null, enable: "the plugin is already enabled", rollback: "no rollback point" });
    expect((await card(r, "tags")).availability).toMatchObject({ enable: null, disable: "the plugin is already disabled" });
  });

  it("the workshop is on the board, but cannot rework or remove itself", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: SELF_ID });
    r.ports.git.setRepo(pluginDir(SELF_ID), {});
    await r.catalog.sync();
    const c = await card(r, SELF_ID);
    expect(c.reworkBlockers).toContain("the Workshop is not reworked through itself");
    expect(c.availability.disable).toBe("the Workshop cannot disable itself");
  });

  it("does not read git per request: facts come from the cache, the list and the jobs are asked once", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: "mail" });
    r.ports.git.setRepo(pluginDir("mail"), {});
    await r.catalog.sync();
    const git = vi.spyOn(r.ports.git, "facts");
    const list = vi.spyOn(r.ports.plugins, "list");
    const jobs = vi.spyOn(r.ports.plugins, "jobs");
    await r.api.board();
    await r.api.board();
    expect(git).not.toHaveBeenCalled();
    expect([list.mock.calls.length, jobs.mock.calls.length]).toEqual([2, 2]);
  });

  it("a work that is still being created is on the board in its column without a key", async () => {
    const r = await rig({ installed: false });
    r.store.upsertSeen({ id: "fresh", name: "Fresh", dir: pluginDir("fresh"), source: null }, 1);
    r.store.addWork({ id: "w_new", plugin_id: "fresh", kind: "new", tasks_project_id: "tp1", host_id: "h", title: "New plugin «Fresh»", request: "R", created_at: 1 });
    expect((await card(r, "fresh")).work).toEqual({ id: "w_new", key: null, stage: 1, state: "new", reason: "creating the work", stale: false, pilot: null });
    expect((await card(r, "fresh")).column).toBe("context");
  });

  it("cardOf is a pure function of the facts and availability", async () => {
    const r = await rig();
    const [facts] = await r.catalog.cachedFacts();
    const av = { rollback: "x", reinstall: "y", disable: null, enable: "z", cancelInstall: "w", adopt: "v" };
    expect(cardOf(facts!, av).availability).toBe(av);
  });
});

describe("Api.plugin", () => {
  it("adds the working copy, the installed commit, the last attempt and the past tasks", async () => {
    const r = await rig();
    idleStage(r);
    const a = await entered(r);
    r.store.setInstalled("hello", "h1");
    const v = await r.api.plugin("hello");
    expect(v).toMatchObject({
      id: "hello", source: `path:${pluginDir("hello")}`, dir: pluginDir("hello"), branch: "main", dirtyCount: 0, installedSha: "h1",
      attempt: { id: a, kind: "enter", status: "done", beforeSha: "c0", targetSha: "h1" },
      work: { id: r.id },
      pastTasks: [],
    });
    expect(v.head).toMatch(/^c0de/);
  });

  it("lists the past tasks of the plugin: key, outcome, when", async () => {
    const r = await rig();
    r.store.finish(r.id, "canceled", 777);
    const v = await r.api.plugin("hello");
    expect(v.work).toBeNull();
    expect(v.pastTasks).toEqual([{ key: r.key, outcome: "canceled", finishedAt: 777 }]);
  });

  it("a canceled creation has no task and is not a past task", async () => {
    const r = await rig({ installed: false });
    r.store.upsertSeen({ id: "fresh", name: "Fresh", dir: pluginDir("fresh"), source: null }, 1);
    r.store.addWork({ id: "w_new", plugin_id: "fresh", kind: "new", tasks_project_id: "tp1", host_id: "h", title: "T", request: "R", created_at: 1 });
    r.store.finish("w_new", "canceled", 5);
    expect((await r.api.plugin("fresh")).pastTasks).toEqual([]);
  });

  it("a folder that is not a repository: no branch, head or edits", async () => {
    const r = await rig();
    r.ports.plugins.add({ id: "google" });
    r.ports.fs.put(pluginDir("google"));
    await r.catalog.sync();
    expect(await r.api.plugin("google")).toMatchObject({ branch: null, head: null, dirtyCount: 0, reworkBlockers: ["no git"] });
  });

  it("a plugin whose folder is gone: the working copy is unknown", async () => {
    const r = await rig();
    r.store.finish(r.id, "canceled", 1);
    await r.ports.fs.remove(pluginDir("hello"));
    await r.catalog.sync();
    expect(await r.api.plugin("hello")).toMatchObject({ branch: null, head: null, dirtyCount: null });
  });

  it("reads git live, not from the cache", async () => {
    const r = await rig();
    r.ports.git.setRepo(pluginDir("hello"), { dirtyCount: 3 });
    expect((await r.api.plugin("hello")).dirtyCount).toBe(3);
  });

  it("a plugin that is not on the board is an error", async () => {
    const r = await rig();
    await expect(r.api.plugin("nobody")).rejects.toThrow("plugin nobody is not on the board");
  });
});

describe("Api.work", () => {
  it("the engine's view plus the availability of the plugin", async () => {
    const r = await rig();
    const v = await r.api.work(r.id);
    expect(v.work).toMatchObject({ id: r.id, key: r.key, created: true, stage: 1 });
    expect(v.availability).toEqual(await r.rollout.availability("hello"));
    expect(v.stages).toHaveLength(6);
  });

  it("on the Rollout stage it carries the attempt id and the actions on the plugin", async () => {
    const r = await rig();
    idleStage(r);
    const a = await entered(r);
    const v = await r.api.work(r.id);
    expect(v.attempt!.id).toBe(a);
    expect(v.availability.disable).toBeNull();
    expect(v.availability.rollback).not.toBeUndefined();
  });

  it("a work that is not created yet: no stages, no version, the journal and the state say what happens", async () => {
    const r = await rig({ installed: false });
    r.store.upsertSeen({ id: "fresh", name: "Fresh", dir: pluginDir("fresh"), source: null }, 1);
    r.store.addWork({ id: "w_new", plugin_id: "fresh", kind: "new", tasks_project_id: "tp1", host_id: "h", title: "New plugin «Fresh»", request: "a command", created_at: 5 });
    r.store.setState("w_new", "error", "scaffold: failed", false, 6);
    r.store.log("w_new", "error", "scaffold: failed", 6);
    const v = await r.api.work("w_new");
    expect(v.work).toMatchObject({
      id: "w_new", key: null, title: "New plugin «Fresh»", request: "a command", pluginId: "fresh", kind: "new", created: false, projectId: null,
      stage: 1, state: "error", reason: "scaffold: failed", queued: false, environmentId: null, outcome: null, canRestart: false,
    });
    expect([v.version, v.stages, v.blockers, v.warnings, v.baseAhead, v.attempt, v.sendBack]).toEqual([null, [], [], [], false, null, { needsForce: false, fixForwardOffered: false }]);
    expect(v.events).toEqual([{ at: 6, kind: "error", text: "scaffold: failed" }]);
    expect(v.availability).toMatchObject({ rollback: expect.any(String) });
  });

  it("an unknown work is an error", async () => {
    const r = await rig();
    await expect(r.api.work("nope")).rejects.toThrow("work not found");
  });

  it("the view is valid for the contract's schema", async () => {
    const { workViewSchema, pluginViewSchema, boardSchema } = await import("../contract");
    const r = await rig();
    idleStage(r);
    await entered(r);
    const view = await r.api.work(r.id);
    expect(workViewSchema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view);
    const plugin = await r.api.plugin("hello");
    expect(pluginViewSchema.parse(JSON.parse(JSON.stringify(plugin)))).toEqual(plugin);
    const board = await r.api.board();
    expect(boardSchema.parse(JSON.parse(JSON.stringify(board)))).toEqual(board);
  });
});
