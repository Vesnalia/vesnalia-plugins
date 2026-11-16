import { beforeEach, describe, expect, it } from "vitest";
import { FakePorts, worktreeDirOf } from "./fake-ports";
import { JOB_RUNNING, MachineUnavailable, SCAFFOLD_FILES, sourcePath, WorktreeGone } from "./ports";
import { PLUGINS_ROOT, pluginDir } from "./stages";

let ports: FakePorts;
beforeEach(() => {
  ports = new FakePorts();
});

describe("FakePorts: failure mechanism", () => {
  it("before: throws, the effect did not happen and is not counted", async () => {
    ports.failAt("projects.create", "before");
    await expect(ports.projects.create({ name: "P", dir: "/d", hostId: "h" })).rejects.toThrow();
    expect(ports.count("projects.create")).toBe(0);
    expect(ports.calls).toEqual([]);
    expect(ports.projects.rows.size).toBe(0);
  });
  it("after: the effect happened, then it throws", async () => {
    ports.failAt("projects.create", "after");
    await expect(ports.projects.create({ name: "P", dir: "/d", hostId: "h" })).rejects.toThrow();
    expect(ports.count("projects.create")).toBe(1);
    expect(ports.projects.rows.size).toBe(1);
  });
  it("keeps a journal of the faults that actually fired", async () => {
    ports.failAt("projects.create", "after");
    await ports.git.initCommit("/d", "m");
    expect(ports.tripped).toEqual([]);
    await expect(ports.projects.create({ name: "P", dir: "/d", hostId: "h" })).rejects.toThrow();
    ports.failAt("initCommit", "before");
    await expect(ports.git.initCommit("/d", "m")).rejects.toThrow();
    expect(ports.tripped).toEqual([{ effect: "projects.create", when: "after" }, { effect: "initCommit", when: "before" }]);
  });
  it("the default moment is before", async () => {
    ports.failAt("rename");
    ports.fs.put("/a");
    await expect(ports.fs.rename("/a", "/b")).rejects.toThrow();
    expect(await ports.fs.exists("/a")).toBe(true);
  });
  it("failAt(null) clears, and the journal keeps the order and arguments of performed effects", async () => {
    ports.failAt("initCommit", "before");
    await expect(ports.git.initCommit("/d", "m")).rejects.toThrow();
    ports.failAt(null);
    const sha = await ports.git.initCommit("/d", "m");
    await ports.projects.create({ name: "P", dir: "/d", hostId: "h" });
    expect(ports.calls).toEqual([
      { effect: "initCommit", args: ["/d", "m"] },
      { effect: "projects.create", args: [{ name: "P", dir: "/d", hostId: "h" }] },
    ]);
    expect(ports.count("initCommit")).toBe(1);
    expect((await ports.git.facts("/d")).head).toBe(sha);
  });
  it("only the named effect fails; reads and other effects are untouched", async () => {
    ports.failAt("lock.request");
    await expect(ports.lock.request("a1", "t1")).rejects.toThrow();
    expect(await ports.lock.state("a1", "t1")).toBe("none");
    await ports.lock.release("a1");
    expect(ports.count("lock.release")).toBe(1);
  });
  it("tasks.create goes through the same mechanism", async () => {
    ports.failAt("tasks.create", "after");
    await expect(ports.tasks.create({ tasksProjectId: "tp1", title: "T", description: "d [workshop:w1]" })).rejects.toThrow();
    expect(ports.count("tasks.create")).toBe(1);
    expect((await ports.tasks.findByMarker("tp1", "[workshop:w1]")).map((t) => t.title)).toEqual(["T"]);
  });
  it("failAt rejects an effect name it does not know: a typo must not make a recovery test vacuous", () => {
    expect(() => ports.failAt("projects.crate", "after")).toThrow(/unknown effect/);
    expect(() => ports.failAt("tasks.create ")).toThrow(/projects\.create/);
    expect(() => ports.failAt("")).toThrow(/unknown effect/);
    ports.failAt(null);
    for (const e of ["scaffold", "rename", "initCommit", "projects.create", "tasks.create", "lock.request", "lock.release", "startInstall", "resetKeep", "resetHard", "enable", "disable", "updateRef", "snapshotTree"]) {
      expect(() => ports.failAt(e, "after"), e).not.toThrow();
    }
  });
  it("every effect of the brief can be failed", async () => {
    const run: Record<string, () => Promise<unknown>> = {
      scaffold: () => ports.fs.scaffold("x", "/tmp/w"),
      rename: () => ports.fs.rename("/nowhere", "/elsewhere"),
      initCommit: () => ports.git.initCommit("/d", "m"),
      "projects.create": () => ports.projects.create({ name: "P", dir: "/d", hostId: "h" }),
      "tasks.create": () => ports.tasks.create({ tasksProjectId: "tp1", title: "T", description: "" }),
      "lock.request": () => ports.lock.request("a", "t"),
      "lock.release": () => ports.lock.release("a"),
      startInstall: () => ports.plugins.startInstall("/d"),
      resetKeep: () => ports.git.resetKeep("/d", "s"),
      resetHard: () => ports.git.resetHard("/d", "s"),
      enable: () => ports.plugins.enable("x"),
      disable: () => ports.plugins.disable("x"),
      updateRef: () => ports.git.updateRef("/d", "refs/x", "s"),
      snapshotTree: () => ports.git.snapshotTree("/d", "refs/x", [], []),
    };
    for (const [effect, call] of Object.entries(run)) {
      ports.failAt(effect, "before");
      await expect(call(), effect).rejects.toThrow(/failure before/);
      expect(ports.count(effect), effect).toBe(0);
    }
  });
});

describe("FakePorts: work worktree", () => {
  it("a new worktree is a git repository in its own folder; a removed worktree and a dead machine are told apart", async () => {
    const meta = { workId: "w", opKey: "k", stage: 1, role: "stage" as const, who: "claude" };
    const t = await ports.spawn({ projectId: "p", environment: { kind: "new-worktree", hostId: "h" }, providerId: "x", model: "m", title: "t", prompt: "p", hidden: false, metadata: meta });
    const env = ports.threads.get(t)!.env;
    expect(await ports.worktreeDir(env)).toBe(worktreeDirOf(env));
    expect(await ports.git.facts(worktreeDirOf(env))).toMatchObject({ hasGit: true, branch: `alia/${env}` });
    ports.gone.add(env);
    await expect(ports.worktreeDir(env)).rejects.toBeInstanceOf(WorktreeGone);
    ports.gone.clear();
    ports.machineDown = true;
    await expect(ports.worktreeDir(env)).rejects.toBeInstanceOf(MachineUnavailable);
  });
});

describe("FakePorts: file system", () => {
  it("scaffold makes the nested folder with the scaffold files, not the files in tmpDir itself", async () => {
    const tmp = `${PLUGINS_ROOT}/.workshop-new/w1`;
    await ports.fs.scaffold("hello", tmp);
    expect(await ports.fs.list(tmp)).toEqual(["alia-plugin-hello"]);
    expect((await ports.fs.list(`${tmp}/alia-plugin-hello`)).sort()).toEqual([...SCAFFOLD_FILES].sort());
    expect(ports.calls).toEqual([{ effect: "scaffold", args: ["hello", tmp] }]);
  });
  it("rename moves the folder with everything inside", async () => {
    const tmp = `${PLUGINS_ROOT}/.workshop-new/w1`;
    await ports.fs.scaffold("hello", tmp);
    await ports.fs.rename(`${tmp}/alia-plugin-hello`, pluginDir("hello"));
    expect(await ports.fs.exists(`${tmp}/alia-plugin-hello`)).toBe(false);
    expect(await ports.fs.exists(`${pluginDir("hello")}/package.json`)).toBe(true);
    expect(await ports.fs.exists(tmp)).toBe(true);
    await ports.fs.remove(tmp);
    expect(await ports.fs.exists(tmp)).toBe(false);
    expect(await ports.fs.exists(pluginDir("hello"))).toBe(true);
  });
  it("rename refuses a missing source, an existing target (an empty folder too) and a missing parent", async () => {
    ports.fs.put(`${PLUGINS_ROOT}/a`);
    ports.fs.put(`${PLUGINS_ROOT}/b`);
    await expect(ports.fs.rename(`${PLUGINS_ROOT}/none`, `${PLUGINS_ROOT}/c`)).rejects.toThrow();
    await expect(ports.fs.rename(`${PLUGINS_ROOT}/a`, `${PLUGINS_ROOT}/b`)).rejects.toThrow();
    await expect(ports.fs.rename(`${PLUGINS_ROOT}/a`, "/no/such/dir/c")).rejects.toThrow();
  });
  it("remove is like rm -rf: no error on a missing path, siblings with a common prefix survive", async () => {
    ports.fs.put("/x/alia-plugin-a/file");
    ports.fs.put("/x/alia-plugin-ab");
    await ports.fs.remove("/x/alia-plugin-a");
    await ports.fs.remove("/x/never-was");
    expect(await ports.fs.exists("/x/alia-plugin-a/file")).toBe(false);
    expect(await ports.fs.exists("/x/alia-plugin-ab")).toBe(true);
  });
  it("list returns the names of direct children, [] for a missing folder", async () => {
    ports.fs.put("/d/a/deep/file");
    ports.fs.put("/d/b");
    expect((await ports.fs.list("/d")).sort()).toEqual(["a", "b"]);
    expect(await ports.fs.list("/none")).toEqual([]);
  });
  it("folders lists alia-plugin-* directly under the plugins root, not nested scaffolds", async () => {
    ports.fs.put(pluginDir("mail"));
    ports.fs.put(`${PLUGINS_ROOT}/not-a-plugin`);
    ports.fs.put(`${PLUGINS_ROOT}/.workshop-new/w1/alia-plugin-hello`);
    ports.plugins.folderNames.set("mail", "Mail");
    expect(await ports.plugins.folders()).toEqual([{ id: "mail", dir: pluginDir("mail"), name: "Mail" }]);
  });
  it("freeDiskGb is settable", async () => {
    ports.fs.freeGb = 1.5;
    expect(await ports.fs.freeDiskGb("/")).toBe(1.5);
  });
});

describe("FakePorts: install and jobs", () => {
  it("startInstall starts a running job for path:<dir>; the same folder while it runs returns the same job", async () => {
    const a = await ports.plugins.startInstall(pluginDir("x"));
    const b = await ports.plugins.startInstall(pluginDir("x"));
    expect(b).toBe(a);
    expect(await ports.plugins.job(a)).toEqual({ id: a, source: `path:${pluginDir("x")}`, state: "running", error: null });
    expect(await ports.plugins.job("nope")).toBeNull();
    const other = await ports.plugins.startInstall(pluginDir("y"));
    expect(other).not.toBe(a);
    expect((await ports.plugins.jobs()).map((j) => j.id)).toEqual([a, other]);
    expect(ports.count("startInstall")).toBe(3);
  });
  it("a finished job does not merge: the next startInstall is a new job", async () => {
    const a = await ports.plugins.startInstall(pluginDir("x"));
    ports.plugins.setJob(a, "failed");
    expect(await ports.plugins.startInstall(pluginDir("x"))).not.toBe(a);
    expect((await ports.plugins.job(a))!.error).toBeTruthy();
  });
  it("the same folder in the other source form is a new job, queued behind the running one (VesnALIA merges by the exact string)", async () => {
    const j = ports.plugins.addJob({ id: "j1", source: pluginDir("x"), state: "running" });
    const id = await ports.plugins.startInstall(pluginDir("x"));
    expect(id).not.toBe(j.id);
    expect((await ports.plugins.job(id))!.state).toBe("queued");
  });
  it("startInstallReturns makes the next startInstall return that job once", async () => {
    ports.plugins.addJob({ id: "j1", source: `path:${pluginDir("x")}`, state: "running" });
    ports.plugins.startInstallReturns("j1");
    expect(await ports.plugins.startInstall(pluginDir("other"))).toBe("j1");
    expect(await ports.plugins.startInstall(pluginDir("other"))).not.toBe("j1");
  });
  it("a lost answer: the job exists, the call is counted, the error is thrown", async () => {
    ports.failAt("startInstall", "after");
    await expect(ports.plugins.startInstall(pluginDir("x"))).rejects.toThrow();
    ports.failAt(null);
    const jobs = await ports.plugins.jobs();
    expect(jobs.map((j) => sourcePath(j.source))).toEqual([pluginDir("x")]);
    expect(ports.count("startInstall")).toBe(1);
  });
  it("setJob(succeeded) completes the install: a new plugin appears running, a disabled one is enabled", async () => {
    const dir = pluginDir("x");
    const j = await ports.plugins.startInstall(dir);
    ports.plugins.setJob(j, "succeeded");
    expect((await ports.plugins.list()).map((p) => [p.id, p.state, p.enabled, p.source, p.rootDir])).toEqual([["x", "running", true, `path:${dir}`, dir]]);
    await ports.plugins.disable("x");
    expect((await ports.plugins.list())[0]).toMatchObject({ state: "disabled", enabled: false });
    const j2 = await ports.plugins.startInstall(dir);
    ports.plugins.setJob(j2, "succeeded");
    expect((await ports.plugins.list())[0]).toMatchObject({ state: "running", enabled: true });
  });
  it("failed and cancelled jobs install nothing", async () => {
    const j = await ports.plugins.startInstall(pluginDir("x"));
    ports.plugins.setJob(j, "cancelled");
    expect(await ports.plugins.list()).toEqual([]);
  });
  it("cancelJob: a running job goes to cancelling, a queued one is cancelled at once; the outcome is for setJob", async () => {
    const running = await ports.plugins.startInstall(pluginDir("x"));
    const queued = ports.plugins.addJob({ id: "q", source: pluginDir("y"), state: "queued" });
    await ports.plugins.cancelJob(running);
    await ports.plugins.cancelJob(queued.id);
    expect((await ports.plugins.job(running))!.state).toBe("cancelling");
    expect((await ports.plugins.job("q"))!.state).toBe("cancelled");
    expect(ports.plugins.cancelled).toEqual([running, "q"]);
    expect(JOB_RUNNING).toContain("cancelling");
    ports.plugins.setJob(running, "succeeded");
    expect((await ports.plugins.job(running))!.state).toBe("succeeded");
  });
  it("enable and disable of an unknown plugin fail like VesnALIA does", async () => {
    await expect(ports.plugins.enable("ghost")).rejects.toThrow("unknown plugin");
    await expect(ports.plugins.disable("ghost")).rejects.toThrow("unknown plugin");
    expect(ports.count("enable")).toBe(0);
  });
  it("enable and disable change state and flag", async () => {
    ports.plugins.add({ id: "m" });
    await ports.plugins.disable("m");
    expect(await ports.plugins.list()).toMatchObject([{ id: "m", state: "disabled", enabled: false }]);
    await ports.plugins.enable("m");
    expect(await ports.plugins.list()).toMatchObject([{ id: "m", state: "running", enabled: true }]);
  });
  it("enable of a plugin whose folder is gone loads it from scratch as missing, without a name (as VesnALIA does)", async () => {
    ports.plugins.add({ id: "m" });
    await ports.plugins.disable("m");
    await ports.fs.remove(pluginDir("m"));
    await ports.plugins.enable("m");
    expect(await ports.plugins.list()).toMatchObject([{ id: "m", name: null, state: "missing", enabled: true }]);
    expect((await ports.plugins.list())[0]!.error).toContain("plugin directory not found");
  });
  it("list fails on demand, and returns copies", async () => {
    ports.plugins.add({ id: "m" });
    (await ports.plugins.list())[0]!.state = "error";
    expect((await ports.plugins.list())[0]!.state).toBe("running");
    ports.plugins.failList = true;
    await expect(ports.plugins.list()).rejects.toThrow();
  });
  it("jobs fail on demand; a forgotten job is gone from job and jobs (retention over, or the server restarted)", async () => {
    const j = await ports.plugins.startInstall(pluginDir("x"));
    ports.plugins.failJobs = true;
    await expect(ports.plugins.jobs()).rejects.toThrow();
    ports.plugins.failJobs = false;
    ports.plugins.forgetJob(j);
    expect(await ports.plugins.job(j)).toBeNull();
    expect(await ports.plugins.jobs()).toEqual([]);
  });
  it("add makes the folder; defaults point at the working copy", async () => {
    const p = ports.plugins.add({ id: "m" });
    expect(p).toEqual({ id: "m", name: "m", state: "running", enabled: true, source: `path:${pluginDir("m")}`, rootDir: pluginDir("m"), error: null });
    expect(await ports.fs.exists(pluginDir("m"))).toBe(true);
  });
});

describe("FakePorts: build lock", () => {
  it("request starts a holder that takes the free lock; the second request of the same generation starts no second holder", async () => {
    await ports.lock.request("a1", "t1");
    expect(await ports.lock.state("a1", "t1")).toBe("held");
    await ports.lock.request("a1", "t1");
    expect(ports.count("lock.spawnedHolders")).toBe(1);
    expect(ports.lock.wantExists("a1")).toBe(true);
  });
  it("state is per generation", async () => {
    await ports.lock.request("a1", "t1");
    expect(await ports.lock.state("a1", "other")).toBe("none");
  });
  it("release removes the request, the holder exits and the lock is free", async () => {
    await ports.lock.request("a1", "t1");
    await ports.lock.release("a1");
    expect(ports.lock.wantExists("a1")).toBe(false);
    expect(await ports.lock.state("a1", "t1")).toBe("none");
    await ports.lock.request("a2", "t2");
    expect(await ports.lock.state("a2", "t2")).toBe("held");
  });
  it("a second attempt waits for the first holder, then takes over", async () => {
    await ports.lock.request("a1", "t1");
    await ports.lock.request("a2", "t2");
    expect(await ports.lock.state("a2", "t2")).toBe("waiting");
    await ports.lock.release("a1");
    expect(await ports.lock.state("a2", "t2")).toBe("held");
  });
  it("a holder whose request is gone before it gets the lock exits without holding it", async () => {
    await ports.lock.request("a1", "t1");
    await ports.lock.request("a2", "t2");
    await ports.lock.release("a2");
    await ports.lock.release("a1");
    expect(await ports.lock.state("a2", "t2")).toBe("none");
    await ports.lock.request("a3", "t3");
    expect(await ports.lock.state("a3", "t3")).toBe("held");
  });
  it("a new generation replaces the old one: the old holder exits, the new one is spawned", async () => {
    await ports.lock.request("a1", "t1");
    await ports.lock.request("a1", "t2");
    expect(ports.count("lock.spawnedHolders")).toBe(2);
    expect(await ports.lock.state("a1", "t1")).toBe("none");
    expect(await ports.lock.state("a1", "t2")).toBe("held");
  });
  it("kill: the holder dies without cleanup — the request stays, the mark is never taken for held", async () => {
    await ports.lock.request("a1", "t1");
    ports.lock.kill("a1");
    expect(ports.lock.wantExists("a1")).toBe(true);
    expect(await ports.lock.state("a1", "t1")).toBe("none");
    await ports.lock.request("a1", "t1");
    expect(ports.count("lock.spawnedHolders")).toBe(2);
    expect(await ports.lock.state("a1", "t1")).toBe("held");
  });
  it("kill frees the lock for a waiting attempt", async () => {
    await ports.lock.request("a1", "t1");
    await ports.lock.request("a2", "t2");
    ports.lock.kill("a1");
    expect(await ports.lock.state("a2", "t2")).toBe("held");
  });
  it("a stale mark does not count: a new generation that has to wait is waiting, not held", async () => {
    await ports.lock.request("a1", "t1");
    ports.lock.kill("a1");
    ports.lock.occupy(true);
    await ports.lock.request("a1", "t2");
    expect(await ports.lock.state("a1", "t2")).toBe("waiting");
    ports.lock.occupy(false);
    expect(await ports.lock.state("a1", "t2")).toBe("held");
  });
  it("a foreign process holding the build lock keeps every holder waiting", async () => {
    ports.lock.occupy(true);
    await ports.lock.request("a1", "t1");
    expect(await ports.lock.state("a1", "t1")).toBe("waiting");
  });
  it("sweep removes the requests and marks of attempts that are not in keep", async () => {
    await ports.lock.request("a1", "t1");
    await ports.lock.request("a2", "t2");
    await ports.lock.sweep(["a2"]);
    expect(ports.lock.wantExists("a1")).toBe(false);
    expect(ports.lock.wantExists("a2")).toBe(true);
    expect(await ports.lock.state("a1", "t1")).toBe("none");
    expect(await ports.lock.state("a2", "t2")).toBe("held");
  });
  it("a request that failed before did not leave a request", async () => {
    ports.failAt("lock.request", "before");
    await expect(ports.lock.request("a1", "t1")).rejects.toThrow();
    expect(ports.lock.wantExists("a1")).toBe(false);
  });
  it("a request that failed after is in place", async () => {
    ports.failAt("lock.request", "after");
    await expect(ports.lock.request("a1", "t1")).rejects.toThrow();
    expect(ports.lock.wantExists("a1")).toBe(true);
    expect(await ports.lock.state("a1", "t1")).toBe("held");
  });
});

describe("FakePorts: working copy git", () => {
  it("a folder that is not a repository", async () => {
    expect(await ports.git.facts("/d")).toEqual({ hasGit: false, branch: null, head: null, dirtyCount: 0 });
  });
  it("setRepo makes a clean repository on main by default", async () => {
    ports.git.setRepo("/d", {});
    const facts = await ports.git.facts("/d");
    expect(facts).toMatchObject({ hasGit: true, branch: "main", dirtyCount: 0 });
    expect(facts.head).toMatch(/^[0-9a-f]{40}$/);
  });
  it("initCommit makes a repository on main with one commit, then adds commits", async () => {
    const a = await ports.git.initCommit("/d", "first");
    expect(await ports.git.facts("/d")).toEqual({ hasGit: true, branch: "main", head: a, dirtyCount: 0 });
    const b = await ports.git.initCommit("/d", "second");
    expect(b).not.toBe(a);
    expect(await ports.git.isAncestor("/d", a, b)).toBe(true);
    expect(await ports.git.isAncestor("/d", b, a)).toBe(false);
  });
  it("an interrupted move: only the branch ref moved — HEAD is B, files are A, the copy is dirty and equals A", async () => {
    ports.git.setRepo("/d", {});
    const a = (await ports.git.facts("/d")).head!;
    const b = ports.git.commit("/d", { move: false });
    await ports.git.updateRef("/d", "refs/heads/main", b);
    const facts = await ports.git.facts("/d");
    expect(facts.head).toBe(b);
    expect(facts.dirtyCount).toBeGreaterThan(0);
    expect(await ports.git.copyEquals("/d", a)).toBe(true);
    expect(await ports.git.copyEquals("/d", b)).toBe(false);
    await ports.git.resetHard("/d", b);
    expect((await ports.git.facts("/d")).dirtyCount).toBe(0);
    expect(await ports.git.copyEquals("/d", b)).toBe(true);
  });
  it("updateRef of another ref leaves HEAD alone and is readable", async () => {
    ports.git.setRepo("/d", {});
    const head = (await ports.git.facts("/d")).head!;
    await ports.git.updateRef("/d", "refs/workshop/TEST-1/before", head);
    expect(ports.git.ref("/d", "refs/workshop/TEST-1/before")).toBe(head);
    expect((await ports.git.facts("/d")).head).toBe(head);
  });
  it("changedFiles lists the worktree files the commit would take, without what exclude covers", async () => {
    ports.git.setRepo("/d", { files: ["a.ts", ".env", "node_modules/x/i.js", "src/b.ts", "k.pem", "docs/secrets/s.txt"] });
    expect(await ports.git.changedFiles("/d", [])).toEqual(["a.ts", ".env", "node_modules/x/i.js", "src/b.ts", "k.pem", "docs/secrets/s.txt"]);
    expect(await ports.git.changedFiles("/d", ["node_modules/", ".env*", "*.pem", "secrets/"])).toEqual(["a.ts", "src/b.ts"]);
    expect(ports.calls).toEqual([]); // a read, not an effect: `failAt` failures do not apply to it
    await expect(ports.git.changedFiles("/nowhere", [])).rejects.toThrow(/not a repository/);
  });
  it("resetKeep moves HEAD and files, keeps local edits, refuses when told to", async () => {
    ports.git.setRepo("/d", { dirtyCount: 2 });
    const target = ports.git.commit("/d", { move: false });
    expect(await ports.git.resetKeep("/d", target)).toBe("ok");
    expect(await ports.git.facts("/d")).toMatchObject({ head: target, dirtyCount: 2 });
    ports.git.setRepo("/e", { keepRefuses: true });
    const before = (await ports.git.facts("/e")).head;
    expect(await ports.git.resetKeep("/e", ports.git.sha())).toEqual({ refused: expect.stringContaining("not uptodate") });
    expect((await ports.git.facts("/e")).head).toBe(before);
    ports.git.setRepo("/f", { keepRefuses: "fatal: Unable to create '/f/.git/index.lock': File exists." });
    expect(await ports.git.resetKeep("/f", ports.git.sha())).toEqual({ refused: "fatal: Unable to create '/f/.git/index.lock': File exists." });
    expect(ports.count("resetKeep")).toBe(3);
  });
  it("statusLines are the porcelain lines of the copy, set by the test", async () => {
    ports.git.setRepo("/d", {});
    expect(await ports.git.statusLines("/d")).toEqual([]);
    ports.git.setRepo("/d", { status: [" M a.ts", "?? b.ts"] });
    expect(await ports.git.statusLines("/d")).toEqual([" M a.ts", "?? b.ts"]);
    await expect(ports.git.statusLines("/nowhere")).rejects.toThrow(/not a repository/);
  });
  it("copyEquals needs files as in the commit, an index as in the commit and no new files", async () => {
    ports.git.setRepo("/d", {});
    const a = (await ports.git.facts("/d")).head!;
    expect(await ports.git.copyEquals("/d", a)).toBe(true);
    ports.git.setRepo("/d", { dirtyCount: 1 });
    expect(await ports.git.copyEquals("/d", a)).toBe(false);
    ports.git.setRepo("/d", { dirtyCount: 0, tree: null });
    expect(await ports.git.copyEquals("/d", a)).toBe(false);
  });
  it("isAncestor follows the commit graph; unknown commits are not ancestors; a commit is its own ancestor", async () => {
    const a = ports.git.sha();
    const b = ports.git.sha();
    const c = ports.git.sha();
    ports.git.link(b, a);
    ports.git.link(c, b);
    expect(await ports.git.isAncestor("/d", a, c)).toBe(true);
    expect(await ports.git.isAncestor("/d", c, a)).toBe(false);
    expect(await ports.git.isAncestor("/d", a, a)).toBe(true);
    expect(await ports.git.isAncestor("/d", "x", "y")).toBe(false);
  });
  it("snapshotTree makes a commit under the ref, without the excluded and skipped files, and returns the files", async () => {
    ports.git.setRepo("/d", { files: ["a.ts", "b.ts", ".env", ".env.local", "node_modules/x/index.js", "dist/app.js", "secrets/k", "id.pem", "config.ts"] });
    const r = await ports.git.snapshotTree("/d", "refs/workshop/TEST-1/canceled", ["node_modules/", "dist/", ".env*", "*.pem", "secrets/"], ["config.ts"]);
    expect(r.files).toEqual(["a.ts", "b.ts"]);
    expect(r.nested).toEqual([]);
    expect(ports.git.ref("/d", "refs/workshop/TEST-1/canceled")).toBe(r.sha);
    expect(ports.calls[0]).toEqual({ effect: "snapshotTree", args: ["/d", "refs/workshop/TEST-1/canceled", ["node_modules/", "dist/", ".env*", "*.pem", "secrets/"], ["config.ts"]] });
  });
  it("nested repositories are not in changedFiles nor in the commit; snapshotTree reports them, without the excluded ones", async () => {
    ports.git.setRepo("/d", { files: ["a.ts"], nested: ["vendor/ref", "node_modules/x"] });
    expect(await ports.git.changedFiles("/d", ["node_modules/"])).toEqual(["a.ts"]);
    const r = await ports.git.snapshotTree("/d", "refs/x", ["node_modules/"], []);
    expect(r).toMatchObject({ files: ["a.ts"], nested: ["vendor/ref"] });
  });
  it("stagedState, stagedPatch and readBlobs: the test's diff by file block; only the named paths; the index side from the + lines or stagedBlobs, HEAD's from stagedOld", async () => {
    const a = "diff --git a/a.ts b/a.ts\n+1\n";
    const env = "diff --git a/.env b/.env\n+X=1\n";
    const gone = "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n-x\n";
    ports.git.setRepo("/d", { stagedDiff: a + env + gone, stagedBlobs: { ".env": Buffer.from([0, 1]) }, stagedOld: { "old.ts": "x\n" } });
    const st = await ports.git.stagedState("/d");
    expect(st.paths).toEqual([
      { path: "a.ts", old: null, new: "new:/d:a.ts" },
      { path: ".env", old: null, new: "new:/d:.env" },
      { path: "old.ts", old: "old:/d:old.ts", new: null },
    ]);
    expect(await ports.git.stagedPatch("/d", st.base, st.tree, ["a.ts"])).toBe(a);
    expect(await ports.git.stagedPatch("/d", st.base, st.tree, [])).toBe("");
    const blobs = await ports.git.readBlobs("/d", ["new:/d:a.ts", "new:/d:.env", "old:/d:old.ts"], 100);
    expect([...blobs.values()].map((b) => [...b])).toEqual([[...Buffer.from("1\n")], [0, 1], [...Buffer.from("x\n")]]);
    await expect(ports.git.readBlobs("/d", ["new:/d:missing.ts"], 100)).rejects.toThrow(/missing/);
    await expect(ports.git.readBlobs("/d", ["new:/d:a.ts", "old:/d:old.ts"], 3)).rejects.toThrow(/more than/);
    await expect(ports.git.stagedPatch("/none", "b", "t", ["a.ts"])).rejects.toThrow(/not a repository/);
    await expect(ports.git.stagedState("/none")).rejects.toThrow(/not a repository/);
    ports.git.stagedFails = "unmerged";
    await expect(ports.git.stagedState("/d")).rejects.toThrow(/unmerged/);
  });
  it("exclude patterns: a folder pattern may have * in its name too, as in git", async () => {
    ports.git.setRepo("/d", { files: ["cache-1/a", "x/cache-22/b", "cache/c", "only/here.txt", "x/only/here.txt"] });
    expect(await ports.git.changedFiles("/d", ["cache-*/", "only/here.txt"])).toEqual(["cache/c", "x/only/here.txt"]);
  });
});

describe("FakePorts: projects, tasks, snapshots", () => {
  it("findByPath finds projects of the machine on the folder", async () => {
    ports.projects.add({ id: "p1", name: "A", dir: "/d", hostId: "h1" });
    ports.projects.add({ id: "p2", name: "B", dir: "/d", hostId: "h1" });
    ports.projects.add({ id: "p3", name: "C", dir: "/d", hostId: "h2" });
    ports.projects.add({ id: "p4", name: "D", dir: "/other", hostId: "h1" });
    expect((await ports.projects.findByPath("h1", "/d")).sort()).toEqual(["p1", "p2"]);
    expect(await ports.projects.findByPath("h1", "/none")).toEqual([]);
  });
  it("create makes a project that findByPath then finds", async () => {
    const id = await ports.projects.create({ name: "Plugin · Hello", dir: "/d", hostId: "h1" });
    expect(await ports.projects.findByPath("h1", "/d")).toEqual([id]);
  });
  it("findByMarker looks in the description of the tasks of that project, canceled ones too", async () => {
    await ports.tasks.create({ tasksProjectId: "tp1", title: "Hello: command", description: "request\n[workshop:w1]" });
    const other = await ports.tasks.create({ tasksProjectId: "tp1", title: "Other", description: "[workshop:w2]" });
    await ports.tasks.setStatus(other.id, "canceled");
    await ports.tasks.create({ tasksProjectId: "tp2", title: "Another project", description: "[workshop:w1]" });
    expect((await ports.tasks.findByMarker("tp1", "[workshop:w1]")).map((t) => t.title)).toEqual(["Hello: command"]);
    expect((await ports.tasks.findByMarker("tp1", "[workshop:w2]")).map((t) => t.id)).toEqual([other.id]);
    expect(await ports.tasks.findByMarker("tp1", "[workshop:w9]")).toEqual([]);
  });
  it("saveText keeps the text under the label", async () => {
    await ports.saveText("w1", "canceled", "staged.patch", "diff");
    expect(ports.texts).toEqual([{ workId: "w1", label: "canceled", relPath: "staged.patch", content: "diff" }]);
    expect((await ports.readSaved("w1", "staged.patch"))!.content).toBe("diff");
  });
  it("serverHostId is the host the projects of this server live on", async () => {
    expect(await ports.serverHostId()).toBe(await ports.projectHost());
  });
});

describe("sourcePath", () => {
  it("makes path:<dir>, bare path and a trailing slash the same folder; other sources are not folders", () => {
    expect(sourcePath("path:/srv/alia/plugins/alia-plugin-x")).toBe("/srv/alia/plugins/alia-plugin-x");
    expect(sourcePath("/srv/alia/plugins/alia-plugin-x/")).toBe("/srv/alia/plugins/alia-plugin-x");
    expect(sourcePath("path:/srv/alia/plugins/../plugins/alia-plugin-x")).toBe("/srv/alia/plugins/alia-plugin-x");
    expect(sourcePath("git:github.com/acme/bb-plugin-demo@main")).toBeNull();
    expect(sourcePath("builtin:account-pool")).toBeNull();
    expect(sourcePath(null)).toBeNull();
  });
});
