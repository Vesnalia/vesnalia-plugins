import { beforeEach, describe, expect, it, vi } from "vitest";
import { aliaStateOf, Catalog, columnOf, labelsOf, reworkBlockers, type PluginFacts } from "./catalog";
import { FakePorts } from "./fake-ports";
import type { GitFacts, InstalledPlugin, PluginState } from "./ports";
import { PLUGINS_ROOT, pluginDir, SELF_ID } from "./stages";
import type { AttemptRow, PluginRow, Store, WorkRow } from "./store";
import { memoryStore } from "./test-utils";

interface Opts {
  id: string;
  /** null — the plugin is not installed. */
  installed?: null;
  state?: PluginState;
  enabled?: boolean;
  source?: string;
  /** The working copy folder exists (yes by default); if not, `git` in the facts is null. */
  dirExists?: boolean;
  /** `git: null` with `dirExists` — the folder exists but is not a repository. */
  git?: null;
  branch?: string | null;
  head?: string | null;
  dirtyCount?: number;
  installedSha?: string | null;
  listFailedAt?: number | null;
  gitError?: string;
  work?: Partial<WorkRow> | null;
  attempt?: Partial<AttemptRow> | null;
  ghRemote?: string | null;
  ghAhead?: number;
  ghBehind?: number;
  ghError?: string;
}
const SHA = "a".repeat(40);

/** Card facts without a store or ports: the catalog's pure functions are checked on them. */
function f(o: Opts): PluginFacts {
  const dirExists = o.dirExists ?? true;
  const installed: InstalledPlugin | null =
    o.installed === null
      ? null
      : { id: o.id, name: o.id, state: o.state ?? "running", enabled: o.enabled ?? true, source: o.source ?? `path:${pluginDir(o.id)}`, rootDir: pluginDir(o.id), error: null };
  const git: GitFacts | null = !dirExists
    ? null
    : o.git === null
      ? { hasGit: false, branch: null, head: null, dirtyCount: 0 }
      : { hasGit: true, branch: o.branch === undefined ? "main" : o.branch, head: o.head === undefined ? SHA : o.head, dirtyCount: o.dirtyCount ?? 0 };
  const row: PluginRow = {
    id: o.id, name: o.id, dir: dirExists ? pluginDir(o.id) : null, source: installed?.source ?? null, project_id: null,
    installed_sha: o.installedSha ?? null, current_attempt: null,
    last_state: installed?.state ?? null, last_enabled: installed ? (installed.enabled ? 1 : 0) : null, state_at: 1, list_failed_at: o.listFailedAt ?? null,
    first_seen: 1, last_seen: 1, gone_reason: null,
    gh_remote: o.ghRemote ?? null, gh_ahead: o.ghAhead ?? null, gh_behind: o.ghBehind ?? null, gh_checked_at: o.ghRemote !== undefined ? 1 : null, gh_error: o.ghError ?? null, gh_rolled: 0, hidden_at: null,
  };
  const work = o.work ? ({ id: "w1", plugin_id: o.id, task_key: "TEST-12", stage: 1, created: 1, ...o.work } as WorkRow) : null;
  const attempt = o.attempt ? ({ id: "a1", plugin_id: o.id, status: "done", ...o.attempt } as AttemptRow) : null;
  return { row, installed, git, work, attempt, ...(o.gitError ? { gitError: o.gitError } : {}) };
}

describe("reworkBlockers", () => {
  it("google without git", () => expect(reworkBlockers(f({ id: "google", git: null, dirExists: true }))).toContain("no git"));
  it("does not read branch or edits of a folder without git", () => expect(reworkBlockers(f({ id: "google", git: null }))).toEqual(["no git"]));
  it("newproject with 4 uncommitted", () => expect(reworkBlockers(f({ id: "newproject", dirtyCount: 4 }))).toContain("4 uncommitted changes in the working copy"));
  it("uses the singular and the plural for the number of changes", () => {
    expect(reworkBlockers(f({ id: "x", dirtyCount: 1 }))).toContain("1 uncommitted change in the working copy");
    expect(reworkBlockers(f({ id: "x", dirtyCount: 5 }))).toContain("5 uncommitted changes in the working copy");
  });
  it("slack on a branch", () =>
    expect(reworkBlockers(f({ id: "slack", branch: "chore/plugin-sdk-update" }))).toContain("the working copy is on branch chore/plugin-sdk-update, not main"));
  it("a detached HEAD is not main", () => expect(reworkBlockers(f({ id: "x", branch: null }))).toEqual(["the working copy is not on branch main (detached HEAD)"]));
  it("a repository without commits", () => expect(reworkBlockers(f({ id: "x", head: null, branch: null }))).toEqual(["the repository has no commits"]));
  it("a plugin installed from elsewhere", () =>
    expect(reworkBlockers(f({ id: "runner", source: "path:/srv/alia/sources/runner-1a2b3c4" }))[0]).toMatch(/^installed from /));
  it("a source with no working copy in the plugins root", () => {
    const blockers = reworkBlockers(f({ id: "notes", source: "git:github.com/acme/bb-plugin-notes@main", dirExists: false }));
    expect(blockers).toEqual([`source outside ${PLUGINS_ROOT}`]);
    expect(reworkBlockers(f({ id: "studio", source: "path:/srv/alia/local-plugins/studio/releases/0.1.0", dirExists: false }))).toEqual([`source outside ${PLUGINS_ROOT}`]);
  });
  it("workshop itself", () => expect(reworkBlockers(f({ id: SELF_ID }))).toContain("the Workshop is not reworked through itself"));
  it("an open work", () => expect(reworkBlockers(f({ id: "mail", work: { stage: 3, task_key: "TEST-12" } }))).toContain("work TEST-12 is already in progress"));
  it("an open work whose task is not made yet", () => expect(reworkBlockers(f({ id: "mail", work: { stage: 1, task_key: null, created: 0 } }))).toEqual(["a work is already in progress (being created)"]));
  it("a clean plugin on main from its own folder has no blockers", () => expect(reworkBlockers(f({ id: "mail" }))).toEqual([]));
  it("a plugin that is not installed but has its folder is allowed", () => expect(reworkBlockers(f({ id: "draft", installed: null }))).toEqual([]));
  it("a disabled plugin is allowed", () => expect(reworkBlockers(f({ id: "tags", state: "disabled", enabled: false }))).toEqual([]));
  it("accepts the bare path form of a source", () => expect(reworkBlockers(f({ id: "mail", source: `${pluginDir("mail")}/` }))).toEqual([]));
  it("no folder at all", () => expect(reworkBlockers(f({ id: "mail", dirExists: false }))).toEqual(["no working copy folder"]));
  it("an unreadable repository blocks with the reason", () => expect(reworkBlockers(f({ id: "mail", dirExists: false, gitError: "timeout" }))).toEqual(["could not read git: timeout"]));
});

describe("columns, states and labels", () => {
  it("columns and labels", () => {
    expect(columnOf(f({ id: "tags", state: "disabled", enabled: false }))).toBe("off");
    expect(labelsOf(f({ id: "draft", installed: null }))).toContain("not installed");
    const x = f({ id: "lex", state: "error", work: { stage: 4 } });
    expect(columnOf(x)).toBe("build");
    expect(aliaStateOf(x).state).toBe("error");
    const y = f({ id: "hello", work: { stage: 6 } });
    expect(columnOf(y)).toBe("live");
    expect(labelsOf(y)).toContain("awaiting acceptance");
  });
  it("a work puts the card into the column of its stage", () => {
    const col = (stage: number) => columnOf(f({ id: "x", work: { stage } }));
    expect([1, 2, 3, 4, 5, 6].map(col)).toEqual(["context", "tech", "tz", "build", "build", "live"]);
  });
  it("a card with a work stays in its column even when the plugin is disabled or not installed", () => {
    expect(columnOf(f({ id: "x", state: "disabled", enabled: false, work: { stage: 3 } }))).toBe("tz");
    expect(columnOf(f({ id: "x", installed: null, work: { stage: 1 } }))).toBe("context");
  });
  it("without a work the column follows VesnALIA: enabled — live, disabled and absent — off", () => {
    expect(columnOf(f({ id: "x" }))).toBe("live");
    expect(columnOf(f({ id: "x", installed: null }))).toBe("off");
  });
  it("a stage the board does not know does not break the column", () => expect(columnOf(f({ id: "x", work: { stage: 0 } }))).toBe("context"));
  it("a red state stays in its column", () => {
    for (const state of ["error", "incompatible", "missing"] as const) expect(columnOf(f({ id: "x", state }))).toBe("live");
  });
  it("a plugin waiting for its settings is labelled «needs configuration»", () => {
    expect(labelsOf(f({ id: "x", state: "needs-configuration" }))).toContain("needs configuration");
    expect(labelsOf(f({ id: "x" }))).not.toContain("needs configuration");
  });
  it("alia state is shown apart from the column; not installed is its own state", () => {
    expect(aliaStateOf(f({ id: "x", state: "needs-configuration" }))).toEqual({ state: "needs-configuration", stale: false });
    expect(aliaStateOf(f({ id: "x", installed: null }))).toEqual({ state: "not-installed", stale: false });
  });
  it("stale means the last list failed — one rule", () => {
    expect(aliaStateOf(f({ id: "x", listFailedAt: 5 })).stale).toBe(true);
    expect(labelsOf(f({ id: "x", listFailedAt: 5 }))).toContain("stale data");
    expect(labelsOf(f({ id: "x" }))).not.toContain("stale data");
  });
  it("«main branch ≠ rolled-out commit» appears when HEAD left the installed commit", () => {
    expect(labelsOf(f({ id: "x", installedSha: "b".repeat(40) }))).toContain("main branch ≠ rolled-out commit");
    expect(labelsOf(f({ id: "x", installedSha: SHA }))).not.toContain("main branch ≠ rolled-out commit");
    expect(labelsOf(f({ id: "x", installedSha: null }))).not.toContain("main branch ≠ rolled-out commit");
    expect(labelsOf(f({ id: "x", installedSha: "b".repeat(40), dirExists: false }))).not.toContain("main branch ≠ rolled-out commit");
  });
  it("the commit label stays quiet while an attempt is moving HEAD", () => {
    const o = { id: "x", installedSha: "b".repeat(40), attempt: { status: "running" as const } };
    expect(labelsOf(f(o))).not.toContain("main branch ≠ rolled-out commit");
    expect(labelsOf(f({ ...o, attempt: { status: "unknown" } }))).toContain("main branch ≠ rolled-out commit");
  });
  it("«awaiting acceptance» only at stage 6", () => {
    expect(labelsOf(f({ id: "x", work: { stage: 5 } }))).not.toContain("awaiting acceptance");
    expect(labelsOf(f({ id: "x", work: { stage: 6 } }))).toContain("awaiting acceptance");
  });
});

describe("Catalog", () => {
  let store: Store;
  let ports: FakePorts;
  let catalog: Catalog;
  beforeEach(() => {
    store = memoryStore();
    ports = new FakePorts();
    catalog = new Catalog(store, ports);
  });
  /** An installed plugin with its working copy on main. */
  const install = (id: string, o: Partial<InstalledPlugin> = {}, repo: Partial<GitFacts> | null = {}) => {
    ports.plugins.add({ id, ...o });
    if (repo) ports.git.setRepo(pluginDir(id), repo);
  };

  it("list failure keeps last confirmed state", async () => {
    install("mail");
    await catalog.sync();
    ports.plugins.failList = true;
    await catalog.sync();
    const x = (await catalog.one("mail"))!;
    expect(columnOf(x)).toBe("live");
    expect(aliaStateOf(x)).toEqual({ state: "running", stale: true });
    expect(labelsOf(x)).toContain("stale data");
    expect(labelsOf(x)).not.toContain("not installed");
  });
  it("list failure keeps the state confirmed before, as stored (without an earlier sync)", async () => {
    store.upsertSeen({ id: "mail", name: "Mail", dir: pluginDir("mail"), source: `path:${pluginDir("mail")}` }, 1);
    store.setLastState("mail", { state: "running", enabled: true }, 1);
    ports.plugins.failList = true;
    await catalog.sync();
    const x = (await catalog.one("mail"))!;
    expect(columnOf(x)).toBe("live");
    expect(aliaStateOf(x)).toEqual({ state: "running", stale: true });
  });
  it("list failure does not overwrite the known source, name or folder", async () => {
    install("mail", { name: "Mailbox" });
    await catalog.sync();
    const before = store.plugin("mail")!;
    ports.plugins.failList = true;
    await catalog.sync();
    const after = store.plugin("mail")!;
    expect([after.name, after.dir, after.source]).toEqual([before.name, before.dir, before.source]);
    expect(after.source).toBe(`path:${pluginDir("mail")}`);
    expect(after.list_failed_at).not.toBeNull();
  });
  it("after a failed list the next good one clears the stale mark", async () => {
    install("mail");
    await catalog.sync();
    ports.plugins.failList = true;
    await catalog.sync();
    ports.plugins.failList = false;
    await catalog.sync();
    expect(aliaStateOf((await catalog.one("mail"))!)).toEqual({ state: "running", stale: false });
  });
  it("a failed list never marks a plugin gone, even when its folder is missing", async () => {
    install("mail");
    await catalog.sync();
    ports.plugins.items.delete("mail");
    await ports.fs.remove(pluginDir("mail"));
    ports.plugins.failList = true;
    await catalog.sync();
    expect(store.plugin("mail")!.gone_reason).toBeNull();
    expect(aliaStateOf((await catalog.one("mail"))!)).toEqual({ state: "running", stale: true });
  });
  it("a failed list leaves a gone plugin alone, and a good one clears the stale mark of a plugin that is not installed", async () => {
    install("old");
    install("tags");
    await catalog.sync();
    ports.plugins.items.delete("old");
    ports.plugins.items.delete("tags");
    await ports.fs.remove(pluginDir("old"));
    await catalog.sync();
    ports.plugins.failList = true;
    await catalog.sync();
    expect(store.plugin("old")!.list_failed_at).toBeNull();
    expect(aliaStateOf((await catalog.one("tags"))!)).toEqual({ state: "not-installed", stale: true });
    ports.plugins.failList = false;
    await catalog.sync();
    expect(aliaStateOf((await catalog.one("tags"))!)).toEqual({ state: "not-installed", stale: false });
  });
  it("a failed list does not create cards for folders it cannot classify", async () => {
    ports.fs.put(pluginDir("fresh"));
    ports.plugins.failList = true;
    await catalog.sync();
    expect(store.plugin("fresh")).toBeNull();
  });
  it("a vanished plugin stays with a reason", async () => {
    install("old");
    await catalog.sync();
    ports.plugins.items.delete("old");
    await ports.fs.remove(pluginDir("old"));
    await catalog.sync();
    const row = store.plugin("old")!;
    expect(row.gone_reason).toBeTruthy();
    expect(row.last_state).toBeNull();
    const x = (await catalog.one("old"))!;
    expect(columnOf(x)).toBe("off");
    expect(aliaStateOf(x)).toEqual({ state: "not-installed", stale: false });
    expect(labelsOf(x)).toContain("not installed");
    expect((await catalog.facts()).map((p) => p.row.id)).toContain("old");
  });
  it("a plugin with an open work is never marked gone", async () => {
    store.upsertSeen({ id: "hello", name: "Greeter", dir: pluginDir("hello"), source: null }, 1);
    store.addWork({ id: "w1", plugin_id: "hello", kind: "new", tasks_project_id: "tp1", host_id: "h1", title: "T", request: "R", created_at: 1 });
    await catalog.sync();
    expect(store.plugin("hello")!.gone_reason).toBeNull();
    expect(columnOf((await catalog.one("hello"))!)).toBe("context");
  });
  it("a plugin that comes back is no longer gone", async () => {
    install("old");
    await catalog.sync();
    ports.plugins.items.delete("old");
    await ports.fs.remove(pluginDir("old"));
    await catalog.sync();
    install("old");
    await catalog.sync();
    expect(store.plugin("old")!.gone_reason).toBeNull();
    expect(aliaStateOf((await catalog.one("old"))!).state).toBe("running");
  });
  it("an uninstalled plugin whose folder stays loses its confirmed state, but is not gone", async () => {
    install("tags");
    await catalog.sync();
    ports.plugins.items.delete("tags");
    await catalog.sync();
    const row = store.plugin("tags")!;
    expect(row.gone_reason).toBeNull();
    expect(row.last_state).toBeNull();
    const x = (await catalog.one("tags"))!;
    expect(aliaStateOf(x)).toEqual({ state: "not-installed", stale: false });
    expect(columnOf(x)).toBe("off");
    expect(reworkBlockers(x)).toEqual([]);
  });
  it("a plugin that is not installed keeps the name the owner entered, not the scaffold manifest's", async () => {
    store.upsertSeen({ id: "hello", name: "Greeter", dir: pluginDir("hello"), source: null }, 1);
    ports.fs.put(pluginDir("hello"));
    ports.plugins.folderNames.set("hello", "hello");
    await catalog.sync();
    expect(store.plugin("hello")!.name).toBe("Greeter");
    await catalog.sync();
    expect(store.plugin("hello")!.name).toBe("Greeter");
  });
  it("once the plugin is installed, VesnALIA's name wins", async () => {
    store.upsertSeen({ id: "hello", name: "Greeter", dir: pluginDir("hello"), source: null }, 1);
    install("hello", { name: "Hello, world" });
    await catalog.sync();
    expect(store.plugin("hello")!.name).toBe("Hello, world");
  });
  it("a folder without an installation gets a card", async () => {
    ports.fs.put(pluginDir("draft"));
    ports.plugins.folderNames.set("draft", "Draft");
    await catalog.sync();
    const row = store.plugin("draft")!;
    expect([row.name, row.dir, row.source]).toEqual(["Draft", pluginDir("draft"), null]);
    expect(labelsOf((await catalog.one("draft"))!)).toContain("not installed");
  });
  it("a folder listing failure only stops the discovery of new folders; installed plugins still sync", async () => {
    install("mail");
    await catalog.sync();
    ports.plugins.failFolders = true;
    install("lex");
    ports.fs.put(pluginDir("fresh"));
    await catalog.sync();
    expect(store.plugin("lex")!.last_state).toBe("running");
    expect(store.plugin("fresh")).toBeNull();
    expect(store.plugin("mail")!.list_failed_at).toBeNull();
  });
  it("an absence is confirmed by fs.exists even when the folder listing failed", async () => {
    install("old");
    await catalog.sync();
    ports.plugins.items.delete("old");
    await ports.fs.remove(pluginDir("old"));
    ports.plugins.failFolders = true;
    await catalog.sync();
    expect(store.plugin("old")!.gone_reason).toBeTruthy();
  });
  it("the folder is taken from fs.exists when the folder listing failed", async () => {
    install("mail");
    ports.plugins.failFolders = true;
    await catalog.sync();
    expect(store.plugin("mail")!.dir).toBe(pluginDir("mail"));
  });
  it("alia still says running, but the folder is gone: the card shows missing", async () => {
    install("mail");
    await ports.fs.remove(pluginDir("mail"));
    await catalog.sync();
    const x = (await catalog.one("mail"))!;
    expect(aliaStateOf(x).state).toBe("missing");
    expect(x.installed!.error).toContain(pluginDir("mail"));
    expect(columnOf(x)).toBe("live");
    expect(x.git).toBeNull();
    expect(store.plugin("mail")!.gone_reason).toBeNull();
  });
  it("states, enabled flag and the error text come from the list", async () => {
    install("lex", { state: "error", error: "boom" });
    install("tags", { state: "disabled", enabled: false });
    await catalog.sync();
    const lex = (await catalog.one("lex"))!;
    expect([aliaStateOf(lex).state, lex.installed!.error, columnOf(lex)]).toEqual(["error", "boom", "live"]);
    const tags = (await catalog.one("tags"))!;
    expect([aliaStateOf(tags).state, tags.installed!.enabled, columnOf(tags)]).toEqual(["disabled", false, "off"]);
  });
  it("a plugin whose root folder VesnALIA does not name is taken as VesnALIA says", async () => {
    install("mail", { rootDir: null });
    await catalog.sync();
    expect(aliaStateOf((await catalog.one("mail"))!).state).toBe("running");
  });
  it("a missing plugin keeps its old name", async () => {
    install("mail", { name: "Mailbox" });
    await catalog.sync();
    ports.plugins.add({ id: "mail", name: null, state: "missing" });
    await catalog.sync();
    expect(store.plugin("mail")!.name).toBe("Mailbox");
    expect(aliaStateOf((await catalog.one("mail"))!).state).toBe("missing");
  });
  it("facts carry the working copy, the open work and the current attempt", async () => {
    install("mail", {}, { branch: "feature/x", dirtyCount: 2 });
    await catalog.sync();
    store.addWork({ id: "w1", plugin_id: "mail", kind: "rework", tasks_project_id: "tp1", host_id: "h1", title: "T", request: "R", created_at: 1 });
    store.addAttempt({ id: "a1", plugin_id: "mail", work_id: "w1", kind: "enter", before_sha: SHA, target_sha: SHA, migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1, started_at: 1 });
    const x = (await catalog.one("mail"))!;
    expect(x.git).toMatchObject({ hasGit: true, branch: "feature/x", dirtyCount: 2 });
    expect([x.work!.id, x.attempt!.id]).toEqual(["w1", "a1"]);
    expect(reworkBlockers(x)).toEqual(expect.arrayContaining(["a work is already in progress (being created)", "2 uncommitted changes in the working copy"]));
  });
  it("one returns null for a plugin not on the board", async () => expect(await catalog.one("nobody")).toBeNull());
  it("facts lists every card by id", async () => {
    install("b");
    install("a");
    await catalog.sync();
    expect((await catalog.facts()).map((p) => p.row.id)).toEqual(["a", "b"]);
  });
  it("one broken repository does not break the board", async () => {
    install("a");
    install("b");
    await catalog.sync();
    ports.git.failFacts.add(pluginDir("a"));
    const all = await catalog.facts();
    const a = all.find((p) => p.row.id === "a")!;
    expect(a.git).toBeNull();
    expect(a.gitError).toContain("git");
    expect(reworkBlockers(a)[0]).toContain("could not read git");
    expect(all.find((p) => p.row.id === "b")!.git).not.toBeNull();
  });
  it("the working copy is looked up even if the row has no folder yet", async () => {
    store.upsertSeen({ id: "hello", name: "Greeter", dir: null, source: null }, 1);
    ports.git.setRepo(pluginDir("hello"), {});
    ports.fs.put(pluginDir("hello"));
    expect((await catalog.one("hello"))!.git).toMatchObject({ hasGit: true });
  });
  it("does not run git on a folder that has been removed since the sync", async () => {
    install("mail");
    await catalog.sync();
    await ports.fs.remove(pluginDir("mail"));
    ports.git.failFacts.add(pluginDir("mail"));
    const x = (await catalog.one("mail"))!;
    expect([x.git, x.gitError]).toEqual([null, undefined]);
  });
  it("one failing row does not stop the sync of the others, and the failure is reported", async () => {
    install("a");
    install("b");
    ports.fs.failExists.add(pluginDir("a"));
    await expect(catalog.sync()).rejects.toThrow("exists");
    expect(store.plugin("b")!.last_state).toBe("running");
  });

  // The board does not run git on every request: working copy facts are read on catalog reconcile and on changes (`refreshGit`), the rest comes from the database.
  describe("the git cache of the board", () => {
    const head = (facts: PluginFacts[], id: string) => facts.find((p) => p.row.id === id)!.git?.head;
    it("sync reads git of every card; the boards after it come from the cache", async () => {
      install("a");
      install("b");
      await catalog.sync();
      const spy = vi.spyOn(ports.git, "facts");
      const first = await catalog.cachedFacts();
      await catalog.cachedFacts();
      expect(spy).not.toHaveBeenCalled();
      expect(first.map((p) => p.row.id)).toEqual(["a", "b"]);
      expect(first[0]!.git).toMatchObject({ hasGit: true, branch: "main" });
    });
    it("a card that is not in the cache yet is read once", async () => {
      store.upsertSeen({ id: "fresh", name: "Fresh", dir: pluginDir("fresh"), source: null }, 1);
      ports.fs.put(pluginDir("fresh"));
      ports.git.setRepo(pluginDir("fresh"), {});
      const spy = vi.spyOn(ports.git, "facts");
      expect((await catalog.cachedFacts())[0]!.git).toMatchObject({ hasGit: true });
      await catalog.cachedFacts();
      expect(spy).toHaveBeenCalledTimes(1);
    });
    it("git changes show after refreshGit of that plugin, and only of it", async () => {
      install("a");
      install("b");
      await catalog.sync();
      const oldA = head(await catalog.cachedFacts(), "a");
      ports.git.setRepo(pluginDir("a"), { head: "new-a" });
      ports.git.setRepo(pluginDir("b"), { head: "new-b" });
      expect(head(await catalog.cachedFacts(), "a")).toBe(oldA);
      await catalog.refreshGit(["a"]);
      const after = await catalog.cachedFacts();
      expect([head(after, "a"), head(after, "b") === "new-b"]).toEqual(["new-a", false]);
      await catalog.sync();
      expect(head(await catalog.cachedFacts(), "b")).toBe("new-b");
    });
    it("refreshGit without names re-reads every card", async () => {
      install("a");
      install("b");
      await catalog.sync();
      ports.git.setRepo(pluginDir("a"), { head: "x1" });
      ports.git.setRepo(pluginDir("b"), { head: "x2" });
      await catalog.refreshGit();
      const all = await catalog.cachedFacts();
      expect([head(all, "a"), head(all, "b")]).toEqual(["x1", "x2"]);
    });
    it("what the store knows — the open work and the current attempt — is never cached", async () => {
      install("mail");
      await catalog.sync();
      expect((await catalog.cachedFacts())[0]!.work).toBeNull();
      store.addWork({ id: "w1", plugin_id: "mail", kind: "rework", tasks_project_id: "tp1", host_id: "h1", title: "T", request: "R", created_at: 1 });
      store.addAttempt({ id: "a1", plugin_id: "mail", work_id: "w1", kind: "enter", before_sha: SHA, target_sha: SHA, migrations: 0, was_installed: 1, was_enabled: 1, want_enabled: 1, started_at: 1 });
      const x = (await catalog.cachedFacts())[0]!;
      expect([x.work!.id, x.attempt!.id]).toEqual(["w1", "a1"]);
      expect(x.installed).toMatchObject({ state: "running" });
    });
    it("one() reads live and refreshes the cache entry", async () => {
      install("a");
      await catalog.sync();
      ports.git.setRepo(pluginDir("a"), { head: "live" });
      expect((await catalog.one("a"))!.git!.head).toBe("live");
      const spy = vi.spyOn(ports.git, "facts");
      expect(head(await catalog.cachedFacts(), "a")).toBe("live");
      expect(spy).not.toHaveBeenCalled();
    });
    it("a git failure is cached as an error and cleared by the next refresh", async () => {
      install("a");
      await catalog.sync();
      ports.git.failFacts.add(pluginDir("a"));
      await catalog.refreshGit(["a"]);
      const bad = (await catalog.cachedFacts())[0]!;
      expect([bad.git, bad.gitError]).toEqual([null, expect.stringContaining("git")]);
      ports.git.failFacts.delete(pluginDir("a"));
      await catalog.refreshGit(["a"]);
      expect((await catalog.cachedFacts())[0]!.git).toMatchObject({ hasGit: true });
    });
    it("parallel refreshes of one plugin share their reads: the running one and one more for everybody who came meanwhile", async () => {
      install("a");
      await catalog.sync();
      const spy = vi.spyOn(ports.git, "facts");
      await Promise.all([catalog.refreshGit(["a"]), catalog.refreshGit(["a"]), catalog.refreshGit(["a"])]);
      expect(spy).toHaveBeenCalledTimes(2);
    });
    it("a change that happens while a read is running is seen by the refresh asked after it", async () => {
      install("a");
      await catalog.sync();
      let release!: () => void;
      const parked = new Promise<void>((r) => (release = r));
      const real = ports.git.facts.bind(ports.git);
      let n = 0;
      vi.spyOn(ports.git, "facts").mockImplementation(async (dir) => {
        const first = n++ === 0;
        const seen = await real(dir);
        if (first) await parked;
        return seen;
      });
      const old = catalog.refreshGit(["a"]);
      await vi.waitFor(() => expect(n).toBe(1));
      ports.git.setRepo(pluginDir("a"), { head: "after-the-change" });
      const later = catalog.refreshGit(["a"]);
      release();
      await Promise.all([old, later]);
      expect(head(await catalog.cachedFacts(), "a")).toBe("after-the-change");
    });
    it("a late finishing older read does not overwrite a newer one", async () => {
      install("a");
      await catalog.sync();
      let release!: () => void;
      const parked = new Promise<void>((r) => (release = r));
      const real = ports.git.facts.bind(ports.git);
      let n = 0;
      vi.spyOn(ports.git, "facts").mockImplementation(async (dir) => {
        const first = n++ === 0;
        const seen = await real(dir);
        if (first) await parked;
        return seen;
      });
      const slow = catalog.one("a");
      await vi.waitFor(() => expect(n).toBe(1));
      ports.git.setRepo(pluginDir("a"), { head: "newer" });
      await catalog.one("a");
      release();
      await slow;
      expect(head(await catalog.cachedFacts(), "a")).toBe("newer");
    });
    it("refreshGit ignores a plugin that is not on the board", async () => {
      await expect(catalog.refreshGit(["nobody"])).resolves.toBeUndefined();
    });
    it("a failed sync still refreshes the cache before it reports", async () => {
      install("a");
      install("b");
      await catalog.sync();
      ports.git.setRepo(pluginDir("b"), { head: "after-failure" });
      ports.fs.failExists.add(pluginDir("a"));
      await expect(catalog.sync()).rejects.toThrow("exists");
      expect(head(await catalog.cachedFacts(), "b")).toBe("after-failure");
    });
  });

  // Targeted reconcile of one plugin — after an owner action and after an attempt step: its state in VesnALIA and git, not the whole catalog.
  describe("refreshPlugin: one plugin against VesnALIA", () => {
    it("takes the state from the list: the card changes column and state at once, the others stay", async () => {
      install("a");
      install("b");
      await catalog.sync();
      ports.plugins.items.get("a")!.enabled = false;
      ports.plugins.items.get("a")!.state = "disabled";
      ports.plugins.items.get("b")!.state = "error";
      await catalog.refreshPlugin("a");
      const all = await catalog.cachedFacts();
      const a = all.find((p) => p.row.id === "a")!;
      const b = all.find((p) => p.row.id === "b")!;
      expect([columnOf(a), aliaStateOf(a)]).toEqual(["off", { state: "disabled", stale: false }]);
      expect([columnOf(b), aliaStateOf(b).state]).toEqual(["live", "running"]);
    });
    it("re-reads git of that plugin too", async () => {
      install("a");
      await catalog.sync();
      ports.git.setRepo(pluginDir("a"), { head: "moved" });
      await catalog.refreshPlugin("a");
      expect((await catalog.cachedFacts())[0]!.git!.head).toBe("moved");
    });
    it("asks VesnALIA for the list once and does not walk the folders", async () => {
      install("a");
      install("b");
      await catalog.sync();
      const list = vi.spyOn(ports.plugins, "list");
      const folders = vi.spyOn(ports.plugins, "folders");
      await catalog.refreshPlugin("a");
      expect([list.mock.calls.length, folders.mock.calls.length]).toEqual([1, 0]);
    });
    it("a plugin VesnALIA no longer lists, whose folder stays, is no longer installed", async () => {
      install("a");
      await catalog.sync();
      ports.plugins.items.delete("a");
      await catalog.refreshPlugin("a");
      expect(aliaStateOf((await catalog.one("a"))!)).toEqual({ state: "not-installed", stale: false });
      expect(store.plugin("a")!.gone_reason).toBeNull();
    });
    it("a list that did not come marks only that card stale and keeps its state", async () => {
      install("a");
      install("b");
      await catalog.sync();
      ports.plugins.failList = true;
      await catalog.refreshPlugin("a");
      expect(aliaStateOf((await catalog.one("a"))!)).toEqual({ state: "running", stale: true });
      expect(store.plugin("b")!.list_failed_at).toBeNull();
    });
    it("a plugin that is not on the board is ignored", async () => {
      const list = vi.spyOn(ports.plugins, "list");
      await expect(catalog.refreshPlugin("nobody")).resolves.toBeUndefined();
      expect(list).not.toHaveBeenCalled();
    });
    it("asked while a git-only refresh is running, it still gets its state pass", async () => {
      install("a");
      await catalog.sync();
      let release!: () => void;
      const parked = new Promise<void>((r) => (release = r));
      const real = ports.git.facts.bind(ports.git);
      let n = 0;
      vi.spyOn(ports.git, "facts").mockImplementation(async (dir) => {
        const first = n++ === 0;
        const seen = await real(dir);
        if (first) await parked;
        return seen;
      });
      const gitOnly = catalog.refreshGit(["a"]);
      await vi.waitFor(() => expect(n).toBe(1));
      ports.plugins.items.get("a")!.state = "error";
      const both = catalog.refreshPlugin("a");
      release();
      await Promise.all([gitOnly, both]);
      expect(aliaStateOf((await catalog.one("a"))!).state).toBe("error");
    });
    it("a failure of the state pass is reported, and git is still read", async () => {
      install("a");
      await catalog.sync();
      ports.git.setRepo(pluginDir("a"), { head: "moved" });
      vi.spyOn(ports.fs, "exists").mockRejectedValueOnce(new Error("exists failed once"));
      await expect(catalog.refreshPlugin("a")).rejects.toThrow("exists failed once");
      expect((await catalog.cachedFacts())[0]!.git!.head).toBe("moved");
    });
  });
});
