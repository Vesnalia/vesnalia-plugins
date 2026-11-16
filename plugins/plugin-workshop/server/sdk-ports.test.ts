import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { afterAll, afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { lstatSync, statSync } from "node:fs";
import { FakePorts } from "./fake-ports";
import { MachineUnavailable, runningJobsOf, SymlinkRefused, WorktreeGone } from "./ports";
import { LogScan, publicationGate } from "./publish";
import { BEARER, GITHUB_TOKEN, JWT, OPENAI_KEY, SLACK_TOKEN } from "./test-tokens";
import { classifyCopy } from "./rollout";
import { holderScript, sdkPorts } from "./sdk-ports";
import { CANCEL_EXCLUDE, cancelSnapshot } from "./snapshot";
import { SELF_ID } from "./stages";

type Thread = Record<string, unknown>;
type Fn = (...a: never[]) => Promise<unknown>;

/** A minimal VesnALIA: only what the ports under test touch. `sdk` adds and overrides SDK calls. */
function fakeAlia(over: { get?: (a: { threadId: string }) => Promise<Thread>; archive?: (a: { threadId: string }) => Promise<unknown>; status?: () => Promise<unknown>; sdk?: Record<string, Record<string, Fn>> }) {
  const warn = vi.fn();
  const get = vi.fn(over.get ?? (async () => ({ status: "idle" })));
  const archive = vi.fn(over.archive ?? (async () => ({ ok: true })));
  const sdk = {
    ...over.sdk,
    threads: { get, archive, ...over.sdk?.threads },
    environments: { status: over.status ?? (async () => ({ outcome: "missing" })), ...over.sdk?.environments },
    files: { ...over.sdk?.files },
    system: { ...over.sdk?.system },
  };
  const alia = { log: { warn }, sdk } as unknown as AliaPluginApi;
  return { ports: sdkPorts(alia, () => undefined), get, archive, warn };
}
const notFound = () => new Error("HTTP 404: Thread not found");

describe("sdkPorts.status", () => {
  it("returns the thread status, flat or wrapped", async () => {
    expect(await fakeAlia({ get: async () => ({ status: "active" }) }).ports.status("t")).toBe("active");
    expect(await fakeAlia({ get: async () => ({ thread: { status: "error" } }) }).ports.status("t")).toBe("error");
  });
  it("is unknown only when the thread does not exist", async () => {
    expect(await fakeAlia({ get: async () => Promise.reject(notFound()) }).ports.status("t")).toBe("unknown");
    expect(await fakeAlia({ get: async () => ({ status: "idle", deletedAt: 1 }) }).ports.status("t")).toBe("unknown");
  });
  it("throws on any other failure or a response without a known status", async () => {
    await expect(fakeAlia({ get: async () => Promise.reject(new Error("HTTP 500: boom")) }).ports.status("t")).rejects.toThrow("boom");
    await expect(fakeAlia({ get: async () => ({}) }).ports.status("t")).rejects.toThrow(/status/);
    await expect(fakeAlia({ get: async () => ({ status: "weird" }) }).ports.status("t")).rejects.toThrow(/status/);
  });
});

describe("sdkPorts.archive", () => {
  it("archives a live thread", async () => {
    const b = fakeAlia({});
    await b.ports.archive("t");
    expect(b.archive).toHaveBeenCalledWith({ threadId: "t" });
  });
  it("does not fail on an already archived or already deleted thread, whatever the error says", async () => {
    await expect(fakeAlia({ archive: async () => Promise.reject(new Error("conflict")), get: async () => ({ status: "idle", archivedAt: 5 }) }).ports.archive("t")).resolves.toBeUndefined();
    await expect(fakeAlia({ archive: async () => Promise.reject(new Error("conflict")), get: async () => Promise.reject(notFound()) }).ports.archive("t")).resolves.toBeUndefined();
  });
  it("still fails when the thread is live and archive really failed", async () => {
    await expect(fakeAlia({ archive: async () => Promise.reject(new Error("HTTP 500: boom")), get: async () => ({ status: "idle", archivedAt: null, deletedAt: null }) }).ports.archive("t")).rejects.toThrow("boom");
    await expect(fakeAlia({ archive: async () => Promise.reject(new Error("HTTP 500: boom")), get: async () => Promise.reject(new Error("HTTP 503: down")) }).ports.archive("t")).rejects.toThrow("boom");
  });
});

describe("sdkPorts.head", () => {
  it("maps an unreachable machine to MachineUnavailable and logs the raw error", async () => {
    const b = fakeAlia({ status: async () => Promise.reject(new Error("host is offline")) });
    await expect(b.ports.head("env")).rejects.toBeInstanceOf(MachineUnavailable);
    expect(b.warn).toHaveBeenCalled();
  });
  it("a removed worktree is WorktreeGone, not a machine problem", async () => {
    const st = (code: string) => async () => ({ outcome: "unavailable", failure: { code, message: "gone", workspacePath: "/w" } });
    await expect(fakeAlia({ status: st("path_not_found") }).ports.head("env")).rejects.toBeInstanceOf(WorktreeGone);
    await expect(fakeAlia({ status: st("unknown_environment") }).ports.head("env")).rejects.toThrow("worktree unavailable (unknown_environment): gone");
    await expect(fakeAlia({ status: st("unknown_environment") }).ports.head("env")).rejects.toBeInstanceOf(WorktreeGone);
    await expect(fakeAlia({ status: st("permission_denied") }).ports.head("env")).rejects.toBeInstanceOf(MachineUnavailable);
    const other = await fakeAlia({ status: st("not_git_repo") }).ports.head("env").catch((e: unknown) => e);
    expect(other).toBeInstanceOf(Error);
    expect(other).not.toBeInstanceOf(WorktreeGone);
  });
  it("«Environment unavailable» is WorktreeGone once the environment is destroyed, not while it is still being created", async () => {
    const unavailable = async () => Promise.reject(new Error("HTTP 409: Environment unavailable"));
    const env = (status: string) => ({ environments: { get: async () => ({ hostId: "h", path: "/w", status }) } });
    await expect(fakeAlia({ status: unavailable, sdk: env("destroyed") }).ports.head("env")).rejects.toBeInstanceOf(WorktreeGone);
    const creating = await fakeAlia({ status: unavailable, sdk: env("provisioning") }).ports.head("env").catch((e: unknown) => e);
    expect(creating).not.toBeInstanceOf(WorktreeGone);
    expect(String(creating)).toMatch(/still being created/);
    await expect(fakeAlia({ status: async () => Promise.reject(new Error("unknown environment env")) }).ports.head("env")).rejects.toBeInstanceOf(WorktreeGone);
  });
});

describe("sdkPorts.findThread", () => {
  const since = 1_000;
  const old = (n: number) => Array.from({ length: 50 }, (_, i) => ({ id: `old${n}-${i}`, createdAt: since - 1 - i }));
  const listOf = (pages: Array<Array<{ id: string; createdAt: number }>>) => vi.fn(async (a: { offset: number }) => pages[a.offset / 50] ?? []);

  it("finds a matching thread on a later page even when earlier pages hold only old threads (order follows activity, not creation)", async () => {
    const list = listOf([old(0), [{ id: "wanted", createdAt: since + 5 }, { id: "other", createdAt: since + 6 }]]);
    const getPluginMetadata = vi.fn(async (a: { threadId: string }) => (a.threadId === "wanted" ? { opKey: "k1" } : { opKey: "zzz" }));
    const b = fakeAlia({ sdk: { threads: { list, getPluginMetadata } as unknown as Record<string, Fn> } });
    expect(await b.ports.findThread("p", "k1", since)).toBe("wanted");
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("returns null when the last (short) page is reached without a match", async () => {
    const list = listOf([old(0), old(1).slice(0, 7)]);
    const b = fakeAlia({ sdk: { threads: { list, getPluginMetadata: async () => ({}) } as unknown as Record<string, Fn> } });
    expect(await b.ports.findThread("p", "k1", since)).toBeNull();
  });
  it("cannot confirm absence when the project has more plugin threads than it can page through — rejects, does not return null", async () => {
    const list = vi.fn(async () => old(0));
    const b = fakeAlia({ sdk: { threads: { list, getPluginMetadata: async () => ({}) } as unknown as Record<string, Fn> } });
    await expect(b.ports.findThread("p", "k1", since)).rejects.toThrow(/more than 500 plugin threads/);
  });
});

describe("sdkPorts host file calls", () => {
  const withFiles = (read: () => Promise<unknown>) =>
    fakeAlia({ sdk: { environments: { get: async () => ({ hostId: "h", path: "/w" }) }, files: { read } } });
  it("read() returns null for a missing path", async () => {
    const b = withFiles(async () => Promise.reject(new Error("HTTP 404: Path does not exist: /w/x.md")));
    expect(await b.ports.read("env", "x.md")).toBeNull();
  });
  it("read() throws on a missing host — that is not «no file»", async () => {
    const b = withFiles(async () => Promise.reject(new Error("HTTP 404: Host not found")));
    await expect(b.ports.read("env", "x.md")).rejects.toThrow("Host not found");
    expect(b.warn).toHaveBeenCalled();
  });
  it("an environment VesnALIA no longer knows is WorktreeGone", async () => {
    const b = fakeAlia({ sdk: { environments: { get: async () => Promise.reject(new Error("HTTP 404: Environment not found")) } } });
    await expect(b.ports.read("env", "x.md")).rejects.toBeInstanceOf(WorktreeGone);
    await expect(b.ports.list("env", "x")).rejects.toBeInstanceOf(WorktreeGone);
  });
  it("a disconnected host is MachineUnavailable", async () => {
    const b = withFiles(async () => Promise.reject(new Error("HTTP 502: Host is not connected")));
    await expect(b.ports.read("env", "x.md")).rejects.toBeInstanceOf(MachineUnavailable);
  });
  it("worktreeDir is the path of the environment; an environment VesnALIA no longer knows is WorktreeGone", async () => {
    expect(await withFiles(async () => ({})).ports.worktreeDir("env")).toBe("/w");
    const gone = fakeAlia({ sdk: { environments: { get: async () => Promise.reject(new Error("HTTP 404: Environment not found")) } } });
    await expect(gone.ports.worktreeDir("env")).rejects.toBeInstanceOf(WorktreeGone);
  });
  it("worktreeDir checks the worktree on every call: a path cached before the worktree was removed is not handed out", async () => {
    const available = { outcome: "available", workspace: { checkout: { kind: "branch", headSha: "h1" }, workingTree: { hasUncommittedChanges: false } } };
    let st: unknown = available;
    const get = vi.fn(async () => ({ hostId: "h", path: "/w" }));
    const b = fakeAlia({ status: async () => st, sdk: { environments: { get } } });
    expect(await b.ports.worktreeDir("env")).toBe("/w");
    st = { outcome: "unavailable", failure: { code: "path_not_found", message: "gone", workspacePath: "/w" } };
    await expect(b.ports.worktreeDir("env")).rejects.toBeInstanceOf(WorktreeGone);
    expect(get).toHaveBeenCalledTimes(1);
    const offline = fakeAlia({ status: async () => Promise.reject(new Error("HTTP 502: Host is not connected")), sdk: { environments: { get } } });
    await expect(offline.ports.worktreeDir("env")).rejects.toBeInstanceOf(MachineUnavailable);
  });
});

describe("sdkPorts snapshot confinement", () => {
  function snapshotAlia() {
    const dataDir = tmp("snap");
    const works = join(dataDir, "plugins", SELF_ID, "works");
    mkdirSync(join(works, "w1", "snap1"), { recursive: true });
    writeFileSync(join(works, "secret.txt"), "outside");
    writeFileSync(join(works, "w1", "snap1", "ok.md"), "inside");
    const b = fakeAlia({
      sdk: {
        system: { config: async () => ({ dataDir }) },
        environments: { get: async () => ({ hostId: "h", path: "/w" }) },
        files: { read: async () => ({ content: "evil", contentEncoding: "utf8", sizeBytes: 4 }) },
      },
    });
    return { ...b, dataDir, works };
  }
  it("readSaved reads inside the snapshot and refuses a path that climbs out of it", async () => {
    const { ports } = snapshotAlia();
    expect((await ports.readSaved("w1", "ok.md"))?.content).toBe("inside");
    await expect(ports.readSaved("w1", "../../secret.txt")).rejects.toThrow(/outside the work snapshots/);
  });
  it("listSaved refuses a directory that climbs out of the snapshot", async () => {
    const { ports } = snapshotAlia();
    await expect(ports.listSaved("w1", "../..")).rejects.toThrow(/outside the work snapshots/);
  });
  it("saveArtifacts refuses a path that climbs out and writes nothing outside", async () => {
    const { ports, works } = snapshotAlia();
    await expect(ports.saveArtifacts("w1", "env", { dirs: [], files: ["../../planted.txt"], mustExist: [] }, "snap2")).rejects.toThrow(/outside the work snapshots/);
    expect(existsSync(join(works, "planted.txt"))).toBe(false);
    expect(readFileSync(join(works, "secret.txt"), "utf8")).toBe("outside");
  });
});

describe("sdkPorts.sleep", () => {
  it("waits, and returns at once and without an error when its signal is aborted", async () => {
    const p = fakeAlia({}).ports;
    let t = Date.now();
    await p.sleep(50);
    expect(Date.now() - t).toBeGreaterThanOrEqual(45);
    t = Date.now();
    await expect(p.sleep(10_000, AbortSignal.abort())).resolves.toBeUndefined();
    const c = new AbortController();
    setTimeout(() => c.abort(), 30);
    await expect(p.sleep(10_000, c.signal)).resolves.toBeUndefined();
    expect(Date.now() - t).toBeLessThan(1_000);
  });
});

describe("sdkPorts.tasks.comment", () => {
  it("signs comments as «Plugin Workshop» — the tracker would show the author as «You»", async () => {
    const callRpc = vi.fn(async () => ({}));
    const b = fakeAlia({ sdk: { plugins: { callRpc } as unknown as Record<string, Fn> } });
    await b.ports.tasks.comment("task_1", "Work started.");
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "tasks", method: "createComment", input: { taskId: "task_1", body: "Plugin Workshop: Work started.", notify: false } }));
  });
  it("redacts token-shaped text in comments and in a new task's title and description", async () => {
    const task = { id: "t1", key: "TEST-1", projectId: "tp", title: "x", status: "todo" };
    const callRpc = vi.fn(async () => ({ ok: true, task }));
    const b = fakeAlia({ sdk: { plugins: { callRpc } as unknown as Record<string, Fn> } });
    await b.ports.tasks.comment("task_1", `Autopilot report: used ${OPENAI_KEY}`);
    await b.ports.tasks.create({ tasksProjectId: "tp", title: `fix ${GITHUB_TOKEN}`, description: `request with ${JWT}\n\n[workshop:w1]` });
    const sent = JSON.stringify(callRpc.mock.calls);
    for (const t of [OPENAI_KEY, GITHUB_TOKEN, JWT]) expect(sent).not.toContain(t);
    expect(sent).toContain("used [redacted:sk-]");
    expect(sent).toContain("[workshop:w1]");
  });
  it("the plugin log gets redacted text: an unexpected VesnALIA answer is quoted without the token in it", async () => {
    const warn = vi.fn();
    const p = sdkPorts({ log: { warn }, sdk: { plugins: { list: async () => ({ plugins: [{ id: "x", status: OPENAI_KEY, enabled: true, source: "path:/x" }] }) } } } as unknown as AliaPluginApi, () => undefined);
    await expect(p.plugins.list()).rejects.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(warn.mock.calls)).toContain("[redacted:sk-]");
  });
});

// --- ports over git, the lock, the file system and the SDK ---

const exec = promisify(execFile);
const made: string[] = [];
/** A temporary test folder; all of them are removed after the file. */
const tmp = (p: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `workshop-${p}-`)));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
const text = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8");
/** Ports without VesnALIA: git, the lock and the file system never call VesnALIA. */
function localPorts(opts: Parameters<typeof sdkPorts>[2] = {}) {
  return sdkPorts({ log: { warn: () => undefined }, sdk: {} } as unknown as AliaPluginApi, () => undefined, opts);
}
/** Ports on a fake VesnALIA: only the given SDK areas. */
function sdkAlia(sdk: Record<string, unknown>, opts: Parameters<typeof sdkPorts>[2] = {}) {
  return sdkPorts({ log: { warn: vi.fn() }, sdk } as unknown as AliaPluginApi, () => undefined, opts);
}
async function until(check: () => boolean | Promise<boolean>, ms = 4000, what = "condition"): Promise<number> {
  const start = Date.now();
  for (;;) {
    if (await check()) return Date.now() - start;
    if (Date.now() - start > ms) throw new Error(`did not happen within ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function git(dir: string, ...args: string[]): Promise<string> {
  return (await exec("git", ["-C", dir, ...args])).stdout;
}
function put(dir: string, rel: string, content = "x\n"): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}
/** A repository on main: commit A (f.txt = a, keep.txt), B on top of it (f.txt = b, g.txt); the branch is moved back to A. */
async function repo(): Promise<{ dir: string; A: string; B: string }> {
  const dir = tmp("git");
  await exec("git", ["init", "-q", "-b", "main", dir]);
  await git(dir, "config", "user.name", "Workshop Test");
  await git(dir, "config", "user.email", "test@example.invalid");
  put(dir, "f.txt", "a\n");
  put(dir, "keep.txt", "keep\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "A");
  const A = (await git(dir, "rev-parse", "HEAD")).trim();
  put(dir, "f.txt", "b\n");
  put(dir, "g.txt", "g\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "B");
  const B = (await git(dir, "rev-parse", "HEAD")).trim();
  await git(dir, "reset", "-q", "--hard", A);
  return { dir, A, B };
}
const treeOf = async (dir: string, sha: string) => (await git(dir, "ls-tree", "-r", "-z", "--name-only", sha)).split("\0").filter(Boolean).sort();

describe("sdkPorts.git (real git)", () => {
  test("facts: a folder without its own repository has no git, even inside another repository; an unborn main is a branch without head", async () => {
    const p = localPorts();
    const { dir, A } = await repo();
    expect(await p.git.facts(dir)).toEqual({ hasGit: true, branch: "main", head: A, dirtyCount: 0 });
    put(dir, "new.txt");
    put(dir, "f.txt", "edited\n");
    expect((await p.git.facts(dir)).dirtyCount).toBe(2);
    mkdirSync(join(dir, "sub"));
    expect(await p.git.facts(join(dir, "sub"))).toEqual({ hasGit: false, branch: null, head: null, dirtyCount: 0 });
    expect(await p.git.facts(join(tmp("nogit"), "missing"))).toEqual({ hasGit: false, branch: null, head: null, dirtyCount: 0 });
    const unborn = tmp("unborn");
    await exec("git", ["init", "-q", "-b", "main", unborn]);
    expect(await p.git.facts(unborn)).toEqual({ hasGit: true, branch: "main", head: null, dirtyCount: 0 });
    await git(dir, "checkout", "-q", "--detach");
    expect((await p.git.facts(dir)).branch).toBeNull();
  });

  test("resetKeep moves branch and files, refuses over local edits", async () => {
    const p = localPorts();
    const { dir, A, B } = await repo();
    expect(await p.git.resetKeep(dir, B)).toBe("ok");
    expect(await p.git.facts(dir)).toEqual({ hasGit: true, branch: "main", head: B, dirtyCount: 0 });
    expect(text(dir, "f.txt")).toBe("b\n");
    expect(text(dir, "g.txt")).toBe("g\n");
    // an edit to a file the move does not touch does not block it and stays (as in the fake)
    await git(dir, "reset", "-q", "--hard", A);
    put(dir, "keep.txt", "local\n");
    expect(await p.git.resetKeep(dir, B)).toBe("ok");
    expect(text(dir, "keep.txt")).toBe("local\n");
    // an edit to an affected file — refused, neither the branch nor the edit is touched
    await git(dir, "reset", "-q", "--hard", A);
    put(dir, "f.txt", "local\n");
    const refused = await p.git.resetKeep(dir, B);
    expect(refused).toEqual({ refused: expect.stringContaining("f.txt") }); // git's text: which file is in the way
    expect((await p.git.facts(dir)).head).toBe(A);
    expect(text(dir, "f.txt")).toBe("local\n");
  });

  test("statusLines: the porcelain lines of the copy — edited, new; ignored ones are not there", async () => {
    const p = localPorts();
    const { dir } = await repo();
    expect(await p.git.statusLines(dir)).toEqual([]);
    put(dir, "f.txt", "edited\n");
    put(dir, "new.ts");
    put(dir, ".git/info/exclude", "*.log\n");
    put(dir, "x.log");
    expect(await p.git.statusLines(dir)).toEqual([" M f.txt", "?? new.ts"]);
    await expect(p.git.statusLines(tmp("plain"))).rejects.toThrow();
  });

  test("an interrupted move is recognised and finished", async () => {
    const p = localPorts();
    const { dir, A, B } = await repo();
    await git(dir, "update-ref", "refs/heads/main", B, A); // only the ref moved: files and index are still A
    const f = await p.git.facts(dir);
    expect(f).toMatchObject({ hasGit: true, branch: "main", head: B });
    expect(f.dirtyCount).toBeGreaterThan(0);
    const equalsFrom = await p.git.copyEquals(dir, A);
    expect(equalsFrom).toBe(true);
    expect(await p.git.copyEquals(dir, B)).toBe(false);
    expect(classifyCopy({ head: f.head, clean: f.dirtyCount === 0, equalsFrom }, A, B)).toBe("interrupted");
    await p.git.resetHard(dir, B);
    expect(await p.git.facts(dir)).toEqual({ hasGit: true, branch: "main", head: B, dirtyCount: 0 });
    expect(text(dir, "f.txt")).toBe("b\n");
    expect(await p.git.copyEquals(dir, B)).toBe(true);
  });

  test("copyEquals sees untracked files and a different index", async () => {
    const p = localPorts();
    const { dir, A } = await repo();
    expect(await p.git.copyEquals(dir, A)).toBe(true);
    put(dir, "new.txt");
    expect(await p.git.copyEquals(dir, A)).toBe(false);
    rmSync(join(dir, "new.txt"));
    // a file ignored by git does not count as new
    put(dir, ".git/info/exclude", "*.log\n");
    put(dir, "x.log");
    expect(await p.git.copyEquals(dir, A)).toBe(true);
    // files as in A, but a third version in the index
    put(dir, "f.txt", "third\n");
    await git(dir, "add", "f.txt");
    put(dir, "f.txt", "a\n");
    expect(await p.git.copyEquals(dir, A)).toBe(false);
    await git(dir, "reset", "-q");
    // a file deleted from the working tree is not «as in A» either
    rmSync(join(dir, "keep.txt"));
    expect(await p.git.copyEquals(dir, A)).toBe(false);
  });

  test("snapshotTree keeps the real index and excludes secrets", async () => {
    const p = localPorts();
    const { dir, A } = await repo();
    put(dir, "a.ts", "export const a = 1;\n");
    await git(dir, "add", "a.ts");
    put(dir, ".env", "TOKEN=fake\n");
    put(dir, "b.ts", "export const b = 2;\n");
    const indexBefore = readFileSync(join(dir, ".git", "index"));
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-1/canceled", [...CANCEL_EXCLUDE], []);
    expect([...r.files].sort()).toEqual(["a.ts", "b.ts"]);
    expect((await git(dir, "rev-parse", "refs/workshop/TEST-1/canceled")).trim()).toBe(r.sha);
    expect((await git(dir, "rev-parse", `${r.sha}^`)).trim()).toBe(A);
    expect(await treeOf(dir, r.sha)).toEqual(["a.ts", "b.ts", "f.txt", "keep.txt"]);
    expect((await git(dir, "diff", "--cached", "--name-only")).trim()).toBe("a.ts");
    expect(readFileSync(join(dir, ".git", "index")).equals(indexBefore)).toBe(true);
    expect((await git(dir, "rev-parse", "HEAD")).trim()).toBe(A);
  });

  test("snapshotTree takes deletions and edits of tracked files, skips the skipped ones, and does not need a clean tree", async () => {
    const p = localPorts();
    const { dir, A } = await repo();
    rmSync(join(dir, "keep.txt"));
    put(dir, "f.txt", "edited\n");
    put(dir, "config.ts", "secret-ish\n");
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-1/pre-recover", [...CANCEL_EXCLUDE], ["config.ts"]);
    expect(r.files).toEqual(["f.txt"]);
    expect(await treeOf(dir, r.sha)).toEqual(["f.txt"]);
    expect(await git(dir, "show", `${r.sha}:f.txt`)).toBe("edited\n");
    // skip does not strike an already tracked file from history: the snapshot keeps its HEAD version
    const s = await p.git.snapshotTree(dir, "refs/workshop/TEST-1/pre-recover", [], ["f.txt"]);
    expect(await git(dir, "show", `${s.sha}:f.txt`)).toBe("a\n");
    expect((await p.git.facts(dir)).head).toBe(A);
  });

  test("exclude patterns hold at any depth, the same in the commit and in changedFiles — and the fake agrees", async () => {
    const p = localPorts();
    const { dir } = await repo();
    const excluded = [
      ".env", "sub/.env", "sub/.env.local", "secrets/x", "deep/secrets/k", "node_modules/m/i.js", "a/node_modules/y", "dist/app.js",
      "pkg/dist/z", "x/id.pem", "y/z/server.key", ".superpowers/sdd/r.md", "w/.superpowers/q.md", "cache-1/c.bin", "p/cache-22/d.bin", "only/here.txt",
    ];
    const kept = ["src/ok.ts", "distant/d.ts", "my-secrets/s.ts", "envs/e.ts", ".env-files/x.ts", "pem.txt", "a/nodes/n.ts", "notes.keys", "cache/c.ts", "x/only/here.txt"];
    for (const rel of [...excluded, ...kept]) put(dir, rel);
    const patterns = [...CANCEL_EXCLUDE, "cache-*/", "only/here.txt"];
    expect([...(await p.git.changedFiles(dir, patterns))].sort()).toEqual([...kept].sort());
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-2/canceled", patterns, []);
    expect([...r.files].sort()).toEqual([...kept].sort());
    const tree = await treeOf(dir, r.sha);
    for (const rel of excluded) expect(tree).not.toContain(rel);
    for (const rel of kept) expect(tree).toContain(rel);
    const fake = new FakePorts();
    fake.git.setRepo("/d", { files: [...excluded, ...kept] });
    expect([...(await fake.git.changedFiles("/d", patterns))].sort()).toEqual([...kept].sort());
  });

  test("changedFiles: modified, staged and new files with odd names; not deleted, ignored or unchanged ones", async () => {
    const p = localPorts();
    const { dir } = await repo();
    put(dir, ".gitignore", "*.log\n");
    await git(dir, "add", ".gitignore");
    await git(dir, "commit", "-q", "-m", "ignore");
    put(dir, "f.txt", "edited\n");
    rmSync(join(dir, "keep.txt"));
    put(dir, "naïve file.ts");
    put(dir, "dir with space/a b.ts");
    put(dir, "staged.ts");
    await git(dir, "add", "staged.ts");
    put(dir, "debug.log");
    put(dir, ":colon[1]*.ts");
    expect([...(await p.git.changedFiles(dir, []))].sort()).toEqual([":colon[1]*.ts", "dir with space/a b.ts", "f.txt", "staged.ts", "naïve file.ts"].sort());
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-3/canceled", [], ["naïve file.ts", ":colon[1]*.ts"]);
    expect([...r.files].sort()).toEqual(["dir with space/a b.ts", "f.txt", "staged.ts"]);
    const tree = await treeOf(dir, r.sha);
    expect(tree).toContain("dir with space/a b.ts");
    expect(tree).not.toContain("naïve file.ts");
    expect(tree).not.toContain(":colon[1]*.ts");
    expect(tree).not.toContain("keep.txt");
  });

  test("changedFiles sees what snapshotTree takes despite index flags: skip-worktree, assume-unchanged, rm --cached + ignore", async () => {
    const p = localPorts();
    const { dir } = await repo();
    for (const f of ["local.json", "au.json", "cfg.json"]) put(dir, f, "{}\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "configs");
    const token = `gho_${"FAKE".repeat(9)}`;
    await git(dir, "update-index", "--skip-worktree", "local.json");
    put(dir, "local.json", `{"t":"${token}"}\n`);
    await git(dir, "update-index", "--assume-unchanged", "au.json");
    put(dir, "au.json", `{"t":"${token}"}\n`);
    await git(dir, "rm", "-q", "--cached", "cfg.json");
    put(dir, ".gitignore", "cfg.json\n");
    put(dir, "cfg.json", `{"t":"${token}"}\n`);
    const flags = await git(dir, "ls-files", "-v");
    const changed = [...(await p.git.changedFiles(dir, [...CANCEL_EXCLUDE]))].sort();
    expect(changed).toEqual([".gitignore", "au.json", "cfg.json", "local.json"]);
    // the check sees the files and skipping removes them: the commit gets the HEAD versions, not the token
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-6/canceled", [...CANCEL_EXCLUDE], ["local.json", "au.json", "cfg.json"]);
    expect(r.files).toEqual([".gitignore"]);
    for (const f of ["local.json", "au.json", "cfg.json"]) expect(await git(dir, "show", `${r.sha}:${f}`)).toBe("{}\n");
    // without skipping, the snapshot would take exactly what changedFiles named
    const all = await p.git.snapshotTree(dir, "refs/workshop/TEST-6/all", [...CANCEL_EXCLUDE], []);
    expect([...all.files].sort()).toEqual(changed);
    expect(await git(dir, "ls-files", "-v")).toBe(flags); // the real index's flags are in place
  });

  test("nested repositories are neither listed nor committed — untracked, empty and a moved submodule — and are reported", async () => {
    const p = localPorts();
    const { dir } = await repo();
    const sub = join(dir, "sub");
    await exec("git", ["init", "-q", "-b", "main", sub]);
    put(sub, "s.txt", "1\n");
    await git(sub, "add", "-A");
    await git(sub, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "s1");
    await git(dir, "add", "sub");
    await git(dir, "commit", "-q", "-m", "submodule");
    const pinned = (await git(dir, "rev-parse", "HEAD:sub")).trim();
    put(sub, "s.txt", "2\n");
    await git(sub, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-am", "s2");
    const ref = join(dir, "vendor", "ref");
    await exec("git", ["init", "-q", "-b", "main", ref]);
    put(ref, "r.txt");
    await git(ref, "add", "-A");
    await git(ref, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "r");
    await exec("git", ["init", "-q", "-b", "main", join(dir, "empty")]);
    put(dir, "ok.ts");
    expect(await p.git.changedFiles(dir, [...CANCEL_EXCLUDE])).toEqual(["ok.ts"]);
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-7/canceled", [...CANCEL_EXCLUDE], []);
    expect(r.files).toEqual(["ok.ts"]);
    expect([...r.nested].sort()).toEqual(["empty", "sub", "vendor/ref"]);
    const tree = await treeOf(dir, r.sha);
    expect(tree).not.toContain("vendor/ref");
    expect(tree).not.toContain("empty");
    expect((await git(dir, "rev-parse", `${r.sha}:sub`)).trim()).toBe(pinned); // the submodule is as in HEAD
  });

  test("changedFiles writes nothing into the object store of the repository — unchecked files stay out of it; snapshotTree does write", async () => {
    const p = localPorts();
    const { dir } = await repo();
    put(dir, "secret.ts", `export const token = "${randomUUID()}";\n`);
    put(dir, "f.txt", `edited ${randomUUID()}\n`);
    const blobs = [(await git(dir, "hash-object", "secret.ts")).trim(), (await git(dir, "hash-object", "f.txt")).trim()];
    const stored = (repoDir: string, sha: string) => exec("git", ["-C", repoDir, "cat-file", "-e", sha]).then(() => true, () => false);
    expect(await Promise.all(blobs.map((b) => stored(dir, b)))).toEqual([false, false]);
    expect([...(await p.git.changedFiles(dir, []))].sort()).toEqual(["f.txt", "secret.ts"]);
    expect(await Promise.all(blobs.map((b) => stored(dir, b)))).toEqual([false, false]);
    // Linked worktree: HEAD is read from the shared store, and nothing new is written there.
    const wt = join(tmp("wt"), "work");
    await git(dir, "worktree", "add", "-q", "-b", "alia/TEST-8", wt);
    put(wt, "wt-secret.ts", `export const t = "${randomUUID()}";\n`);
    const wtBlob = (await git(wt, "hash-object", "wt-secret.ts")).trim();
    expect(await p.git.changedFiles(wt, [])).toEqual(["wt-secret.ts"]);
    expect(await stored(dir, wtBlob)).toBe(false);
    // The snapshot is a commit: its objects are in the real store, as before.
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-8/canceled", [], []);
    expect(await Promise.all(blobs.map((b) => stored(dir, b)))).toEqual([true, true]);
    expect(await git(dir, "show", `${r.sha}:secret.ts`)).toContain("token");
  });

  test("changedFiles of a repository whose path has a colon: the read-only store is quoted for git", async () => {
    const p = localPorts();
    const dir = join(tmp("colon"), "a:b");
    await exec("git", ["init", "-q", "-b", "main", dir]);
    put(dir, "f.txt", "a\n");
    await git(dir, "add", "-A");
    await git(dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "A");
    put(dir, "f.txt", "b\n");
    put(dir, "new.ts");
    expect([...(await p.git.changedFiles(dir, []))].sort()).toEqual(["f.txt", "new.ts"]);
  });

  test("a moved submodule is nested even when diff.ignoreSubmodules hides it from a plain diff", async () => {
    const p = localPorts();
    const { dir } = await repo();
    const sub = join(dir, "sub");
    await exec("git", ["init", "-q", "-b", "main", sub]);
    put(sub, "s.txt", "1\n");
    await git(sub, "add", "-A");
    await git(sub, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "s1");
    await git(dir, "add", "sub");
    await git(dir, "commit", "-q", "-m", "submodule");
    const pinned = (await git(dir, "rev-parse", "HEAD:sub")).trim();
    put(sub, "s.txt", "2\n");
    await git(sub, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-am", "s2");
    await git(dir, "config", "diff.ignoreSubmodules", "all");
    put(dir, "ok.ts");
    expect(await p.git.changedFiles(dir, [])).toEqual(["ok.ts"]);
    const r = await p.git.snapshotTree(dir, "refs/workshop/TEST-9/canceled", [], []);
    expect(r.nested).toEqual(["sub"]);
    expect((await git(dir, "rev-parse", `${r.sha}:sub`)).trim()).toBe(pinned);
  });

  test("the cancel snapshot flow on a linked worktree: commit in the worktree, ref visible in the plugin repository", async () => {
    const p = localPorts();
    const { dir: plugin } = await repo();
    const wt = join(tmp("wt"), "work");
    await git(plugin, "worktree", "add", "-q", "-b", "alia/TEST-4", wt);
    put(wt, "src/new.ts");
    put(wt, "node_modules/x/i.js");
    const before = await git(wt, "status", "--porcelain");
    const r = await p.git.snapshotTree(wt, "refs/workshop/TEST-4/canceled", [...CANCEL_EXCLUDE], []);
    await p.git.updateRef(plugin, "refs/workshop/TEST-4/canceled", r.sha);
    expect((await git(plugin, "rev-parse", "refs/workshop/TEST-4/canceled")).trim()).toBe(r.sha);
    expect(await treeOf(plugin, r.sha)).toContain("src/new.ts");
    expect(await treeOf(plugin, r.sha)).not.toContain("node_modules/x/i.js");
    expect(await git(wt, "status", "--porcelain")).toBe(before);
  });

  test("initCommit makes a repository on main in a plain folder, then adds commits; isAncestor and updateRef", async () => {
    const p = localPorts();
    const dir = tmp("init");
    put(dir, "package.json", "{}\n");
    put(dir, ".gitignore", "node_modules/\n");
    put(dir, "node_modules/x/i.js");
    const a = await p.git.initCommit(dir, "chore: scaffold");
    expect(await p.git.facts(dir)).toEqual({ hasGit: true, branch: "main", head: a, dirtyCount: 0 });
    expect(await treeOf(dir, a)).toEqual([".gitignore", "package.json"]);
    put(dir, "server.ts");
    const b = await p.git.initCommit(dir, "second");
    expect(b).not.toBe(a);
    expect(await p.git.isAncestor(dir, a, b)).toBe(true);
    expect(await p.git.isAncestor(dir, b, a)).toBe(false);
    expect(await p.git.isAncestor(dir, a, a)).toBe(true);
    expect(await p.git.isAncestor(dir, "0".repeat(40), b)).toBe(false);
    await p.git.updateRef(dir, "refs/workshop/TEST-5/before", a);
    expect((await git(dir, "rev-parse", "refs/workshop/TEST-5/before")).trim()).toBe(a);
    expect((await p.git.facts(dir)).head).toBe(b);
    // a folder inside another repository gets its own
    const { dir: outer } = await repo();
    const inner = join(outer, "inner");
    put(inner, "x.ts");
    const c = await p.git.initCommit(inner, "own");
    expect(await p.git.facts(inner)).toEqual({ hasGit: true, branch: "main", head: c, dirtyCount: 0 });
  });

  test("stagedState captures the index once; stagedPatch is a binary, full-index diff of exactly the named paths of that state; readBlobs gives raw bytes", async () => {
    const p = localPorts();
    const { dir } = await repo();
    put(dir, "a.ts", "export const a = 1;\n");
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 255, 0]));
    put(dir, "keys.env", "PASSWORD=hunter2\n");
    put(dir, "dir with space/*odd:[1].ts", "odd\n");
    await git(dir, "add", "a.ts", "blob.bin", "keys.env", "dir with space");
    await git(dir, "rm", "-q", "--cached", "keep.txt");
    put(dir, "unstaged.ts");
    const st = await p.git.stagedState(dir);
    expect(st.base).toBe((await git(dir, "rev-parse", "HEAD")).trim());
    expect(st.paths.map((e) => e.path).sort()).toEqual(["a.ts", "blob.bin", "dir with space/*odd:[1].ts", "keep.txt", "keys.env"]);
    const by = (path: string) => st.paths.find((e) => e.path === path)!;
    expect(by("keep.txt")).toEqual({ path: "keep.txt", old: (await git(dir, "rev-parse", "HEAD:keep.txt")).trim(), new: null });
    expect(by("blob.bin")).toEqual({ path: "blob.bin", old: null, new: (await git(dir, "rev-parse", ":blob.bin")).trim() });
    const d = await p.git.stagedPatch(dir, st.base, st.tree, ["a.ts", "blob.bin", "dir with space/*odd:[1].ts"]);
    expect(d).toContain("+export const a = 1;");
    expect(d).toContain("GIT binary patch");
    expect(d).toContain("+odd");
    expect(d).toMatch(/index 0{40}\.\.[0-9a-f]{40}/);
    expect(d).not.toContain("unstaged.ts");
    expect(d).not.toContain("hunter2");
    // A literal pathspec: `*` in a name is not a glob that would take other files.
    expect(await p.git.stagedPatch(dir, st.base, st.tree, ["*.ts"])).toBe("");
    // No paths is no diff — not the whole index.
    expect(await p.git.stagedPatch(dir, st.base, st.tree, [])).toBe("");
    const blobs = await p.git.readBlobs(dir, [by("blob.bin").new!, by("keep.txt").old!, by("blob.bin").new!], 1024);
    expect([...blobs.get(by("blob.bin").new!)!]).toEqual([0, 1, 2, 255, 0]);
    expect(blobs.get(by("keep.txt").old!)!.toString()).toBe("keep\n");
    await expect(p.git.readBlobs(dir, [by("a.ts").new!, by("keep.txt").old!], 10)).rejects.toThrow(/more than/);
    await expect(p.git.readBlobs(dir, ["0123456789012345678901234567890123456789"], 1024)).rejects.toThrow(/missing/);
    await expect(p.git.readBlobs(dir, ["HEAD"], 1024)).rejects.toThrow(/malformed/);
    // The real index is only read: another git process holding its lock does not stop the capture, and the index is unchanged.
    const index = readFileSync(join(dir, ".git", "index"));
    writeFileSync(join(dir, ".git", "index.lock"), "");
    expect((await p.git.stagedState(dir)).tree).toBe(st.tree);
    rmSync(join(dir, ".git", "index.lock"));
    expect(readFileSync(join(dir, ".git", "index")).equals(index)).toBe(true);
    await expect(p.git.stagedState(tmp("plain"))).rejects.toThrow();
    await expect(p.git.stagedPatch(tmp("plain"), st.base, st.tree, ["a.ts"])).rejects.toThrow();
  });

  test("stagedState: a repository without commits is compared with the empty tree; unmerged entries cannot be captured", async () => {
    const p = localPorts();
    const dir = tmp("unborn");
    await exec("git", ["init", "-q", "-b", "main", dir]);
    put(dir, "a.ts", "1\n");
    await git(dir, "add", "a.ts");
    const st = await p.git.stagedState(dir);
    expect(st.base).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    expect(st.paths.map((e) => [e.path, e.old])).toEqual([["a.ts", null]]);
    const { dir: d2 } = await repo();
    const G = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];
    await git(d2, "checkout", "-q", "-b", "side");
    put(d2, "f.txt", "side\n");
    await exec("git", ["-C", d2, ...G, "commit", "-q", "-am", "side"]);
    await git(d2, "checkout", "-q", "main");
    put(d2, "f.txt", "main\n");
    await exec("git", ["-C", d2, ...G, "commit", "-q", "-am", "main"]);
    await exec("git", ["-C", d2, ...G, "merge", "-q", "side"]).catch(() => undefined);
    await expect(p.git.stagedState(d2)).rejects.toThrow(/write-tree/);
  });

  test("the cancel snapshot over real git: a token staged in a binary file whose worktree copy was replaced by clean bytes — staged.patch is withheld", async () => {
    const real = localPorts();
    const fake = new FakePorts();
    const { dir } = await repo();
    // The exact case: the binary is staged with a token, then the working tree gets clean bytes without staging them again.
    writeFileSync(join(dir, "blob.bin"), Buffer.concat([Buffer.from([0, 1, 2, 255, 0]), Buffer.from(`k=${GITHUB_TOKEN}`), Buffer.from([0, 7, 0])]));
    put(dir, "a.ts", "export const a = 1;\n");
    await git(dir, "add", "blob.bin", "a.ts");
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 255, 0, 9, 9, 0]));
    // A binary patch is compressed: its text does not show the token, so a scan of the patch text alone passes it.
    expect(await git(dir, "diff", "--cached", "--binary")).not.toContain(GITHUB_TOKEN);
    // Everything but git and the worktree reads is the fake: the worktree file is read from disk, the way VesnALIA hands it over.
    const ports = new Proxy(fake, {
      get(target, key, receiver) {
        if (key === "git") return real.git;
        if (key === "readRaw")
          return async (_env: string, rel: string) => {
            const buf = readFileSync(join(dir, rel));
            return { content: buf.toString("base64"), encoding: "base64" as const, mime: "application/octet-stream", size: buf.length };
          };
        return Reflect.get(target, key, receiver);
      },
    });
    const r = await cancelSnapshot(ports, { id: "w1", task_key: "TEST-9", environment_id: "env_1", worktreeDir: dir, pluginDir: dir });
    expect(r).toMatchObject({ ok: true, patch: "withheld", skipped: [] });
    expect(fake.texts.map((t) => t.relPath)).toEqual(["manifest.json"]);
    const manifest = JSON.parse(fake.texts[0]!.content) as { withheld: Array<{ path: string; labels: string[] }>; stagedPatch: string };
    expect(manifest.stagedPatch).toBe("withheld");
    expect(manifest.withheld).toEqual([{ path: "staged.patch", labels: ["blob.bin (staged): ghp_", "blob.bin (staged): gh_token"] }]);
    expect(JSON.stringify(fake.texts)).not.toContain(GITHUB_TOKEN);
    // The same staging with clean content: the patch is kept, binary part included.
    const { dir: clean } = await repo();
    writeFileSync(join(clean, "blob.bin"), Buffer.from([0, 1, 2, 255, 0, 9]));
    await git(clean, "add", "blob.bin");
    const fake2 = new FakePorts();
    const ports2 = new Proxy(fake2, { get: (t, k, rcv) => (k === "git" ? real.git : k === "readRaw" ? async () => null : Reflect.get(t, k, rcv)) });
    expect(await cancelSnapshot(ports2, { id: "w2", task_key: "TEST-9", environment_id: "env_1", worktreeDir: clean, pluginDir: clean })).toMatchObject({ ok: true, patch: "saved" });
    expect(fake2.texts.find((t) => t.relPath === "staged.patch")!.content).toContain("GIT binary patch");
  });
});

describe("sdkPorts.lock (real flock)", () => {
  const run = `t12${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  let o: { locksDir: string; buildLock: string };
  const foreign: ChildProcess[] = [];
  const id = (n: string) => `${run}-${n}`;
  const free = () => exec("flock", ["-n", o.buildLock, "true"]).then(() => true, () => false);
  const holders = (attempt: string, token: string) =>
    exec("pgrep", ["-f", `workshop-holder ${attempt} ${token}$`]).then((r) => r.stdout.trim().split("\n").filter(Boolean).length, () => 0);
  /** A foreign `flock build.lock sleep 30` in its own process group: killed together with the `sleep` that holds the lock. */
  async function occupy(): Promise<ChildProcess> {
    const c = spawn("flock", [o.buildLock, "sleep", "30"], { detached: true, stdio: "ignore" });
    foreign.push(c);
    await until(async () => !(await free()), 3000, "the outsider took the lock");
    return c;
  }
  const kill = (c: ChildProcess) => {
    try {
      process.kill(-c.pid!, "SIGKILL");
    } catch {
      // already exited
    }
  };
  beforeEach(() => {
    const root = tmp("lock");
    o = { locksDir: join(root, SELF_ID), buildLock: join(root, "build.lock") };
  });
  afterEach(async () => {
    for (const c of foreign.splice(0)) kill(c);
    await exec("pkill", ["-9", "-f", `workshop-holder ${run}`]).catch(() => undefined);
  });

  test("holder holds while the request exists", { timeout: 20_000 }, async () => {
    const p = localPorts(o);
    const a = id("a1");
    const t = randomUUID();
    await p.lock.request(a, t);
    await until(async () => (await p.lock.state(a, t)) === "held", 4000, "held");
    expect(await free()).toBe(false);
    expect(text(o.locksDir, `${a}.want`).trim()).toBe(t);
    expect(text(o.locksDir, `${a}.held`)).toMatch(new RegExp(`^\\d+ ${t}\\n?$`));
    await p.lock.release(a);
    expect(existsSync(join(o.locksDir, `${a}.want`))).toBe(false);
    expect(await until(async () => (await p.lock.state(a, t)) === "none" && (await free()), 3000, "none and a free lock")).toBeLessThanOrEqual(3000);
    expect(existsSync(join(o.locksDir, `${a}.held`))).toBe(false);
  });

  test("a second request for the same attempt does not spawn a second holder", { timeout: 20_000 }, async () => {
    const p = localPorts(o);
    const a = id("a2");
    const t = randomUUID();
    await p.lock.request(a, t);
    await p.lock.request(a, t);
    await until(async () => (await p.lock.state(a, t)) === "held", 4000, "held");
    await p.lock.request(a, t);
    expect(await p.lock.state(a, t)).toBe("held");
    await new Promise((r) => setTimeout(r, 300));
    expect(await holders(a, t)).toBe(2); // one holder: flock and its sh
  });

  test("a holder without a request exits at once", { timeout: 20_000 }, async () => {
    const p = localPorts(o);
    const a = id("a3");
    const t = randomUUID();
    const f = await occupy();
    await p.lock.request(a, t);
    expect(await p.lock.state(a, t)).toBe("waiting");
    await p.lock.release(a);
    kill(f);
    await until(async () => (await holders(a, t)) === 0, 3000, "the holder exited");
    expect(await p.lock.state(a, t)).toBe("none");
    await until(free, 3000, "the lock is free");
    expect(existsSync(join(o.locksDir, `${a}.held`))).toBe(false);
  });

  test("a second attempt waits for the first holder", { timeout: 20_000 }, async () => {
    const p = localPorts(o);
    const [a1, a2] = [id("a4"), id("a5")];
    const [t1, t2] = [randomUUID(), randomUUID()];
    await p.lock.request(a1, t1);
    await until(async () => (await p.lock.state(a1, t1)) === "held", 4000, "a1 held");
    await p.lock.request(a2, t2);
    await new Promise((r) => setTimeout(r, 500));
    expect(await p.lock.state(a2, t2)).toBe("waiting");
    await p.lock.release(a1);
    await until(async () => (await p.lock.state(a2, t2)) === "held", 4000, "a2 held");
    expect(await p.lock.state(a1, t1)).toBe("none");
    expect(await free()).toBe(false);
  });

  test("a stale mark of a dead holder is never taken for held", { timeout: 25_000 }, async () => {
    const p = localPorts(o);
    const a = id("a6");
    const [t1, t2] = [randomUUID(), randomUUID()];
    await p.lock.request(a, t1);
    await until(async () => (await p.lock.state(a, t1)) === "held", 4000, "held");
    const pid = Number(text(o.locksDir, `${a}.held`).split(" ")[0]);
    process.kill(pid, "SIGKILL"); // the holder's sh: no cleanup
    await until(async () => (await holders(a, t1)) === 0, 3000, "the holder's flock exited");
    await until(free, 3000, "the orphaned sleep released the lock");
    expect(text(o.locksDir, `${a}.held`)).toContain(t1); // the mark is left behind
    expect(await p.lock.state(a, t1)).toBe("none"); // its process is gone — that is not held
    const f = await occupy();
    await p.lock.request(a, t2);
    expect(existsSync(join(o.locksDir, `${a}.held`))).toBe(false); // the foreign mark is removed
    expect(await p.lock.state(a, t2)).toBe("waiting");
    kill(f);
    await until(async () => (await p.lock.state(a, t2)) === "held", 4000, "held by the new generation");
  });

  test("the same generation is requested again after its holder died: a new holder takes over the old mark", { timeout: 20_000 }, async () => {
    const p = localPorts(o);
    const a = id("a7");
    const t = randomUUID();
    await p.lock.request(a, t);
    await until(async () => (await p.lock.state(a, t)) === "held", 4000, "held");
    const pid = Number(text(o.locksDir, `${a}.held`).split(" ")[0]);
    process.kill(pid, "SIGKILL");
    await until(async () => (await p.lock.state(a, t)) === "none", 3000, "none");
    await p.lock.request(a, t);
    await until(async () => (await p.lock.state(a, t)) === "held", 5000, "held again");
    expect(Number(text(o.locksDir, `${a}.held`).split(" ")[0])).not.toBe(pid);
  });

  test("pgrep pattern does not match a longer id", { timeout: 20_000 }, async () => {
    const p = localPorts(o);
    const t = randomUUID();
    await p.lock.request(id("a10"), t);
    await until(async () => (await p.lock.state(id("a10"), t)) === "held", 4000, "a10 held");
    expect(await p.lock.state(id("a1"), t)).toBe("none");
  });

  test("sweep removes the requests and marks of attempts not in keep", { timeout: 20_000 }, async () => {
    const p = localPorts(o);
    const [a1, a2, a3] = [id("s1"), id("s2"), id("s3")];
    const [t1, t2] = [randomUUID(), randomUUID()];
    await p.lock.request(a1, t1);
    await until(async () => (await p.lock.state(a1, t1)) === "held", 4000, "s1 held");
    await p.lock.request(a2, t2);
    writeFileSync(join(o.locksDir, `${a3}.want`), "old");
    writeFileSync(join(o.locksDir, `${a3}.held`), "1 old");
    await p.lock.sweep([a2]);
    expect(existsSync(join(o.locksDir, `${a1}.want`))).toBe(false);
    expect(existsSync(join(o.locksDir, `${a3}.want`))).toBe(false);
    expect(existsSync(join(o.locksDir, `${a3}.held`))).toBe(false);
    expect(text(o.locksDir, `${a2}.want`)).toBe(t2);
    await until(async () => (await p.lock.state(a2, t2)) === "held", 4000, "s2 held after s1 left");
    await p.lock.sweep([]);
    await until(free, 4000, "the lock is free");
    await localPorts({ locksDir: join(tmp("nolocks"), "none"), buildLock: o.buildLock }).lock.sweep([]); // no folder — not an error
  });

  test("an id or token a shell or a file name would misread is refused", async () => {
    const p = localPorts(o);
    await expect(p.lock.request("../x", "t")).rejects.toThrow();
    await expect(p.lock.request("a b", "t")).rejects.toThrow();
    await expect(p.lock.request("a", "t$(id)")).rejects.toThrow();
  });

  test("holderScript takes the locks dir and refuses a quote", () => {
    expect(holderScript("/tmp/x").startsWith("LOCKS='/tmp/x';")).toBe(true);
    expect(holderScript("/srv/alia/locks/plugin-workshop")).toBe(
      `LOCKS='/srv/alia/locks/plugin-workshop'; w="$LOCKS/$1.want"; [ "$(cat "$w" 2>/dev/null)" = "$2" ] || exit 0; echo "$$ $2" > "$LOCKS/$1.held"; while [ "$(cat "$w" 2>/dev/null)" = "$2" ]; do sleep 2; done; rm -f "$LOCKS/$1.held"`,
    );
    expect(() => holderScript("/tmp/a'b")).toThrow();
    expect(() => localPorts({ locksDir: "/tmp/a'b" })).toThrow();
  });
});

describe("sdkPorts.fs (real file system)", () => {
  test("rename refuses an existing target — an empty folder too —, a missing source and a missing parent", async () => {
    const p = localPorts();
    const root = tmp("fs");
    put(root, "src/f", "1");
    mkdirSync(join(root, "empty"));
    await expect(p.fs.rename(join(root, "src"), join(root, "empty"))).rejects.toThrow(/already exists/);
    expect(text(root, "src/f")).toBe("1");
    put(root, "file", "2");
    await expect(p.fs.rename(join(root, "src"), join(root, "file"))).rejects.toThrow(/already exists/);
    await expect(p.fs.rename(join(root, "nope"), join(root, "x"))).rejects.toThrow(/no such path/);
    await expect(p.fs.rename(join(root, "src"), join(root, "no", "x"))).rejects.toThrow(/no such folder/);
    await p.fs.rename(join(root, "src"), join(root, "dst"));
    expect(text(root, "dst/f")).toBe("1");
    expect(existsSync(join(root, "src"))).toBe(false);
  });

  test("exists, list, remove and freeDiskGb", async () => {
    const p = localPorts();
    const root = tmp("fs");
    put(root, "a/b/c", "1");
    put(root, "a2/x", "2");
    symlinkSync(join(root, "nowhere"), join(root, "dangling"));
    expect(await p.fs.exists(join(root, "a/b/c"))).toBe(true);
    expect(await p.fs.exists(join(root, "dangling"))).toBe(true); // the path is taken, even though the link points nowhere
    expect(await p.fs.exists(join(root, "zzz"))).toBe(false);
    expect(await p.fs.exists(join(root, "a/b/c/d"))).toBe(false);
    expect((await p.fs.list(root)).sort()).toEqual(["a", "a2", "dangling"]);
    expect(await p.fs.list(join(root, "zzz"))).toEqual([]);
    await p.fs.remove(join(root, "a"));
    await p.fs.remove(join(root, "a"));
    expect((await p.fs.list(root)).sort()).toEqual(["a2", "dangling"]);
    const gb = await p.fs.freeDiskGb(root);
    expect(gb).toBeGreaterThan(0);
    expect(gb).toBeLessThan(1_000_000);
  });

  /** A fake `VesnALIA`: like `alia plugin new <id>` — a nested folder in the current one, plus notes: where it ran and whether the lock was held. */
  function fakeAlia(root: string, lock: string, body = ""): string {
    const bin = join(root, "fake-alia");
    writeFileSync(
      bin,
      `#!/bin/sh\n[ "$1 $2" = "plugin new" ] || exit 2\n${body}\nmkdir "alia-plugin-$3" || exit 1\nif flock -n '${lock}' true; then echo free; else echo held; fi > "alia-plugin-$3/lock"\npwd > "alia-plugin-$3/cwd"\n`,
    );
    chmodSync(bin, 0o755);
    return bin;
  }

  test("scaffold makes tmpDir itself and runs VesnALIA plugin new in it under the build lock; the scaffold is the nested folder", async () => {
    const root = tmp("scaffold");
    const lock = join(root, "build.lock");
    const p = localPorts({ buildLock: lock, aliaBin: fakeAlia(root, lock) });
    const tmpDir = join(root, ".workshop-new", "w1");
    await p.fs.scaffold("hello", tmpDir);
    const nested = join(tmpDir, "alia-plugin-hello");
    expect(await p.fs.list(tmpDir)).toEqual(["alia-plugin-hello"]);
    expect(text(nested, "cwd").trim()).toBe(tmpDir);
    expect(text(nested, "lock").trim()).toBe("held");
  });

  test("a repeat after remove starts from a fresh folder even if an interrupted run wrote into the old one", { timeout: 20_000 }, async () => {
    const root = tmp("scaffold");
    const lock = join(root, "build.lock");
    const p = localPorts({ buildLock: lock, aliaBin: fakeAlia(root, lock) });
    const tmpDir = join(root, ".workshop-new", "w1");
    const nested = join(tmpDir, "alia-plugin-hello");
    // An earlier `alia plugin new` is still running and holds the build lock: the repeat waits for it to finish.
    const old = spawn("flock", [lock, "sh", "-c", `sleep 1; mkdir -p '${nested}' && echo late > '${nested}/late'`], { detached: true, stdio: "ignore" });
    await until(async () => !(await exec("flock", ["-n", lock, "true"]).then(() => true, () => false)), 3000, "the earlier run holds the lock");
    await p.fs.remove(tmpDir);
    await p.fs.scaffold("hello", tmpDir);
    expect(old.exitCode ?? (await new Promise((r) => old.on("exit", r)))).toBe(0);
    expect(existsSync(join(nested, "late"))).toBe(false); // what the earlier run wrote is removed under the lock
    expect((await p.fs.list(nested)).sort()).toEqual(["cwd", "lock"]);
  });

  test("scaffold fails when VesnALIA plugin new fails, and refuses an id that is not a plugin id", async () => {
    const root = tmp("scaffold");
    const lock = join(root, "build.lock");
    const p = localPorts({ buildLock: lock, aliaBin: fakeAlia(root, lock, "echo 'npm exploded' >&2; exit 3") });
    await expect(p.fs.scaffold("hello", join(root, "t"))).rejects.toThrow(/npm exploded/);
    await expect(p.fs.scaffold("../x", join(root, "u"))).rejects.toThrow();
    expect(existsSync(join(root, "u"))).toBe(false);
  });
});

describe("sdkPorts.plugins (fake VesnALIA)", () => {
  const srcJob = (id: string, state: string, source: string, extra: Record<string, unknown> = {}) => ({
    id, displayName: source, state, target: { kind: "source", source, selection: { kind: "root" } }, ...extra,
  });
  const catJob = (id: string, state: string) => ({ id, displayName: "x", state, target: { kind: "catalog", entryId: "x", marketplace: "m" } });
  const A = "/srv/plugins/alia-plugin-a";

  test("jobs map target.source and states", async () => {
    const list = vi.fn(async () => [
      srcJob("j1", "running", `path:${A}`),
      catJob("j2", "queued"),
      srcJob("j3", "cancelling", A),
      srcJob("j4", "failed", "path:/x", { error: "Build failed" }),
      srcJob("j5", "succeeded", "path:/y", { plugin: { id: "y", status: "error" } }),
      srcJob("j6", "cancelled", "path:/z"),
    ]);
    const p = sdkAlia({ plugins: { installJobs: { list } } });
    const jobs = await p.plugins.jobs();
    expect(jobs).toEqual([
      { id: "j1", source: `path:${A}`, state: "running", error: null },
      { id: "j2", source: null, state: "queued", error: null },
      { id: "j3", source: A, state: "cancelling", error: null },
      { id: "j4", source: "path:/x", state: "failed", error: "Build failed" },
      { id: "j5", source: "path:/y", state: "succeeded", error: null },
      { id: "j6", source: "path:/z", state: "cancelled", error: null },
    ]);
    expect(runningJobsOf(jobs, A).map((j) => j.id)).toEqual(["j1", "j3"]);
    const odd = sdkAlia({ plugins: { installJobs: { list: async () => [srcJob("j7", "exploding", A)] } } });
    await expect(odd.plugins.jobs()).rejects.toThrow();
  });

  test("an unknown plugin status or job state stays an error, and its raw value goes to the plugin log", async () => {
    const warn = vi.fn();
    const alia = (sdk: Record<string, unknown>) => sdkPorts({ log: { warn }, sdk } as unknown as AliaPluginApi, () => undefined);
    const plugins = [{ id: "mail", name: "Mail", status: "hibernating", enabled: true, source: "path:/p/alia-plugin-mail", rootDir: "/p/alia-plugin-mail", statusDetail: null }];
    await expect(alia({ plugins: { list: async () => ({ plugins }) } }).plugins.list()).rejects.toThrow();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/plugins\.0\.status.*"hibernating"/);
    warn.mockClear();
    await expect(alia({ plugins: { installJobs: { list: async () => [srcJob("j7", "exploding", A)] } } }).plugins.jobs()).rejects.toThrow();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/state.*"exploding"/);
  });

  test("job by id; a job VesnALIA no longer knows is null, any other failure is an error", async () => {
    const get = vi.fn(async ({ jobId }: { jobId: string }) => {
      if (jobId === "j1") return srcJob("j1", "succeeded", `path:${A}`);
      if (jobId === "gone") throw new Error("HTTP 404: unknown install job; the server may have restarted");
      throw new Error("HTTP 500: boom");
    });
    const p = sdkAlia({ plugins: { installJobs: { get } } });
    expect(await p.plugins.job("j1")).toEqual({ id: "j1", source: `path:${A}`, state: "succeeded", error: null });
    expect(await p.plugins.job("gone")).toBeNull();
    await expect(p.plugins.job("x")).rejects.toThrow("boom");
  });

  test("startInstall passes path:<dir> — the form of the CLI and of InstalledPlugin.source — and returns the job id; cancelJob cancels", async () => {
    const startInstall = vi.fn(async (a: { source: string }) => srcJob("j9", "running", a.source));
    const cancel = vi.fn(async () => srcJob("j9", "cancelling", `path:${A}`));
    const p = sdkAlia({ plugins: { startInstall, installJobs: { cancel } } });
    expect(await p.plugins.startInstall(A)).toBe("j9");
    expect(startInstall).toHaveBeenCalledWith({ source: `path:${A}` });
    await p.plugins.cancelJob("j9");
    expect(cancel).toHaveBeenCalledWith({ jobId: "j9" });
  });

  test("list drops builtin plugins", async () => {
    const plugins = [
      { id: "account-pool", name: "Account Pool", status: "running", enabled: true, source: "builtin:account-pool", rootDir: "/app/builtin/account-pool", statusDetail: null },
      { id: "mail", name: "Mail", status: "running", enabled: true, source: "path:/srv/plugins/alia-plugin-mail", rootDir: "/srv/plugins/alia-plugin-mail", statusDetail: null, version: "1.0.0", app: { hasApp: false, bundle: null } },
      { id: "gone", name: null, status: "missing", enabled: true, source: "path:/srv/plugins/alia-plugin-gone", rootDir: "/srv/plugins/alia-plugin-gone", statusDetail: "plugin directory not found: /srv/plugins/alia-plugin-gone (reinstall)" },
      { id: "billing", name: "Billing", status: "error", enabled: true, source: "git:github.com/acme/bb-plugin-billing@main", rootDir: "/cache/billing", statusDetail: "Build failed" },
      { id: "tags", name: "Tags", status: "disabled", enabled: false, source: "path:/srv/plugins/alia-plugin-tags", rootDir: "/srv/plugins/alia-plugin-tags", statusDetail: null },
    ];
    const p = sdkAlia({ plugins: { list: async () => ({ plugins }) } });
    expect(await p.plugins.list()).toEqual([
      { id: "mail", name: "Mail", state: "running", enabled: true, source: "path:/srv/plugins/alia-plugin-mail", rootDir: "/srv/plugins/alia-plugin-mail", error: null },
      { id: "gone", name: null, state: "missing", enabled: true, source: "path:/srv/plugins/alia-plugin-gone", rootDir: "/srv/plugins/alia-plugin-gone", error: "plugin directory not found: /srv/plugins/alia-plugin-gone (reinstall)" },
      { id: "billing", name: "Billing", state: "error", enabled: true, source: "git:github.com/acme/bb-plugin-billing@main", rootDir: "/cache/billing", error: "Build failed" },
      { id: "tags", name: "Tags", state: "disabled", enabled: false, source: "path:/srv/plugins/alia-plugin-tags", rootDir: "/srv/plugins/alia-plugin-tags", error: null },
    ]);
    await expect(sdkAlia({ plugins: { list: async () => ({}) } }).plugins.list()).rejects.toThrow();
  });

  test("enable and disable go to VesnALIA; an unknown plugin is VesnALIA's error", async () => {
    const enable = vi.fn(async ({ pluginId }: { pluginId: string }) => {
      if (pluginId === "nothere") throw new Error("HTTP 404: unknown plugin");
      return {};
    });
    const disable = vi.fn(async () => ({}));
    const p = sdkAlia({ plugins: { enable, disable } });
    await p.plugins.enable("mail");
    await p.plugins.disable("mail");
    expect(enable).toHaveBeenCalledWith({ pluginId: "mail" });
    expect(disable).toHaveBeenCalledWith({ pluginId: "mail" });
    await expect(p.plugins.enable("nothere")).rejects.toThrow("unknown plugin");
  });

  test("folders: alia-plugin-* directories under the plugins root, the name from the manifest when it reads", async () => {
    const root = tmp("plugins");
    put(root, "alia-plugin-a/package.json", JSON.stringify({ name: "alia-plugin-a", alia: { name: "Plugin A" } }));
    put(root, "alia-plugin-b/server.ts");
    put(root, "alia-plugin-c/package.json", "{ broken");
    put(root, "alia-plugin-file");
    put(root, ".workshop-new/w1/alia-plugin-d/package.json", "{}");
    put(root, "other/package.json", "{}");
    const p = sdkAlia({}, { pluginsRoot: root });
    expect((await p.plugins.folders()).sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: "a", dir: join(root, "alia-plugin-a"), name: "Plugin A" },
      { id: "b", dir: join(root, "alia-plugin-b"), name: null },
      { id: "c", dir: join(root, "alia-plugin-c"), name: null },
    ]);
  });
});

describe("sdkPorts: projects, tasks, snapshots, machine (fake VesnALIA)", () => {
  test("findByPath compares real paths", async () => {
    const real = tmp("proj");
    const link = join(tmp("link"), "l");
    symlinkSync(real, link);
    const list = vi.fn(async () => [
      { id: "p1", sources: [{ hostId: "h", path: link, type: "local_path", isDefault: true }] },
      { id: "p2", sources: [{ hostId: "other", path: real, type: "local_path", isDefault: true }] },
      { id: "p3", sources: [{ hostId: "h", path: "/nowhere/x", type: "local_path", isDefault: true }] },
      { id: "p4", sources: [{ hostId: "x", path: "/x", type: "local_path", isDefault: true }, { hostId: "h", path: `${real}/`, type: "local_path", isDefault: false }] },
    ]);
    const p = sdkAlia({ projects: { list } });
    expect(await p.projects.findByPath("h", real)).toEqual(["p1", "p4"]);
    expect(await p.projects.findByPath("h", link)).toEqual(["p1", "p4"]);
    expect(await p.projects.findByPath("h", "/nowhere/x")).toEqual(["p3"]);
    expect(await p.projects.findByPath("h", join(real, "missing"))).toEqual([]);
  });

  test("projects.create makes a project on the folder of the machine", async () => {
    const create = vi.fn(async () => ({ id: "proj_new", name: "Plugin · Hello", sources: [] }));
    const p = sdkAlia({ projects: { create } });
    expect(await p.projects.create({ name: "Plugin · Hello", dir: "/srv/plugins/alia-plugin-hello", hostId: "h" })).toBe("proj_new");
    expect(create).toHaveBeenCalledWith({ name: "Plugin · Hello", source: { type: "local_path", hostId: "h", path: "/srv/plugins/alia-plugin-hello" } });
  });

  test("findByMarker searches the tracker project, pages through, and keeps exact matches in the description only", async () => {
    const task = (id: string, key: string, description: string | null, status = "todo") => ({ id, key, projectId: "tp", title: `t ${key}`, description, status, number: 1 });
    const callRpc = vi.fn(async ({ method, input }: { method: string; input: { cursor?: string } }) => {
      if (method !== "listTasks") throw new Error(method);
      if (!input.cursor) return { tasks: [task("t1", "TEST-1", "request\n\n[workshop:w1]"), task("t2", "TEST-2", "see [workshop:w10]"), task("t4", "TEST-4", null)], nextCursor: "c2" };
      return { tasks: [task("t3", "TEST-3", "[workshop:w1]", "canceled")], nextCursor: null };
    });
    const p = sdkAlia({ plugins: { callRpc } });
    expect(await p.tasks.findByMarker("tp", "[workshop:w1]")).toEqual([
      { id: "t1", key: "TEST-1", projectId: "tp", title: "t TEST-1" },
      { id: "t3", key: "TEST-3", projectId: "tp", title: "t TEST-3" },
    ]);
    expect(callRpc.mock.calls.map((c) => [c[0].method, c[0].input])).toEqual([
      ["listTasks", { projectId: "tp", search: "[workshop:w1]", limit: 500 }],
      ["listTasks", { projectId: "tp", search: "[workshop:w1]", limit: 500, cursor: "c2" }],
    ]);
  });

  test("saveText writes into the snapshot folder of the work, readSaved finds it, a label or path out of it is refused", async () => {
    const dataDir = tmp("data");
    const p = sdkAlia({ system: { config: async () => ({ dataDir }) } });
    await p.saveText("w1", "1000-canceled", "staged.patch", "diff --git a b\n");
    expect(text(join(dataDir, "plugins", SELF_ID, "works/w1/1000-canceled"), "staged.patch")).toBe("diff --git a b\n");
    expect((await p.readSaved("w1", "staged.patch"))?.content).toBe("diff --git a b\n");
    await expect(p.saveText("w1", "../../x", "y", "z")).rejects.toThrow(/outside the work snapshots/);
    await expect(p.saveText("w1", "l", "../../x", "z")).rejects.toThrow(/outside the work snapshots/);
  });

  test("serverHostId is the primary host of VesnALIA", async () => {
    expect(await sdkAlia({ system: { config: async () => ({ primaryHostId: "host_server", dataDir: "/d" }) } }).serverHostId()).toBe("host_server");
    await expect(sdkAlia({ system: { config: async () => ({ primaryHostId: null, dataDir: "/d" }) } }).serverHostId()).rejects.toThrow();
  });
});

describe("sdkPorts.deps (real background process, fake npm)", () => {
  /** A fake npm: writes its own file into node_modules; `FAIL` in package.json makes it exit with an error. */
  function fakeNpm(root: string): string {
    const npm = join(root, "npm");
    writeFileSync(
      npm,
      '#!/bin/sh\necho "npm $*"\nif grep -q FAIL package.json; then echo "E404 yaml not found" >&2; exit 1; fi\nrm -rf node_modules && mkdir -p node_modules/yaml && echo ok > node_modules/yaml/index.js\n',
    );
    chmodSync(npm, 0o755);
    return npm;
  }
  function plugin(root: string, pkg: string, lock: string | null): string {
    const dir = join(root, "alia-plugin-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), pkg);
    if (lock !== null) writeFileSync(join(dir, "package-lock.json"), lock);
    return dir;
  }

  test("installs once, marks the lock file it installed, and needs it again after the lock file changes", { timeout: 20_000 }, async () => {
    const root = tmp("deps");
    const p = localPorts({ depsDir: join(root, "state"), npmBin: fakeNpm(root), locksDir: join(root, "locks", SELF_ID) });
    const dir = plugin(root, '{"name":"x"}', '{"lockfileVersion":3}');
    expect(await p.deps.state(dir)).toEqual({ kind: "need" });
    await p.deps.start(dir);
    await until(async () => (await p.deps.state(dir)).kind === "ok", 5000, "dependencies installed");
    expect(existsSync(join(dir, "node_modules", "yaml", "index.js"))).toBe(true);
    expect(text(join(root, "state"), "alia-plugin-x.log")).toContain("npm ci --ignore-scripts");
    writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3,"x":1}');
    expect(await p.deps.state(dir)).toEqual({ kind: "need" });
  });

  test("a failed npm is a failure with npm's words and the start time; without a lock file it installs without writing one", { timeout: 20_000 }, async () => {
    const root = tmp("deps");
    const p = localPorts({ depsDir: join(root, "state"), npmBin: fakeNpm(root), locksDir: join(root, "locks", SELF_ID) });
    const dir = plugin(root, '{"name":"FAIL"}', null);
    const before = Date.now();
    await p.deps.start(dir);
    await until(async () => (await p.deps.state(dir)).kind === "failed", 5000, "npm failed");
    const s = await p.deps.state(dir);
    expect(s).toMatchObject({ kind: "failed" });
    if (s.kind !== "failed") throw new Error("expected a failure");
    expect(s.text).toContain("npm exited with code 1");
    expect(s.text).toContain("E404 yaml not found");
    expect(s.startedAt).toBeGreaterThanOrEqual(before);
    expect(text(join(root, "state"), "alia-plugin-x.log")).toContain("npm install --ignore-scripts --no-audit --no-fund --no-package-lock");
    expect(existsSync(join(dir, "package-lock.json"))).toBe(false);
  });

  test("a plugin without package.json has nothing to install", async () => {
    const root = tmp("deps");
    const p = localPorts({ depsDir: join(root, "state"), npmBin: fakeNpm(root), locksDir: join(root, "locks", SELF_ID) });
    const dir = join(root, "alia-plugin-empty");
    mkdirSync(dir);
    expect(await p.deps.state(dir)).toEqual({ kind: "ok" });
  });
});

describe("sdkPorts worktree reads and work snapshots: links, findings, modes (real file system)", () => {
  /** A worktree on the VesnALIA server machine (`primaryHostId` = the environment's host) and a data folder; the host reads follow links, as a host would. */
  function rig(serverHost = "h") {
    const wt = tmp("wt");
    const dataDir = tmp("data");
    put(wt, "docs/a.md", "# a\n");
    put(wt, "docs/token.md", `key: ${SLACK_TOKEN}\n`);
    put(wt, "docs/keys.env", "PASSWORD=hunter2\n");
    put(wt, "other/x.md", "outside the folder\n");
    put(wt, ".env", `T=${OPENAI_KEY}\n`);
    symlinkSync("../.env", join(wt, "docs", "link.md"));
    symlinkSync("../other", join(wt, "docs", "dirlink"));
    const read = vi.fn(async ({ path }: { path: string }) => {
      const buf = readFileSync(path);
      return { content: buf.toString("utf8"), contentEncoding: "utf8", sizeBytes: buf.length, path, sha256: "x" };
    });
    const listPaths = vi.fn(async () => ({ paths: ["a.md", "token.md", "keys.env", "link.md"].map((p) => ({ path: p, name: p, kind: "file" })), truncated: false }));
    const p = sdkAlia({
      environments: { get: async () => ({ hostId: "h", path: wt }) },
      system: { config: async () => ({ primaryHostId: serverHost, dataDir }) },
      files: { read, listPaths },
    });
    return { p, wt, dataDir, read };
  }

  test("readRaw on the server machine refuses a symbolic link and a path through a linked folder; a plain file is read", async () => {
    const { p } = rig();
    expect((await p.readRaw("env", "docs/a.md"))?.content).toBe("# a\n");
    await expect(p.readRaw("env", "docs/link.md")).rejects.toBeInstanceOf(SymlinkRefused);
    await expect(p.readRaw("env", "docs/dirlink/x.md")).rejects.toBeInstanceOf(SymlinkRefused);
    expect(await p.readRaw("env", "docs/missing.md")).toBeNull();
  });

  test("on another machine there is no local check: the host's root confinement is all there is", async () => {
    const { p } = rig("another-host");
    expect((await p.readRaw("env", "docs/link.md"))?.content).toContain("T=");
  });

  test("saveArtifacts copies plain files only (0600 in 0700 folders) and returns what it withheld: key files, links, findings — labels, no values", async () => {
    const { p, dataDir } = rig();
    const r = await p.saveArtifacts("w1", "env", { dirs: ["docs"], files: [], mustExist: [] }, "100-s1-i1");
    expect(r.saved).toBe(1);
    expect(r.withheld).toEqual([
      { path: "docs/token.md", labels: ["xoxb-"] },
      { path: "docs/keys.env", labels: ["key file by name"] },
      { path: "docs/link.md", labels: ["symbolic link"] },
    ]);
    const snap = join(dataDir, "plugins", SELF_ID, "works", "w1", "100-s1-i1");
    expect(text(snap, "docs/a.md")).toBe("# a\n");
    for (const f of ["docs/token.md", "docs/keys.env", "docs/link.md"]) expect(existsSync(join(snap, f))).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SLACK_TOKEN);
    expect(statSync(join(snap, "docs/a.md")).mode & 0o777).toBe(0o600);
    expect(statSync(join(snap, "docs")).mode & 0o777).toBe(0o700);
    expect(statSync(snap).mode & 0o777).toBe(0o700);
  });

  test("saveText writes 0600 files; readSaved refuses a link planted in a snapshot instead of following it", async () => {
    const { p, dataDir } = rig();
    await p.saveText("w1", "200-canceled", "manifest.json", "{}\n");
    const snap = join(dataDir, "plugins", SELF_ID, "works", "w1", "200-canceled");
    expect(statSync(join(snap, "manifest.json")).mode & 0o777).toBe(0o600);
    const outside = join(tmp("outside"), "secret.txt");
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(snap, "planted.md"));
    expect(lstatSync(join(snap, "planted.md")).isSymbolicLink()).toBe(true);
    await expect(p.readSaved("w1", "planted.md")).rejects.toBeInstanceOf(SymlinkRefused);
    expect((await p.readSaved("w1", "manifest.json"))?.content).toBe("{}\n");
  });
});

describe("sdkPorts.github: what the publication gate reads and how it pushes (real git, a local bare repository)", () => {
  const G = ["-c", "user.name=Workshop Test", "-c", "user.email=test@example.invalid"];
  const commit = async (dir: string, msg: string) => {
    await git(dir, "add", "-A");
    await exec("git", ["-C", dir, ...G, "commit", "-q", "--allow-empty", "-m", msg]);
    return (await git(dir, "rev-parse", "HEAD")).trim();
  };
  /** main: A (published), then B, a side branch and a merge whose conflict resolution alone adds a token. */
  async function history() {
    const { dir, A } = await repo();
    const bare = tmp("bare");
    await exec("git", ["init", "-q", "--bare", bare]);
    await git(dir, "remote", "add", "origin", bare);
    await git(dir, "push", "-q", "origin", `${A}:refs/heads/main`);
    put(dir, "f.txt", "main side\n");
    const B = await commit(dir, "B");
    await git(dir, "checkout", "-q", "-b", "side", A);
    put(dir, "f.txt", "other side\n");
    await commit(dir, "side");
    await git(dir, "checkout", "-q", "main");
    await exec("git", ["-C", dir, ...G, "merge", "-q", "side"]).catch(() => undefined);
    put(dir, "f.txt", `resolved with ${OPENAI_KEY}\n`);
    const M = await commit(dir, "merge side");
    return { dir, bare, A, B, M };
  }
  const scanOf = async (p: ReturnType<typeof localPorts>, dir: string, sha: string, except: string[], max = 1024 * 1024) => {
    const scan = new LogScan();
    await p.github.logLines(dir, sha, except, max, (l) => scan.line(l));
    scan.end();
    return scan;
  };

  test("pushUrls: every push URL of origin; none — []; remoteHeads: the exact commits the destination has", async () => {
    const p = localPorts();
    const { dir, bare, A } = await history();
    expect(await p.github.pushUrls(dir)).toEqual([bare]);
    await git(dir, "remote", "set-url", "--add", "--push", "origin", "https://github.com/acme/one.git");
    await git(dir, "remote", "set-url", "--add", "--push", "origin", "https://github.com/acme/two.git");
    expect(await p.github.pushUrls(dir)).toEqual(["https://github.com/acme/one.git", "https://github.com/acme/two.git"]);
    expect(await p.github.pushUrls((await repo()).dir)).toEqual([]);
    expect(await p.github.remoteHeads(dir, bare)).toEqual([A]);
  });

  test("outgoing: what the destination lacks, merges included; an unknown destination commit is ignored, not an error", async () => {
    const p = localPorts();
    const { dir, A, B, M } = await history();
    const out = await p.github.outgoing(dir, M, [A, "0123456789012345678901234567890123456789"]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(M);
    expect(out).toContain(B);
    expect(out).not.toContain(A);
    expect(await p.github.outgoing(dir, M, [M])).toEqual([]);
    await expect(p.github.outgoing(dir, "0123456789012345678901234567890123456789", [])).rejects.toThrow(/not a commit/);
    await expect(p.github.outgoing(dir, M, ["--all"])).rejects.toThrow(/malformed/);
  });

  test("commitPaths: NUL-delimited — names with spaces, quotes and newlines come through whole; merges per parent; the root too", async () => {
    const p = localPorts();
    const { dir, A } = await repo();
    put(dir, "dir with space/prod.env", "X=1\n");
    put(dir, 'q"uote/id_rsa', "k\n");
    put(dir, "new\nline.key", "k\n");
    const c = await commit(dir, "odd names");
    expect([...(await p.github.commitPaths(dir, c))].sort()).toEqual(["dir with space/prod.env", "new\nline.key", 'q"uote/id_rsa'].sort());
    expect([...(await p.github.commitPaths(dir, A))].sort()).toEqual(["f.txt", "keep.txt"]);
    const { dir: d2, M } = await history();
    expect(await p.github.commitPaths(d2, M)).toEqual(["f.txt", "f.txt"]);
  });

  test("logLines + LogScan: a token only in a merge's conflict resolution, in binary content and in a message is found; config does not change the format", async () => {
    const p = localPorts();
    const { dir, A, M } = await history();
    // Settings that would change git's output if the port did not override them.
    for (const [k, v] of [["diff.noprefix", "true"], ["diff.suppressBlankEmpty", "true"], ["log.diffMerges", "first-parent"], ["color.ui", "always"], ["diff.external", "false"], ["diff.renames", "copies"], ["diff.submodule", "log"]])
      await git(dir, "config", k, v);
    let scan = await scanOf(p, dir, M, [A]);
    expect([...scan.findings]).toEqual(["f.txt: sk-"]);
    expect(scan.commits.has(M)).toBe(true);
    writeFileSync(join(dir, "blob.bin"), Buffer.concat([Buffer.from([0, 1, 2, 255, 10]), Buffer.from(`k=${GITHUB_TOKEN}`), Buffer.from([0, 10, 0])]));
    put(dir, "blank.txt", "one\n\n\nthree\n");
    const C = await commit(dir, `binary\n\nAuthorization: ${BEARER}`);
    put(dir, "blank.txt", "one\n\n\nfour\n");
    const D = await commit(dir, "edit next to empty lines");
    scan = await scanOf(p, dir, D, [M]);
    expect([...scan.findings].sort()).toEqual(["blob.bin: gh_token", "blob.bin: ghp_", `commit ${C.slice(0, 7)} message: Bearer`].sort());
    expect([...scan.commits].sort()).toEqual([C, D].sort());
  });

  test("logLines: more than the byte cap is a failure, not a shortened pass", async () => {
    const p = localPorts();
    const { dir, A, M } = await history();
    await expect(scanOf(p, dir, M, [A], 200)).rejects.toThrow(/of changes/);
  });

  test("the publication gate end to end over real git: a clean branch gets a clearance; the push refuses a changed URL and odd branches", async () => {
    const p = localPorts();
    const { dir, bare, A } = await history();
    await git(dir, "checkout", "-q", "-b", "work", A);
    put(dir, "ok.ts", `export const t = "ghp_${"FAKE".repeat(9)}";\n`);
    const W = await commit(dir, "work");
    // The destination check needs GitHub; here only it is stood in for — everything else is the real port.
    const github = { ...p.github, pushUrls: async () => ["https://github.com/acme/demo.git"], repoInfo: async () => ({ visibility: "PRIVATE", owner: "acme", nameWithOwner: "acme/demo" }), remoteHeads: () => p.github.remoteHeads(dir, bare) };
    const g = await publicationGate(github, dir, W, { owner: "acme", allowPublic: false });
    if (!g.ok) throw new Error(g.reason);
    expect(g.commits).toBe(1);
    // origin really pushes to the bare folder, not to the checked URL: refused, nothing sent.
    await expect(p.github.push(dir, g.clearance, "work")).rejects.toThrow(/push URL changed/);
    await expect(p.github.push(dir, g.clearance, "work")).rejects.toThrow(/no publication gate result/);
    expect(await git(bare, "branch", "--list")).not.toContain("work");
    const g2 = await publicationGate(github, dir, W, { owner: "acme", allowPublic: false });
    if (!g2.ok) throw new Error(g2.reason);
    await expect(p.github.push(dir, g2.clearance, "--force")).rejects.toThrow(/not a branch name/);
    // A key in the outgoing commit: no clearance at all.
    put(dir, "cfg.ts", `export const t = "${JWT}";\n`);
    const K = await commit(dir, "key");
    const refused = await publicationGate(github, dir, K, { owner: "acme", allowPublic: false });
    expect(refused).toMatchObject({ ok: false, kind: "secrets", findings: ["cfg.ts: jwt"] });
  });

  /** The destination check stood in for (it needs GitHub); the scan itself is the real port on the real repository. */
  const checked = (p: ReturnType<typeof localPorts>, dir: string, bare: string) => ({
    ...p.github,
    pushUrls: async () => ["https://github.com/acme/demo.git"],
    repoInfo: async () => ({ visibility: "PRIVATE", owner: "acme", nameWithOwner: "acme/demo" }),
    remoteHeads: () => p.github.remoteHeads(dir, bare),
  });
  const policy = { owner: "acme", allowPublic: false };

  test("a replacement object does not hide a key: a commit replaced by a clean one, and a blob replaced by a clean one, are scanned as stored", async () => {
    const p = localPorts();
    const { dir, bare, A } = await history();
    await git(dir, "checkout", "-q", "-b", "work", A);
    put(dir, "s.ts", `export const k = "${OPENAI_KEY}";\n`);
    const K = await commit(dir, "add config");
    // A clean commit with the same parent and message stands in for K; plain git now shows K without the key.
    const clean = (await exec("git", ["-C", dir, ...G, "commit-tree", `${A}^{tree}`, "-p", A, "-m", "add config"])).stdout.trim();
    await git(dir, "replace", K, clean);
    expect(await git(dir, "log", "-p", K, `^${A}`)).not.toContain(OPENAI_KEY);
    expect(await git(dir, "diff-tree", "-r", "--name-only", "--root", K)).not.toContain("s.ts");
    // The push sends the stored K; the scan reads the stored K.
    expect(await p.github.commitPaths(dir, K)).toEqual(["s.ts"]);
    expect(await publicationGate(checked(p, dir, bare), dir, K, policy)).toMatchObject({ ok: false, kind: "secrets", findings: ["s.ts: sk-"] });
    await git(dir, "replace", "-d", K);

    // The blob itself replaced by a clean one.
    const blob = (await git(dir, "rev-parse", `${K}:s.ts`)).trim();
    const cleanBlob = (await git(dir, "rev-parse", `${A}:keep.txt`)).trim();
    await git(dir, "replace", blob, cleanBlob);
    expect(await git(dir, "log", "-p", K, `^${A}`)).not.toContain(OPENAI_KEY);
    expect(await publicationGate(checked(p, dir, bare), dir, K, policy)).toMatchObject({ ok: false, kind: "secrets", findings: ["s.ts: sk-"] });
    // The cancel snapshot's reads do not follow replacements either.
    expect((await p.git.readBlobs(dir, [blob], 1024)).get(blob)!.toString()).toContain(OPENAI_KEY);
  });

  test("grafts do not hide a commit: the scan walks the real parents; a shallow clone is refused", async () => {
    const p = localPorts();
    const { dir, bare, A } = await history();
    await git(dir, "checkout", "-q", "-b", "work", A);
    put(dir, "s.ts", `export const k = "${OPENAI_KEY}";\n`);
    await commit(dir, "key");
    rmSync(join(dir, "s.ts"));
    const D = await commit(dir, "no key");
    // A graft makes A the parent of D: plain git no longer sees the key commit between them.
    writeFileSync(join(dir, ".git", "info", "grafts"), `${D} ${A}\n`);
    expect((await git(dir, "-c", "advice.graftFileDeprecated=false", "rev-list", D, `^${A}`)).trim()).toBe(D);
    expect(await p.github.outgoing(dir, D, [A])).toHaveLength(2);
    expect(await publicationGate(checked(p, dir, bare), dir, D, policy)).toMatchObject({ ok: false, kind: "secrets", findings: ["s.ts: sk-"] });
    rmSync(join(dir, ".git", "info", "grafts"));

    const shallow = tmp("shallow");
    rmSync(shallow, { recursive: true, force: true });
    await exec("git", ["clone", "-q", "--depth", "1", "--branch", "work", `file://${dir}`, shallow]);
    expect(await p.github.shallow(shallow)).toBe(true);
    expect(await p.github.shallow(dir)).toBe(false);
    const head = (await git(shallow, "rev-parse", "HEAD")).trim();
    expect(await publicationGate(checked(p, shallow, bare), shallow, head, policy)).toMatchObject({ ok: false, kind: "scan", reason: expect.stringContaining("shallow clone") });
  });

  test("deleteBranch removes a branch on the remote and refuses an option-like name", async () => {
    const p = localPorts();
    const { dir, bare, A } = await history();
    await git(dir, "push", "-q", "origin", `${A}:refs/heads/alia/old`);
    await p.github.deleteBranch(dir, "alia/old");
    expect(await git(bare, "branch", "--list")).not.toContain("alia/old");
    await expect(p.github.deleteBranch(dir, "-d")).rejects.toThrow(/not a branch name/);
  });
});

describe("sdkPorts.deps: a recorded pid is signalled only if it is still the install this plugin started", () => {
  test("an unrelated live process under the recorded pid is not killed: the install counts as gone", { timeout: 20_000 }, async () => {
    const root = tmp("deps");
    const depsDir = join(root, "state");
    const p = localPorts({ depsDir, npmBin: "/bin/false", locksDir: join(root, "locks", SELF_ID) });
    const dir = join(root, "alia-plugin-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}');
    const want = `lock:${createHash("sha256").update('{"lockfileVersion":3}').digest("hex")}`;
    const other = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    try {
      mkdirSync(depsDir, { recursive: true });
      // Older than the 20-minute limit: the old code would have sent SIGTERM to this process group.
      writeFileSync(join(depsDir, "alia-plugin-x.json"), JSON.stringify({ want, pid: other.pid, startedAt: Date.now() - 25 * 60_000 }));
      const s = await p.deps.state(dir);
      expect(s).toMatchObject({ kind: "failed" });
      if (s.kind === "failed") expect(s.text).toContain("the install process vanished");
      expect(() => process.kill(other.pid!, 0)).not.toThrow();
    } finally {
      other.kill("SIGKILL");
    }
  });

  test("the real install process is recognised while it runs", { timeout: 20_000 }, async () => {
    const root = tmp("deps");
    const npm = join(root, "npm");
    writeFileSync(npm, "#!/bin/sh\nsleep 2\nmkdir -p node_modules\n");
    chmodSync(npm, 0o755);
    const p = localPorts({ depsDir: join(root, "state"), npmBin: npm, locksDir: join(root, "locks", SELF_ID) });
    const dir = join(root, "alia-plugin-y");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{"name":"y"}');
    await p.deps.start(dir);
    expect(await p.deps.state(dir)).toEqual({ kind: "running" });
    await until(async () => (await p.deps.state(dir)).kind === "ok", 8000, "dependencies installed");
  });
});
