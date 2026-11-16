import { posix } from "node:path";
import {
  BUSY, excludedBy, JOB_RUNNING, MachineUnavailable, SCAFFOLD_FILES, sourcePath, SymlinkRefused, WorktreeGone,
  type DepsState, type GitFacts, type HolderState, type InstallJob, type InstalledPlugin, type JobState, type Ports, type RawFile, type Snapshot, type SpawnArgs, type StagedState, type TaskRef, type TaskStatus, type ThreadStatus, type Withheld,
} from "./ports";
import { takeClearance, type Clearance } from "./publish";
import { secretFileName, secretFindings } from "./secrets";
import { PLUGINS_ROOT, pluginDir } from "./stages";

/** External actions that can be made to fail (`failAt`): all of them go through `fx`. Any other name is a typo, not a failure. */
export const EFFECTS = [
  "scaffold", "rename", "initCommit", "projects.create", "tasks.create", "lock.request", "lock.release", "startInstall",
  "resetKeep", "resetHard", "enable", "disable", "updateRef", "snapshotTree",
  "github.ensureRepo", "github.setRemote", "github.fetch", "github.push", "github.deleteBranch", "github.ffOnly", "github.openPr",
] as const;

/** When an external action fails: `before` — before it (no effect happened), `after` — after it (the effect happened, the reply was lost). */
export type FailWhen = "before" | "after";
type FsPort = Ports["fs"];
type PluginsPort = Ports["plugins"];
type LockPort = Ports["lock"];
type GitPort = Ports["git"];
type ProjectsPort = Ports["projects"];
type GithubPort = Ports["github"];
/** One external action: the single point for failures, the call log and counters. */
type Fx = <T>(effect: string, args: unknown[], run: () => T | Promise<T>) => Promise<T>;

// --- file system ---

/** Folders and files in memory. A path is just an entry in a set: tests do not need to tell a folder from a file. */
class FakeFs implements FsPort {
  freeGb = 100;
  /** Paths on which `exists` throws (disk read failure). */
  failExists = new Set<string>();
  private nodes = new Set<string>(["/"]);
  constructor(private readonly fx: Fx) {
    this.put(PLUGINS_ROOT);
  }
  /** `mkdir -p` and `touch` at once: the path and all its ancestors. */
  put(p: string): void {
    let cur = "";
    for (const seg of p.split("/").filter(Boolean)) {
      cur += `/${seg}`;
      this.nodes.add(cur);
    }
  }
  /** Names of direct children; for the Workshop itself and the `plugins.folders` fake. */
  children(dir: string): string[] {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const names = new Set<string>();
    for (const n of this.nodes) if (n.startsWith(prefix) && n.length > prefix.length) names.add(n.slice(prefix.length).split("/")[0]!);
    return [...names];
  }
  async exists(p: string) {
    if (this.failExists.has(p)) throw new Error(`exists failed: ${p}`);
    return this.nodes.has(p);
  }
  /** Whether the path exists — for the fake itself (no read failures). */
  has(p: string): boolean {
    return this.nodes.has(p);
  }
  async rename(from: string, to: string) {
    return this.fx("rename", [from, to], () => {
      if (!this.nodes.has(from)) throw new Error(`rename ${from}: no such path`);
      if (this.nodes.has(to)) throw new Error(`rename ${to}: already exists`);
      if (!this.nodes.has(posix.dirname(to))) throw new Error(`rename ${to}: no such folder ${posix.dirname(to)}`);
      for (const n of [...this.nodes]) {
        if (n !== from && !n.startsWith(`${from}/`)) continue;
        this.nodes.delete(n);
        this.nodes.add(to + n.slice(from.length));
      }
    });
  }
  async remove(p: string) {
    for (const n of [...this.nodes]) if (n === p || n.startsWith(`${p}/`)) this.nodes.delete(n);
  }
  async list(dir: string) {
    return this.children(dir);
  }
  async freeDiskGb(_p: string) {
    return this.freeGb;
  }
  /** Like `bb plugin new <id>` with `cwd = tmpDir`: a nested `bb-plugin-<id>/` with all `SCAFFOLD_FILES`; nothing in `tmpDir` itself. */
  async scaffold(id: string, tmpDir: string) {
    return this.fx("scaffold", [id, tmpDir], () => {
      const dir = `${tmpDir}/bb-plugin-${id}`;
      this.put(dir);
      for (const f of SCAFFOLD_FILES) this.put(`${dir}/${f}`);
    });
  }
}

// --- plugins and install jobs ---

class FakePlugins implements PluginsPort {
  /** What `list()` returns; a test edits it directly or via `add`. */
  items = new Map<string, InstalledPlugin>();
  /** The plugin folder's name from the manifest (`folders().name`). */
  folderNames = new Map<string, string>();
  failList = false;
  failFolders = false;
  /** `jobs()` throws (the job list did not arrive). */
  failJobs = false;
  /** Ids of the jobs `cancelJob` was called on. */
  cancelled: string[] = [];
  private jobMap = new Map<string, InstallJob>();
  private seq = 0;
  private forced: string | null = null;
  constructor(private readonly fx: Fx, private readonly fs: FakeFs) {}

  /** An installed plugin; by default — from its own working copy, running. The folder is created. */
  add(p: { id: string } & Partial<InstalledPlugin>): InstalledPlugin {
    const full: InstalledPlugin = { name: p.id, state: "running", enabled: true, source: `path:${pluginDir(p.id)}`, rootDir: pluginDir(p.id), error: null, ...p };
    this.items.set(full.id, full);
    if (full.rootDir) this.fs.put(full.rootDir);
    return { ...full };
  }
  /** A job started by someone else (a manual `bb plugin install`) or already running. */
  addJob(j: { id: string; source: string | null; state: JobState; error?: string | null }): InstallJob {
    const job: InstallJob = { id: j.id, source: j.source, state: j.state, error: j.error ?? null };
    this.jobMap.set(job.id, job);
    return { ...job };
  }
  /** Advance a job. `succeeded` installs the plugin from the job's folder: a new one runs, a disabled one gets enabled (as bb does). */
  setJob(id: string, state: JobState, error?: string | null): void {
    const job = this.jobMap.get(id);
    if (!job) throw new Error(`no job ${id}`);
    job.state = state;
    job.error = error !== undefined ? error : state === "failed" ? "install failed" : null;
    if (state === "succeeded") this.applyInstall(job);
  }
  /** The next `startInstall` returns this id (bb returned an already running job). */
  startInstallReturns(jobId: string): void {
    this.forced = jobId;
  }
  /** The job is gone: bb keeps finished jobs for ~10 minutes, and after a server restart they are gone entirely (`job` → null, not in `jobs`). */
  forgetJob(id: string): void {
    this.jobMap.delete(id);
  }
  private applyInstall(job: InstallJob) {
    const dir = sourcePath(job.source);
    const id = dir ? /^bb-plugin-(.+)$/.exec(posix.basename(dir))?.[1] : undefined;
    if (!dir || !id) return;
    this.items.set(id, { id, name: this.items.get(id)?.name ?? id, state: "running", enabled: true, source: `path:${dir}`, rootDir: dir, error: null });
  }
  private known(id: string): InstalledPlugin {
    const p = this.items.get(id);
    if (!p) throw new Error("HTTP 404: unknown plugin");
    return p;
  }

  async list() {
    if (this.failList) throw new Error("plugins.list failed");
    return [...this.items.values()].map((p) => ({ ...p }));
  }
  async folders() {
    if (this.failFolders) throw new Error("plugins.folders failed");
    return this.fs
      .children(PLUGINS_ROOT)
      .filter((n) => n.startsWith("bb-plugin-"))
      .map((n) => {
        const id = n.slice("bb-plugin-".length);
        return { id, dir: `${PLUGINS_ROOT}/${n}`, name: this.folderNames.get(id) ?? null };
      });
  }
  /** As bb does: the same source string while the job is running — the same job; a different spelling — a new one, queued behind the running one. */
  async startInstall(dir: string) {
    return this.fx("startInstall", [dir], () => {
      if (this.forced !== null) {
        const id = this.forced;
        this.forced = null;
        return id;
      }
      const source = `path:${dir}`;
      const running = [...this.jobMap.values()].filter((j) => JOB_RUNNING.includes(j.state) && sourcePath(j.source) === sourcePath(source));
      const same = running.find((j) => j.source === source);
      if (same) return same.id;
      const job: InstallJob = { id: `job_${++this.seq}`, source, state: running.length > 0 ? "queued" : "running", error: null };
      this.jobMap.set(job.id, job);
      return job.id;
    });
  }
  async job(id: string) {
    const j = this.jobMap.get(id);
    return j ? { ...j } : null;
  }
  async jobs() {
    if (this.failJobs) throw new Error("installJobs.list failed");
    return [...this.jobMap.values()].map((j) => ({ ...j }));
  }
  /** A running job becomes `cancelling` (the test sets the outcome via `setJob`), a queued one is `cancelled` at once. */
  async cancelJob(id: string) {
    const j = this.jobMap.get(id);
    if (!j) throw new Error("HTTP 404: unknown install job");
    this.cancelled.push(id);
    if (j.state === "queued") j.state = "cancelled";
    else if (j.state === "running") j.state = "cancelling";
  }
  /** Enabling loads the plugin from scratch: no folder — `missing` without a name (as bb does), otherwise a disabled one runs again. */
  async enable(id: string) {
    return this.fx("enable", [id], () => {
      const p = this.known(id);
      p.enabled = true;
      if (p.rootDir !== null && !this.fs.has(p.rootDir)) Object.assign(p, { state: "missing", name: null, error: `plugin directory not found: ${p.rootDir} (reinstall)` });
      else if (p.state === "disabled") p.state = "running";
    });
  }
  async disable(id: string) {
    return this.fx("disable", [id], () => {
      const p = this.known(id);
      p.enabled = false;
      p.state = "disabled";
    });
  }
}

// --- build lock ---

interface Holder {
  id: string;
  token: string;
  alive: boolean;
  /** Holds the `flock` lock. */
  holding: boolean;
}
/**
 * Requests (`<id>.want`), marks (`<id>.held`) and holder processes. One lock for all attempts; a holder takes it in launch order,
 * holds it while the request of its generation is there, and exits when it is removed or replaced. Instant, without the real one's two-second delay.
 */
class FakeLock implements LockPort {
  private wants = new Map<string, string>();
  private marks = new Map<string, string>();
  private holders: Holder[] = [];
  private foreign = false;
  constructor(private readonly fx: Fx, private readonly bump: (effect: string) => void) {}

  /** Whether the attempt's request is there. */
  wantExists(attemptId: string): boolean {
    return this.wants.has(attemptId);
  }
  /** The holder died without cleanup (`kill -9`): the request and the mark stay, the lock is free. */
  kill(attemptId: string): void {
    for (const h of this.holders) if (h.alive && h.id === attemptId) Object.assign(h, { alive: false, holding: false });
    this.settle();
  }
  /** A foreign process holds the build lock (`flock build.lock sleep 30`). */
  occupy(on: boolean): void {
    this.foreign = on;
    this.settle();
  }
  private exit(h: Holder) {
    h.alive = false;
    if (h.holding) {
      h.holding = false;
      this.marks.delete(h.id);
    }
  }
  private settle() {
    for (const h of this.holders) if (h.alive && this.wants.get(h.id) !== h.token) this.exit(h);
    this.holders = this.holders.filter((h) => h.alive);
    if (this.foreign || this.holders.some((h) => h.holding)) return;
    const next = this.holders.find((h) => !h.holding);
    if (!next) return;
    next.holding = true;
    this.marks.set(next.id, next.token);
  }

  async request(attemptId: string, token: string) {
    return this.fx("lock.request", [attemptId, token], () => {
      this.wants.set(attemptId, token);
      if (this.marks.has(attemptId) && this.marks.get(attemptId) !== token) this.marks.delete(attemptId);
      this.settle();
      if (!this.holders.some((h) => h.id === attemptId && h.token === token)) {
        this.holders.push({ id: attemptId, token, alive: true, holding: false });
        this.bump("lock.spawnedHolders");
      }
      this.settle();
    });
  }
  async state(attemptId: string, token: string): Promise<HolderState> {
    const h = this.holders.find((x) => x.alive && x.id === attemptId && x.token === token);
    if (!h) return "none";
    return h.holding && this.marks.get(attemptId) === token ? "held" : "waiting";
  }
  async release(attemptId: string) {
    return this.fx("lock.release", [attemptId], () => {
      this.wants.delete(attemptId);
      this.settle();
    });
  }
  async sweep(keep: string[]) {
    for (const id of [...this.wants.keys()]) if (!keep.includes(id)) this.wants.delete(id);
    for (const id of [...this.marks.keys()]) if (!keep.includes(id)) this.marks.delete(id);
    this.settle();
  }
}

// --- working copy git ---

interface Repo {
  hasGit: boolean;
  branch: string | null;
  head: string | null;
  /** The commit whose content the working files and the index now have; null — a mix (equal to no commit). */
  tree: string | null;
  /** Changes beyond the `tree`/`head` difference: modified and new files. */
  edits: number;
  refs: Map<string, string>;
  /** `resetKeep` refuses with this git text; null — it goes through. */
  keepRefuses: string | null;
  /** `git status --porcelain` lines (`statusLines`). */
  status: string[];
  files: string[];
  /** Nested repositories of the working tree (not files): neither in `changedFiles` nor in the snapshot commit. */
  nested: string[];
  /** The staged diff (`diff --cached`): file blocks starting with `diff --git a/<path> b/<path>`. */
  stagedDiff: string;
  /** What the index holds for a staged path (path → bytes) when it is not the `+` lines of its diff block (binary content, a token the diff text does not show). */
  stagedBlobs: Record<string, string | Buffer>;
  /** What HEAD holds for a staged path (path → bytes); none — the path is new. */
  stagedOld: Record<string, string | Buffer>;
}
const blankRepo = (): Repo => ({
  hasGit: true, branch: "main", head: null, tree: null, edits: 0, refs: new Map(), keepRefuses: null, status: [], files: [], nested: [], stagedDiff: "", stagedBlobs: {}, stagedOld: {},
});
/** The file blocks of a diff by path (`diff --git a/<path> …`). */
function diffBlocks(diff: string): Array<{ path: string; text: string }> {
  return diff
    .split(/(?=^diff --git )/m)
    .filter((b) => b.startsWith("diff --git "))
    .map((text) => ({ path: /^diff --git a\/(\S+)/.exec(text)?.[1] ?? "?", text }));
}
/** The default `reset --keep` refusal text — as git prints it when a change blocks the move. */
const KEEP_REFUSED = "error: Entry 'f.txt' not uptodate. Cannot merge.\nfatal: Could not reset index file to revision.";
export interface RepoInit extends Partial<GitFacts> {
  tree?: string | null;
  /** `resetKeep` refuses: changes block the move (true — with the default git text, a string — with that text). */
  keepRefuses?: boolean | string;
  /** `git status --porcelain` lines for `statusLines`. */
  status?: string[];
  /** Modified and new working-tree files (not ignored by git) — for `changedFiles` and `snapshotTree`. */
  files?: string[];
  /** Nested repositories (folders with their own `.git`, submodules with a moved commit). */
  nested?: string[];
  stagedDiff?: string;
  stagedBlobs?: Record<string, string | Buffer>;
  stagedOld?: Record<string, string | Buffer>;
}

/**
 * Repositories in memory and a shared commit graph (shas are unique). An interrupted merge is a branch `updateRef` without `resetHard`:
 * HEAD on the new commit, files on the old one — `facts.dirtyCount > 0`, `copyEquals(old) === true`.
 */
class FakeGit implements GitPort {
  /** Folders on which `facts` throws. */
  failFacts = new Set<string>();
  private repos = new Map<string, Repo>();
  private parents = new Map<string, string | null>();
  private n = 0;
  constructor(private readonly fx: Fx) {}

  /** A fresh sha. */
  sha(): string {
    return `c0de${(++this.n).toString(16).padStart(36, "0")}`;
  }
  /** Record a commit's parent (the graph for `isAncestor`). */
  link(child: string, parent: string | null): void {
    this.parents.set(child, parent);
  }
  /** Create or adjust a repository; a new one is clean, on main, with one commit. */
  setRepo(dir: string, p: RepoInit): void {
    const created = !this.repos.has(dir);
    const r = this.repos.get(dir) ?? blankRepo();
    this.repos.set(dir, r);
    if (p.hasGit !== undefined) r.hasGit = p.hasGit;
    if ("branch" in p) r.branch = p.branch ?? null;
    if ("head" in p) {
      r.head = p.head ?? null;
      r.tree = r.head;
    } else if (created) {
      r.head = this.sha();
      r.tree = r.head;
      this.parents.set(r.head, null);
    }
    if ("tree" in p) r.tree = p.tree ?? null;
    if (p.dirtyCount !== undefined) r.edits = p.dirtyCount;
    if (p.keepRefuses !== undefined) r.keepRefuses = p.keepRefuses === true ? KEEP_REFUSED : p.keepRefuses === false ? null : p.keepRefuses;
    if (p.status) r.status = p.status;
    if (p.files) r.files = p.files;
    if (p.nested) r.nested = p.nested;
    if (p.stagedDiff !== undefined) r.stagedDiff = p.stagedDiff;
    if (p.stagedBlobs) r.stagedBlobs = p.stagedBlobs;
    if (p.stagedOld) r.stagedOld = p.stagedOld;
  }
  /** A new commit on top of HEAD (not a port action). `move: false` — HEAD and files stay, the commit is only created. */
  commit(dir: string, o: { move?: boolean } = {}): string {
    if (!this.repos.has(dir)) this.setRepo(dir, {});
    const r = this.repos.get(dir)!;
    const s = this.sha();
    this.parents.set(s, r.head);
    if (o.move !== false) {
      r.head = s;
      r.tree = s;
    }
    return s;
  }
  /** The ref's value; null — no such ref. */
  ref(dir: string, ref: string): string | null {
    return this.repos.get(dir)?.refs.get(ref) ?? null;
  }
  private need(dir: string): Repo {
    const r = this.repos.get(dir);
    if (!r || !r.hasGit) throw new Error(`git ${dir}: not a repository`);
    return r;
  }

  async facts(dir: string): Promise<GitFacts> {
    if (this.failFacts.has(dir)) throw new Error(`git facts failed: ${dir}`);
    const r = this.repos.get(dir);
    if (!r || !r.hasGit) return { hasGit: false, branch: null, head: null, dirtyCount: 0 };
    return { hasGit: true, branch: r.branch, head: r.head, dirtyCount: r.edits + (r.tree !== r.head ? 1 : 0) };
  }
  /** Changed files between commits: `${from}..${to}` → paths; no entry — nothing changed. */
  diffs = new Map<string, string[]>();
  async diffNames(_dir: string, from: string, to: string) {
    return this.diffs.get(`${from}..${to}`) ?? [];
  }
  /** Change text between commits: `${from}..${to}` → diff; no entry — empty. */
  patches = new Map<string, string>();
  async diffText(_dir: string, from: string, to: string, max: number) {
    return (this.patches.get(`${from}..${to}`) ?? "").slice(0, max);
  }
  async isAncestor(_dir: string, ancestor: string, descendant: string) {
    let cur: string | null | undefined = descendant;
    for (let i = 0; cur && i < 10_000; i++) {
      if (cur === ancestor) return true;
      cur = this.parents.get(cur);
    }
    return false;
  }
  async copyEquals(dir: string, sha: string) {
    const r = this.need(dir);
    return r.tree === sha && r.edits === 0;
  }
  async resetKeep(dir: string, sha: string) {
    return this.fx("resetKeep", [dir, sha], (): "ok" | { refused: string } => {
      const r = this.need(dir);
      if (r.keepRefuses !== null) return { refused: r.keepRefuses };
      r.head = sha;
      r.tree = sha;
      return "ok";
    });
  }
  async statusLines(dir: string) {
    return [...this.need(dir).status];
  }
  async resetHard(dir: string, sha: string) {
    return this.fx("resetHard", [dir, sha], () => {
      const r = this.need(dir);
      r.head = sha;
      r.tree = sha;
      r.edits = 0;
    });
  }
  async updateRef(dir: string, ref: string, sha: string) {
    return this.fx("updateRef", [dir, ref, sha], () => {
      const r = this.need(dir);
      r.refs.set(ref, sha);
      if (r.branch && ref === `refs/heads/${r.branch}`) r.head = sha;
    });
  }
  async initCommit(dir: string, message: string) {
    return this.fx("initCommit", [dir, message], () => {
      const r = this.repos.get(dir) ?? blankRepo();
      this.repos.set(dir, r);
      if (!r.hasGit) Object.assign(r, { hasGit: true, branch: "main" });
      const s = this.sha();
      this.parents.set(s, r.head);
      Object.assign(r, { head: s, tree: s, edits: 0 });
      return s;
    });
  }
  async snapshotTree(dir: string, ref: string, exclude: string[], skip: string[]) {
    return this.fx("snapshotTree", [dir, ref, exclude, skip], () => {
      const r = this.need(dir);
      const s = this.sha();
      this.parents.set(s, r.head);
      r.refs.set(ref, s);
      const kept = (f: string) => !exclude.some((p) => excludedBy(f, p));
      return { sha: s, files: r.files.filter((f) => !skip.includes(f) && kept(f)), nested: r.nested.filter(kept) };
    });
  }
  async changedFiles(dir: string, exclude: string[]) {
    return this.need(dir).files.filter((f) => !exclude.some((p) => excludedBy(f, p)));
  }
  /** A commit's parent in the graph (for FakeGithub counts). */
  parentOf(sha: string): string | null {
    return this.parents.get(sha) ?? null;
  }
  /** Fast-forward of the current branch (`merge --ff-only`): HEAD and files — to the sha. */
  moveHead(dir: string, sha: string): void {
    const r = this.need(dir);
    r.head = sha;
    r.tree = sha;
  }
  /** `stagedState` throws with this text (unmerged entries, a git failure). */
  stagedFails: string | null = null;
  /** `readBlobs` throws with this text (a missing object, too much content). */
  blobsFail: string | null = null;
  /**
   * The staged diff's file blocks as a captured state: blob ids `new:<dir>:<path>` (none for a deleted file) and `old:<dir>:<path>` (only
   * for paths in `stagedOld`); not a repository — an error.
   */
  async stagedState(dir: string): Promise<StagedState> {
    const r = this.need(dir);
    if (this.stagedFails) throw new Error(this.stagedFails);
    const paths = diffBlocks(r.stagedDiff).map((b) => ({
      path: b.path,
      old: r.stagedOld[b.path] !== undefined ? `old:${dir}:${b.path}` : null,
      new: /^deleted file mode/m.test(b.text) ? null : `new:${dir}:${b.path}`,
    }));
    return { base: r.head ?? "empty-tree", tree: `index-tree:${dir}`, paths };
  }
  /** Like `git diff <base> <tree> -- <paths>`: only the blocks of these paths; no paths — empty; not a repository — an error, not an empty diff. */
  async stagedPatch(dir: string, _base: string, _tree: string, paths: string[]) {
    const r = this.need(dir);
    if (paths.length === 0) return "";
    return diffBlocks(r.stagedDiff).filter((b) => paths.includes(b.path)).map((b) => b.text).join("");
  }
  /** The bytes behind `stagedState`'s ids: `stagedBlobs` (or the `+` lines of the block) for the index side, `stagedOld` for HEAD's side. */
  async readBlobs(dir: string, ids: string[], maxBytes: number) {
    const r = this.need(dir);
    if (this.blobsFail) throw new Error(this.blobsFail);
    const out = new Map<string, Buffer>();
    let total = 0;
    for (const id of new Set(ids)) {
      const m = /^(new|old):(.*):([^:]*)$/.exec(id);
      if (!m || m[2] !== dir) throw new Error(`git cat-file: object ${id} is missing`);
      const path = m[3]!;
      const block = diffBlocks(r.stagedDiff).find((b) => b.path === path);
      const plus = () => (block ? block.text.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++ ")).map((l) => `${l.slice(1)}\n`).join("") : undefined);
      const content = m[1] === "new" ? (r.stagedBlobs[path] ?? plus()) : r.stagedOld[path];
      if (content === undefined) throw new Error(`git cat-file: object ${id} is missing`);
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
      total += buf.length;
      if (total > maxBytes) throw new Error(`more than ${Math.round(maxBytes / 1024 / 1024)} MB`);
      out.set(id, buf);
    }
    return out;
  }
  /** Files a commit adds (path → content): its `git log -p` and its changed paths for the publication scan. */
  commitFiles = new Map<string, Record<string, string>>();
  /** A commit's message (for the publication scan); none — «commit». */
  commitMessages = new Map<string, string>();
  /** A commit's whole `git log -p` block as is, instead of one built from `commitFiles` (malformed output in tests). */
  commitLogs = new Map<string, string>();
  /** A commit's block of `git log` in `LOG_FORMAT`: header, message, then a new-file diff per added file. */
  logOf(sha: string): string {
    const raw = this.commitLogs.get(sha);
    if (raw !== undefined) return raw;
    const msg = this.commitMessages.get(sha) ?? "commit";
    const files = Object.entries(this.commitFiles.get(sha) ?? {});
    const diffs = files.map(([p, text]) => {
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      return [`diff --git a/${p} b/${p}`, "new file mode 100644", "--- /dev/null", `+++ b/${p}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n") + "\n";
    });
    return `\0commit ${sha}\n${msg}\n\0end\n${diffs.length > 0 ? `\n${diffs.join("")}` : ""}`;
  }
}

// --- GitHub ---

/**
 * GitHub in memory: repositories, folders' `origin` and branches on GitHub. Push is fast-forward only (by the FakeGit graph),
 * like git without `--force`; a refspec is `<sha>:refs/heads/<branch>` or a local branch name (the folder's HEAD is used if the branch is current).
 */
class FakeGithub implements GithubPort {
  repos = new Set<string>();
  remotes = new Map<string, string>();
  /** Push URLs of `origin` when they differ from its url (`pushurl`); none — the url itself. */
  pushUrlsOf = new Map<string, string[]>();
  /** What GitHub says about a repository (`owner/name`); null — not found; none — private, owned by the owner in its name. */
  repoInfos = new Map<string, { visibility: string; owner: string; nameWithOwner: string } | null>();
  /** Branches on GitHub: `${dir}#${branch}` → sha (after fetch they are visible locally as origin/<branch>). */
  branches = new Map<string, string>();
  prs: Array<{ dir: string; branch: string; title: string; body: string; url: string }> = [];
  /** `openPr` answers with this text instead of the PR address (what an odd `gh` output would be). */
  prAnswer: string | null = null;
  /** `logLines` fails with this text (git failed or was killed). */
  logFails: string | null = null;
  constructor(private readonly fx: Fx, private readonly git: FakeGit) {}
  /** A commit appeared on GitHub (someone pushed bypassing the Workshop). */
  setBranch(dir: string, branch: string, sha: string): void {
    this.branches.set(`${dir}#${branch}`, sha);
  }
  async remote(dir: string) {
    return this.remotes.get(dir) ?? null;
  }
  async pushUrls(dir: string) {
    const own = this.pushUrlsOf.get(dir);
    if (own) return [...own];
    const url = this.remotes.get(dir);
    return url ? [url] : [];
  }
  async repoInfo(owner: string, name: string) {
    const key = `${owner}/${name}`;
    const known = this.repoInfos.get(key);
    if (known !== undefined) return known ? { ...known } : null;
    return { visibility: "PRIVATE", owner, nameWithOwner: key };
  }
  async ensureRepo(owner: string, name: string, _description: string) {
    return this.fx("github.ensureRepo", [owner, name], () => {
      this.repos.add(`${owner}/${name}`);
      return `https://github.com/${owner}/${name}.git`;
    });
  }
  async setRemote(dir: string, url: string) {
    return this.fx("github.setRemote", [dir, url], () => {
      const now = this.remotes.get(dir);
      if (now !== undefined && now !== url) throw new Error(`${dir} already has a different origin: ${now}`);
      this.remotes.set(dir, url);
    });
  }
  async fetch(dir: string) {
    return this.fx("github.fetch", [dir], () => {
      if (!this.remotes.has(dir)) throw new Error(`git fetch in ${dir}: no origin`);
    });
  }
  async remoteHeads(dir: string, _url: string) {
    return [...this.branches].filter(([k]) => k.startsWith(`${dir}#`)).map(([, sha]) => sha);
  }
  private reach(from: string): string[] {
    const out: string[] = [];
    for (let cur: string | null = from; cur && !out.includes(cur) && out.length < 10_000; cur = this.git.parentOf(cur)) out.push(cur);
    return out;
  }
  /** Working copies that are shallow clones. */
  shallowDirs = new Set<string>();
  async shallow(dir: string) {
    return this.shallowDirs.has(dir);
  }
  /** Newest first, like `rev-list`: `sha` and its ancestors, minus everything reachable from `except`. */
  async outgoing(_dir: string, sha: string, except: string[]) {
    const known = new Set(except.flatMap((x) => this.reach(x)));
    return this.reach(sha).filter((c) => !known.has(c));
  }
  async commitPaths(_dir: string, commit: string) {
    return Object.keys(this.git.commitFiles.get(commit) ?? {});
  }
  async logLines(dir: string, sha: string, except: string[], maxBytes: number, onLine: (line: string) => void) {
    if (this.logFails) throw new Error(this.logFails);
    const text = (await this.outgoing(dir, sha, except)).map((c) => this.git.logOf(c)).join("");
    if (text.length > maxBytes) throw new Error(`more than ${Math.round(maxBytes / 1024 / 1024)} MB of changes`);
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const l of lines) onLine(l);
  }
  /** Fast-forward only (by the FakeGit graph), like git without `--force`; only with a clearance from the publication gate. */
  async push(dir: string, clearance: Clearance, branch: string) {
    return this.fx("github.push", [dir, [`${clearance.sha}:refs/heads/${branch}`]], async () => {
      if (!takeClearance(clearance, dir)) throw new Error("push: no publication gate result for this folder and commit — nothing is pushed");
      if (!this.remotes.has(dir)) throw new Error(`git push in ${dir}: no origin`);
      const was = this.branches.get(`${dir}#${branch}`);
      if (was && was !== clearance.sha && !(await this.git.isAncestor(dir, was, clearance.sha))) throw new Error(`git push in ${dir}: ! [rejected] ${branch} (non-fast-forward)`);
      this.branches.set(`${dir}#${branch}`, clearance.sha);
    });
  }
  async deleteBranch(dir: string, branch: string) {
    return this.fx("github.deleteBranch", [dir, branch], () => {
      if (!this.remotes.has(dir)) throw new Error(`git push in ${dir}: no origin`);
      if (!this.branches.has(`${dir}#${branch}`)) throw new Error(`git push in ${dir}: error: unable to delete '${branch}': remote ref does not exist`);
      this.branches.delete(`${dir}#${branch}`);
    });
  }
  async remoteSha(dir: string, branch: string) {
    return this.branches.get(`${dir}#${branch}`) ?? null;
  }
  async counts(dir: string, a: string, b: string) {
    const chain = async (sha: string) => {
      const out: string[] = [];
      for (let cur: string | null = sha; cur && out.length < 10_000; cur = this.git.parentOf(cur)) out.push(cur);
      return out;
    };
    const resolve = (r: string) => (r.startsWith("origin/") ? this.branches.get(`${dir}#${r.slice(7)}`) ?? null : r);
    const [x, y] = [resolve(a), resolve(b)];
    if (!x || !y) throw new Error(`git rev-list in ${dir}: unknown ref`);
    const [ca, cb] = [await chain(x), await chain(y)];
    return { ahead: ca.filter((s) => !cb.includes(s)).length, behind: cb.filter((s) => !ca.includes(s)).length };
  }
  async ffOnly(dir: string, ref: string) {
    return this.fx("github.ffOnly", [dir, ref], async () => {
      const to = ref.startsWith("origin/") ? this.branches.get(`${dir}#${ref.slice(7)}`) : ref;
      const head = (await this.git.facts(dir)).head;
      if (!to || !head || !(await this.git.isAncestor(dir, head, to))) throw new Error(`git merge --ff-only ${ref}: fatal: Not possible to fast-forward, aborting.`);
      this.git.moveHead(dir, to);
    });
  }
  /** Merged PRs (branches); the Workshop deletes a branch only after the merge. */
  merged = new Set<string>();
  async prMerged(dir: string, branch: string) {
    return this.merged.has(`${dir}#${branch}`);
  }
  async openPr(dir: string, repo: string, branch: string, title: string, body: string) {
    return this.fx("github.openPr", [dir, branch, title], () => {
      if (this.prAnswer !== null) return this.prAnswer;
      const open = this.prs.find((p) => p.dir === dir && p.branch === branch);
      if (open) return open.url;
      if (!this.branches.has(`${dir}#${branch}`)) throw new Error(`gh pr create: branch ${branch} is not on GitHub`);
      const url = `https://github.com/${repo}/pull/${this.prs.length + 1}`;
      this.prs.push({ dir, branch, title, body, url });
      return url;
    });
  }
}

// --- bb projects ---

class FakeProjects implements ProjectsPort {
  rows = new Map<string, { id: string; name: string; dir: string; hostId: string }>();
  private n = 0;
  constructor(private readonly fx: Fx) {}
  add(p: { id: string; name: string; dir: string; hostId: string }): void {
    this.rows.set(p.id, p);
  }
  async findByPath(hostId: string, dir: string) {
    return [...this.rows.values()].filter((p) => p.hostId === hostId && p.dir === dir).map((p) => p.id);
  }
  async create(a: { name: string; dir: string; hostId: string }) {
    return this.fx("projects.create", [a], () => {
      const id = `proj_${++this.n}`;
      this.rows.set(id, { id, ...a });
      return id;
    });
  }
}

interface FakeThread extends SpawnArgs {
  status: ThreadStatus;
  env: string;
  createdAt: number;
  /** Change stamp: grows with every message and every end of turn. */
  stamp: number;
  /** The agent's last reply (`threadOutput`). */
  output: string | null;
}

/** The environment's worktree folder in the fake; a new worktree is a git repository right away (`git`) with one commit on main. */
export const worktreeDirOf = (env: string) => `/wt/${env}`;

/** Memory instead of bb: threads, worktree files, snapshots, tracker tasks. */
export class FakePorts implements Ports {
  /** Log of performed external actions (effects) in order. A "before" failure is not in it: the action did not happen. */
  readonly calls: Array<{ effect: string; args: unknown[] }> = [];
  /** `failAt` failures that fired, in order: a recovery test checks that the failure really happened rather than being missed. */
  readonly tripped: Array<{ effect: string; when: FailWhen }> = [];
  private readonly counts = new Map<string, number>();
  private failure: { effect: string; when: FailWhen } | null = null;
  /**
   * Effect: `scaffold`, `rename`, `initCommit`, `projects.create`, `tasks.create`, `lock.request`, `lock.release`, `startInstall`,
   * `resetKeep`, `resetHard`, `enable`, `disable`, `updateRef`, `snapshotTree`. `before` throws before the action, `after` — after it.
   * The failure stays until `failAt(null)` clears it.
   */
  failAt(effect: string | null, when: FailWhen = "before"): void {
    // A typo in the name would make a recovery test vacuous: the failure would never fire.
    if (effect !== null && !(EFFECTS as readonly string[]).includes(effect)) throw new Error(`failAt: unknown effect «${effect}»; known: ${EFFECTS.join(", ")}`);
    this.failure = effect === null ? null : { effect, when };
  }
  /** How many times the effect ran (including with an "after" failure). `lock.spawnedHolders` — how many lock holders were launched. */
  count(effect: string): number {
    return this.counts.get(effect) ?? 0;
  }
  private bump = (effect: string) => void this.counts.set(effect, this.count(effect) + 1);
  private readonly fx: Fx = async (effect, args, run) => {
    if (this.failure?.effect === effect && this.failure.when === "before") {
      this.tripped.push({ effect, when: "before" });
      throw new Error(`failure before ${effect}`);
    }
    const result = await run();
    this.calls.push({ effect, args });
    this.bump(effect);
    if (this.failure?.effect === effect && this.failure.when === "after") {
      this.tripped.push({ effect, when: "after" });
      throw new Error(`failure after ${effect}`);
    }
    return result;
  };
  readonly fs = new FakeFs(this.fx);
  readonly plugins = new FakePlugins(this.fx, this.fs);
  readonly lock = new FakeLock(this.fx, this.bump);
  readonly git = new FakeGit(this.fx);
  readonly github = new FakeGithub(this.fx, this.git);
  readonly projects = new FakeProjects(this.fx);
  /** The machine bb runs on. */
  serverHost = "host_1";
  /** bb providers and models; `catalogFails` — the list did not arrive. */
  catalog = [
    { id: "claude-code", name: "Claude Code", models: [
      { id: "claude-opus-5-5", label: "Opus 5.5", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "high" },
      { id: "claude-fable-5-1", label: "Fable 5.1", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "high" },
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5", efforts: ["low", "medium", "high"], defaultEffort: "medium" },
    ], error: null as string | null },
    { id: "codex", name: "Codex", models: [{ id: "gpt-6-astra", label: "GPT-6-Astra", efforts: ["low", "medium", "high"], defaultEffort: "medium" }], error: null as string | null },
  ];
  catalogFails = false;
  async modelCatalog() {
    if (this.catalogFails) throw new Error("providers.list failed");
    return this.catalog;
  }
  /** What was saved via `saveText`. */
  texts: Array<{ workId: string; label: string; relPath: string; content: string }> = [];
  t = 1_000_000;
  threads = new Map<string, FakeThread>();
  sent: Array<{ threadId: string; text: string }> = [];
  stopped: string[] = [];
  archived: string[] = [];
  files = new Map<string, string>();
  heads = new Map<string, string>();
  dirty = new Set<string>();
  machineDown = false;
  /** Environments whose worktree bb has already removed. */
  gone = new Set<string>();
  spawnFails = false;
  /** The thread was created, but the call returned an error (reply timeout). */
  spawnThenThrow = false;
  /** The number of the spawn call that fails (1 — the first); 0 — none. */
  failSpawnNumber = 0;
  /** How many of the next findThread calls fail. */
  findFails = 0;
  /** How many of the next findThread calls miss a fresh thread (it shows up later). */
  findMisses = 0;
  saveFails = false;
  /** Files that "vanish" at the moment of the snapshot. */
  vanishOnSave = new Set<string>();
  archiveFails = false;
  /** Threads whose status request fails (a transient SDK failure). */
  statusFails = new Set<string>();
  /** How many of the next sends fail. */
  sendFails = 0;
  saved: Array<{ workId: string; env: string; label: string; what: Snapshot }> = [];
  savedFiles = new Map<string, string>();
  taskRows = new Map<string, TaskRef & { description: string; status: TaskStatus; comments: string[]; threads: string[] }>();
  /** tasksProjectId → bbProjectId */
  links = new Map<string, string>([["tp1", "p1"]]);
  changes: string[] = [];
  /** Total time waited via `sleep`: the fake's clock moved ahead by as much. */
  slept = 0;
  private timers: Array<{ at: number; run: () => void }> = [];
  private n = 0;
  private spawnCalls = 0;

  now() {
    return this.t;
  }
  /** Run `run` when the fake's clock reaches "now + ms" (`sleep` moves it): bb finished a job, the lock became free. */
  after(ms: number, run: () => void): void {
    this.timers.push({ at: this.t + ms, run });
  }
  async sleep(ms: number, signal?: AbortSignal) {
    if (signal?.aborted) return;
    this.slept += ms;
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t);
    this.timers = this.timers.filter((x) => x.at > this.t);
    for (const x of due) x.run();
  }
  async spawn(a: SpawnArgs) {
    this.spawnCalls++;
    if (this.spawnFails || this.spawnCalls === this.failSpawnNumber) throw new Error("spawn failed");
    const id = `thr_${++this.n}`;
    const env = a.environment.kind === "reuse" ? a.environment.environmentId : `env_${this.n}`;
    // The work worktree is on its own branch, as with bb (`bb/<…>`), not on main.
    if (a.environment.kind === "new-worktree") this.git.setRepo(worktreeDirOf(env), { branch: `bb/${env}` });
    this.threads.set(id, { ...a, status: "active", env, createdAt: this.t, stamp: ++this.stampSeq, output: null });
    if (this.spawnThenThrow) throw new Error("timeout after create");
    return id;
  }
  async findThread(projectId: string, opKey: string, since: number) {
    if (this.findFails > 0) {
      this.findFails--;
      throw new Error("threads.list failed");
    }
    if (this.findMisses > 0) {
      this.findMisses--;
      return null;
    }
    for (const [id, th] of this.threads) if (th.projectId === projectId && th.metadata.opKey === opKey && th.createdAt >= since) return id;
    return null;
  }
  async status(threadId: string) {
    if (this.statusFails.has(threadId)) throw new Error("threads.get failed");
    return this.threads.get(threadId)?.status ?? "unknown";
  }
  private stampSeq = 0;
  async threadStamp(threadId: string) {
    return this.threads.get(threadId)?.stamp ?? null;
  }
  async threadOutput(threadId: string) {
    return this.threads.get(threadId)?.output ?? null;
  }
  async environmentOf(threadId: string) {
    const th = this.threads.get(threadId);
    return th ? { environmentId: th.env, baseBranch: "main" } : null;
  }
  async send(threadId: string, text: string) {
    if (this.sendFails > 0) {
      this.sendFails--;
      throw new Error("send failed");
    }
    this.sent.push({ threadId, text });
    const th = this.threads.get(threadId);
    if (th) {
      th.status = "active";
      th.stamp = ++this.stampSeq;
    }
  }
  async stop(threadId: string) {
    this.stopped.push(threadId);
    const th = this.threads.get(threadId);
    if (th && BUSY.includes(th.status)) th.status = "idle";
  }
  async archive(threadId: string) {
    if (this.archiveFails) throw new Error("archive failed");
    this.archived.push(threadId);
  }
  private down(env: string) {
    if (this.machineDown) throw new MachineUnavailable("machine not responding");
    if (this.gone.has(env)) throw new WorktreeGone(`worktree unavailable (path_not_found): ${env}`);
  }
  async head(env: string) {
    this.down(env);
    return { sha: this.heads.get(env) ?? null, dirty: this.dirty.has(env) };
  }
  async read(env: string, rel: string) {
    this.down(env);
    return this.files.get(`${env}:${rel}`) ?? null;
  }
  /** Worktree files that are symbolic links (`${env}:${rel}`): `readRaw` refuses them, as the real port does on the server machine. */
  symlinks = new Set<string>();
  async readRaw(env: string, rel: string): Promise<RawFile | null> {
    if (this.symlinks.has(`${env}:${rel}`)) throw new SymlinkRefused(`${rel}: a symbolic link or a path through one — not followed`);
    const text = await this.read(env, rel);
    return text === null ? null : { content: text, encoding: "utf8", mime: "text/markdown", size: text.length };
  }
  async list(env: string, relDir: string) {
    this.down(env);
    const prefix = `${env}:${relDir}/`;
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(env.length + 1));
  }
  async worktreeDir(env: string) {
    this.down(env);
    return worktreeDirOf(env);
  }
  async ensureWorkDir(env: string) {
    this.files.set(`${env}:.superpowers/.gitignore`, "*\n");
  }
  /** Like the real port: key files by name, symbolic links and files with a content finding are withheld (listed), not copied. */
  async saveArtifacts(workId: string, env: string, what: Snapshot, label: string) {
    this.down(env);
    if (this.saveFails) throw new Error("disk full");
    let n = 0;
    const withheld: Withheld[] = [];
    const rels = [...new Set([...what.files, ...(await Promise.all(what.dirs.map((d) => this.list(env, d)))).flat()])];
    for (const rel of rels) {
      if (secretFileName(rel)) {
        withheld.push({ path: rel, labels: ["key file by name"] });
        continue;
      }
      if (this.symlinks.has(`${env}:${rel}`)) {
        withheld.push({ path: rel, labels: ["symbolic link"] });
        continue;
      }
      const text = this.vanishOnSave.has(rel) ? undefined : this.files.get(`${env}:${rel}`);
      if (text === undefined && what.mustExist.includes(rel)) throw new Error(`${rel}: file disappeared during the snapshot`);
      if (text === undefined) continue;
      const found = secretFindings(text);
      if (found.length > 0) {
        withheld.push({ path: rel, labels: found });
        continue;
      }
      this.savedFiles.set(`${workId}:${rel}`, text);
      n++;
    }
    this.saved.push({ workId, env, label, what });
    return { saved: n, withheld };
  }
  async readSaved(workId: string, rel: string): Promise<RawFile | null> {
    const text = this.savedFiles.get(`${workId}:${rel}`);
    return text === undefined ? null : { content: text, encoding: "utf8", mime: "text/markdown", size: text.length };
  }
  async listSaved(workId: string, relDir: string) {
    const prefix = `${workId}:${relDir}/`;
    return [...this.savedFiles.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(workId.length + 1));
  }
  async projectHost() {
    return this.serverHost;
  }
  /** Working copy dependencies: no entry — "in place". `start` sets "installing"; the test sets the outcome itself. */
  depsStates = new Map<string, DepsState>();
  depsStarts: string[] = [];
  deps = {
    state: async (dir: string): Promise<DepsState> => this.depsStates.get(dir) ?? { kind: "ok" },
    start: async (dir: string) => {
      this.depsStarts.push(dir);
      this.depsStates.set(dir, { kind: "running" });
    },
  };
  /** The navigation bar — bb UI preferences; the revision grows with every write. */
  panels = { order: [] as string[], orderRevision: 0, visible: null as string[] | null, visibleRevision: 0 };
  uiFails = false;
  ui = {
    panels: async () => {
      if (this.uiFails) throw new Error("uiPreferences.list failed");
      return { ...this.panels, order: [...this.panels.order], visible: this.panels.visible ? [...this.panels.visible] : null };
    },
    setOrder: async (order: string[], expectedRevision: number) => {
      if (expectedRevision !== this.panels.orderRevision) throw new Error("revision conflict");
      this.panels = { ...this.panels, order: [...order], orderRevision: this.panels.orderRevision + 1 };
    },
    setVisible: async (visible: string[], expectedRevision: number) => {
      if (expectedRevision !== this.panels.visibleRevision) throw new Error("revision conflict");
      this.panels = { ...this.panels, visible: [...visible], visibleRevision: this.panels.visibleRevision + 1 };
    },
  };
  async serverHostId() {
    return this.serverHost;
  }
  async saveText(workId: string, label: string, relPath: string, content: string) {
    if (this.saveFails) throw new Error("disk full");
    this.texts.push({ workId, label, relPath, content });
    this.savedFiles.set(`${workId}:${relPath}`, content);
  }
  tasks = {
    byKey: async (key: string) => [...this.taskRows.values()].find((t) => t.key === key) ?? null,
    linkedProject: async (bbProjectId: string) => [...this.links].find(([, p]) => p === bbProjectId)?.[0] ?? null,
    linkedBbProject: async (tasksProjectId: string) => this.links.get(tasksProjectId) ?? null,
    create: (a: { tasksProjectId: string; title: string; description: string }) =>
      this.fx("tasks.create", [a], () => {
        const key = `TEST-${this.taskRows.size + 1}`;
        const row = { id: `task_${key}`, key, projectId: a.tasksProjectId, title: a.title, description: a.description, status: "todo" as TaskStatus, comments: [] as string[], threads: [] as string[] };
        this.taskRows.set(row.id, row);
        return { id: row.id, key, projectId: row.projectId, title: row.title };
      }),
    findByMarker: async (tasksProjectId: string, marker: string) =>
      [...this.taskRows.values()].filter((t) => t.projectId === tasksProjectId && t.description.includes(marker)).map((t) => ({ id: t.id, key: t.key, projectId: t.projectId, title: t.title })),
    setStatus: async (taskId: string, status: TaskStatus) => {
      this.taskRows.get(taskId)!.status = status;
    },
    comment: async (taskId: string, body: string) => {
      this.taskRows.get(taskId)!.comments.push(body);
    },
    attach: async (taskId: string, threadId: string) => {
      this.taskRows.get(taskId)!.threads.push(threadId);
    },
  };
  changed(workId: string) {
    this.changes.push(workId);
  }
  /** The thread finished its turn; the clock moves a minute ahead — past the "just created" window. */
  idle(threadId: string, output?: string) {
    const th = this.threads.get(threadId)!;
    th.status = "idle";
    th.stamp = ++this.stampSeq;
    if (output !== undefined) th.output = output;
    this.t += 60_000;
  }
}
