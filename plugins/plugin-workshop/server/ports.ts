import { posix } from "node:path";
import type { Clearance } from "./publish";

export type ThreadStatus = "active" | "error" | "idle" | "pending" | "starting" | "stopping" | "unknown";
export const BUSY: readonly ThreadStatus[] = ["active", "starting", "pending", "stopping"];

/** The work's machine does not answer: nothing is freed on it, and the card shows «machine unavailable». */
export class MachineUnavailable extends Error {
  override name = "MachineUnavailable";
}

/** The work's worktree is gone (VesnALIA removes it 5 minutes after the last thread is archived): there is nothing left to read from. */
export class WorktreeGone extends Error {
  override name = "WorktreeGone";
}

/** A symbolic link (or a path through one) in a worktree or a snapshot: it is not followed — not copied, not read for display. */
export class SymlinkRefused extends Error {
  override name = "SymlinkRefused";
}

/** A file left out of a snapshot or a copy, and why: finding labels or «key file by name» — never the value. */
export interface Withheld {
  path: string;
  labels: string[];
}

export type SpawnEnvironment = { kind: "new-worktree"; hostId: string } | { kind: "reuse"; environmentId: string };
export interface SpawnArgs {
  projectId: string;
  environment: SpawnEnvironment;
  providerId: string;
  model: string;
  /** Reasoning level; null or absent — the model's default. */
  reasoningLevel?: string | null;
  title: string;
  prompt: string;
  hidden: boolean;
  /** The thread's pluginMetadata. stage/role/who are for configure: it arrives before the thread's row is written. */
  metadata: { workId: string; opKey: string; stage: number; role: "stage" | "review" | "pilot"; who: string };
}
export interface TaskRef {
  id: string;
  key: string;
  projectId: string;
  title: string;
}
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "canceled";
export interface RawFile {
  content: string;
  encoding: "utf8" | "base64";
  mime: string;
  size: number;
}
/** Facts about the plugin's working copy (not the work's worktree). */
export type DepsState = { kind: "ok" } | { kind: "need" } | { kind: "running" } | { kind: "failed"; text: string; startedAt: number };

export interface GitFacts {
  hasGit: boolean;
  /** The branch the working copy is on; null — not git, or a detached HEAD. */
  branch: string | null;
  /** HEAD of the working copy; null — not git, or the repository has no commits. */
  head: string | null;
  /** Uncommitted changes; new (untracked) files count too. */
  dirtyCount: number;
}
/** The plugin's state in VesnALIA (`status` in `plugins.list`). VesnALIA reports `missing` on a load from scratch, not on `reload`. */
export type PluginState = "running" | "needs-configuration" | "degraded" | "error" | "incompatible" | "missing" | "disabled" | "starting";
/** An installed plugin (built-in `builtin:` plugins are not listed). */
export interface InstalledPlugin {
  id: string;
  /** null for `missing` (VesnALIA does not know the name until it has loaded the plugin). */
  name: string | null;
  state: PluginState;
  enabled: boolean;
  /** Install source as VesnALIA reports it: `path:<folder>`, `git:…`. */
  source: string;
  /** The folder VesnALIA builds the plugin from; null — VesnALIA did not report it. */
  rootDir: string | null;
  /** VesnALIA's `statusDetail`: why `error`, `degraded`, `needs-configuration`. */
  error: string | null;
}
export type JobState = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
/** The job is still running: the install is not finished, do not start a new job for the same source. */
export const JOB_RUNNING: readonly JobState[] = ["queued", "running", "cancelling"];
export interface InstallJob {
  id: string;
  /** The job's `target.source` as given by whoever started the install (`path:<folder>` or a bare path); null — not from a folder. Compare via `sourcePath`. */
  source: string | null;
  state: JobState;
  error: string | null;
}
/** Running install jobs from folder `dir` (both source forms, via `sourcePath`). */
export function runningJobsOf(jobs: InstallJob[], dir: string): InstallJob[] {
  return jobs.filter((j) => JOB_RUNNING.includes(j.state) && sourcePath(j.source) === dir);
}
/** Build lock: `held` — this generation's mark exists and its process is alive; `waiting` — this generation's holder is alive but does not have the lock yet. */
export type HolderState = "held" | "waiting" | "none";

/**
 * What `alia plugin new` puts into a scaffold (top level, VesnALIA 0.46.0). `node_modules` and `package-lock.json` appear last (`npm install`
 * runs at the end) — they tell a complete scaffold from an interrupted one. The scaffold creates neither `.git` nor `dist/`.
 */
export const SCAFFOLD_FILES: readonly string[] = [
  ".gitignore", "PLUGIN_OVERVIEW.md", "README.md", "app.tsx", "components", "components.json", "hooks", "lib",
  "node_modules", "package-lock.json", "package.json", "server.ts", "skills", "tsconfig.json",
];

/** The folder the plugin was installed from: `path:/x/y` and `/x/y/` are the same; not a path (`git:…`, `builtin:…`) — null. */
export function sourcePath(source: string | null): string | null {
  if (source === null) return null;
  const p = source.startsWith("path:") ? source.slice(5) : source;
  if (!p.startsWith("/")) return null;
  const n = posix.normalize(p).replace(/\/+$/, "");
  return n === "" ? "/" : n;
}

/**
 * Exclude pattern of `git.snapshotTree` and `git.changedFiles` — the same for both. Paths are relative, the separator is `/`.
 * `name/` — a folder at any depth (`node_modules/` matches `a/node_modules/y`); without a slash — by file name at any depth (`.env*`
 * matches `sub/.env.local` but not `.env-files/x.ts`); with a slash inside — a path from the root. `*` — any part of one name, it does not
 * cross `/`; there are no other special characters. Real git gets the same as a `:(exclude,glob)` pathspec.
 */
export function excludedBy(path: string, pattern: string): boolean {
  const glob = (p: string) => p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  if (pattern.endsWith("/")) return new RegExp(`(?:^|/)${glob(pattern.slice(0, -1))}/`).test(path);
  if (!pattern.includes("/")) return new RegExp(`(?:^|/)${glob(pattern)}$`).test(path);
  return new RegExp(`^${glob(pattern)}$`).test(path);
}

/** The index captured once (`git.stagedState`): what `staged.patch` is built from and what its content check reads. */
export interface StagedState {
  /** HEAD, or git's empty tree in a repository without commits. */
  base: string;
  /** `write-tree` of the captured index. */
  tree: string;
  /** Paths that differ between `base` and `tree`; `old`/`new` — blob ids, null where that side has no blob. */
  paths: Array<{ path: string; old: string | null; new: string | null }>;
}

/** What to save into a snapshot: whole folders and individual files (which may not exist yet). */
export interface Snapshot {
  dirs: string[];
  files: string[];
  /** Files without which the snapshot is incomplete (spec and plan, if the version has them). */
  mustExist: string[];
}

/** Everything the Engine does outside itself. In VesnALIA — sdkPorts, in tests — FakePorts. */
export interface Ports {
  now(): number;
  /**
   * Wait `ms`: short polling of an attempt's steps. An aborted `signal` returns at once, without an error (service stop, plugin unload).
   * In the fake it advances the fake's clock (`now`) without actually waiting.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  spawn(a: SpawnArgs): Promise<string>;
  /** The thread created with this retry key (pluginMetadata.opKey), not earlier than since. A lookup failure throws rather than returning null. */
  findThread(projectId: string, opKey: string, since: number): Promise<string | null>;
  /** Thread status; "unknown" — no such thread. A failed request throws. */
  status(threadId: string): Promise<ThreadStatus>;
  /** The thread's last-change stamp (`updatedAt`): it changes with every agent turn; null — no such thread. */
  threadStamp(threadId: string): Promise<number | null>;
  /** The thread agent's last answer (the result of its turn); null — no answer. */
  threadOutput(threadId: string): Promise<string | null>;
  environmentOf(threadId: string): Promise<{ environmentId: string; baseBranch: string | null } | null>;
  send(threadId: string, text: string): Promise<void>;
  stop(threadId: string): Promise<void>;
  archive(threadId: string): Promise<void>;
  /** HEAD and uncommitted changes of the worktree; MachineUnavailable — the machine does not answer. */
  head(environmentId: string): Promise<{ sha: string | null; dirty: boolean }>;
  /** Text of a worktree file by relative path; null — no such file. */
  read(environmentId: string, relPath: string): Promise<string | null>;
  /**
   * A worktree file as is (text or base64). On the VesnALIA server machine a symbolic link, or a path through one, throws `SymlinkRefused`: the
   * file endpoint and the snapshots never follow links. On another machine the host's root confinement is all there is.
   */
  readRaw(environmentId: string, relPath: string): Promise<RawFile | null>;
  /** Relative paths of files under relDir (recursive); [] — no such folder; too many — throws. */
  list(environmentId: string, relDir: string): Promise<string[]>;
  /** `.superpowers/.gitignore` = `*` — the work's working files and the SDD journal stay out of git. */
  ensureWorkDir(environmentId: string): Promise<void>;
  /** The environment's worktree folder on the VesnALIA server machine — for the cancel snapshot's git. WorktreeGone — removed; MachineUnavailable — the machine does not answer. */
  worktreeDir(environmentId: string): Promise<string>;
  /**
   * A snapshot into the plugin's data under a label (folders `0700`, files `0600`): the number of files saved and what was withheld — key files
   * by name, files whose content has a finding, symbolic links. An incomplete snapshot throws.
   */
  saveArtifacts(workId: string, environmentId: string, what: Snapshot, label: string): Promise<{ saved: number; withheld: Withheld[] }>;
  /** A file from the most recent snapshot that has it. */
  readSaved(workId: string, relPath: string): Promise<RawFile | null>;
  /** Relative paths of files under relDir in the most recent snapshot that has this folder. */
  listSaved(workId: string, relDir: string): Promise<string[]>;
  projectHost(projectId: string): Promise<string>;
  /** VesnALIA's navigation bar (UI preferences shared by all devices): the sections in order and the visible ones (null — everything is visible). */
  ui: {
    panels(): Promise<{ order: string[]; orderRevision: number; visible: string[] | null; visibleRevision: number }>;
    /** Write with the revision that was read: someone else's change between the read and the write throws instead of being overwritten. */
    setOrder(order: string[], expectedRevision: number): Promise<void>;
    setVisible(visible: string[], expectedRevision: number): Promise<void>;
  };
  tasks: {
    byKey(key: string): Promise<TaskRef | null>;
    linkedProject(aliaProjectId: string): Promise<string | null>;
    linkedAliaProject(tasksProjectId: string): Promise<string | null>;
    create(a: { tasksProjectId: string; title: string; description: string }): Promise<TaskRef>;
    setStatus(taskId: string, status: TaskStatus): Promise<void>;
    comment(taskId: string, body: string): Promise<void>;
    attach(taskId: string, threadId: string): Promise<void>;
    /** Tasks of the tracker project whose description contains the marker (exact substring, canceled ones too); empty — none. */
    findByMarker(tasksProjectId: string, marker: string): Promise<TaskRef[]>;
  };
  plugins: {
    /** Installed plugins, except built-in ones. A failure throws. */
    list(): Promise<InstalledPlugin[]>;
    /** Folders `<pluginsRoot>/alia-plugin-*`: id — what follows `alia-plugin-`; name — from the manifest, if readable. */
    folders(): Promise<Array<{ id: string; dir: string; name: string | null }>>;
    /** Start an install from a folder; returns the job id. While a job for the same source is running, VesnALIA returns that job. */
    startInstall(dir: string): Promise<string>;
    /** null — VesnALIA does not know this job (it keeps finished ones for ~10 minutes, and none survive a server restart). */
    job(id: string): Promise<InstallJob | null>;
    jobs(): Promise<InstallJob[]>;
    cancelJob(id: string): Promise<void>;
    /** A plugin that is not installed throws (`unknown plugin`). */
    enable(id: string): Promise<void>;
    disable(id: string): Promise<void>;
  };
  /**
   * Dependencies of the plugin's working copy: VesnALIA builds the plugin from it, while the implementer's `npm ci` ran in the worktree. They are
   * installed by a background process (under the build lock the attempt already holds); the outcome is kept in files, so a plugin restart does not disturb it.
   */
  deps: {
    /** ok — installed exactly per the lockfile (or nothing to install); need — must be installed; running — being installed; failed — the last install failed. */
    state(dir: string): Promise<DepsState>;
    /** Start the install (`npm ci --ignore-scripts`; without a lockfile — `npm install --no-package-lock`). */
    start(dir: string): Promise<void>;
  };
  lock: {
    /** A claim with the generation's token; an old mark is removed; a holder is started if no live holder of this generation exists. */
    request(attemptId: string, token: string): Promise<void>;
    /** held — this generation's mark exists and its process is alive; waiting — this generation's holder is alive; otherwise none. */
    state(attemptId: string, token: string): Promise<HolderState>;
    /** Remove the claim; the holder exits by itself. */
    release(attemptId: string): Promise<void>;
    /** Remove claims and marks of attempts not in keep. */
    sweep(keep: string[]): Promise<void>;
  };
  /** Git of the plugin's working copy (not the work's worktree). */
  git: {
    facts(dir: string): Promise<GitFacts>;
    isAncestor(dir: string, ancestor: string, descendant: string): Promise<boolean>;
    /** Paths of files changed between two commits (`git diff --name-only from to`); not a repository — throws. */
    diffNames(dir: string, from: string, to: string): Promise<string[]>;
    /** Text of the changes between commits (`git diff from to`), at most `max` characters; not a repository — throws. */
    diffText(dir: string, from: string, to: string, max: number): Promise<string>;
    /** Working files and index exactly as in sha, and no new files. */
    copyEquals(dir: string, sha: string): Promise<boolean>;
    /** `reset --keep`: branch and files to sha; if git refuses (changes are in the way, the index is locked…) — `refused` with its text, nothing changed. */
    resetKeep(dir: string, sha: string): Promise<"ok" | { refused: string }>;
    /** `git status --porcelain` lines of the working copy (modified and new, not ignored); not a repository — throws. */
    statusLines(dir: string): Promise<string[]>;
    /** Only in a verified interrupted state (a snapshot has been taken before it). */
    resetHard(dir: string, sha: string): Promise<void>;
    updateRef(dir: string, ref: string, sha: string): Promise<void>;
    /** The first (or next) commit in the folder; without git — `git init` on branch main. Returns the sha. */
    initCommit(dir: string, message: string): Promise<string>;
    /**
     * Commits the working tree (parent — HEAD) under `ref` and sets the ref itself; the real index is untouched. `exclude` — patterns
     * (`excludedBy`, at any depth), `skip` — files with a finding (exact paths). A tracked file under `exclude` or `skip` stays in the
     * commit in its HEAD version — it is already in history. `files` — the same as `changedFiles` with the same `exclude`, minus `skip`: one
     * procedure (a temporary index on top of HEAD), so the real index's flags (`skip-worktree`, `assume-unchanged`, `rm --cached`) do not hide files.
     * Nested repositories (untracked ones and submodules with a moved commit) are not taken — in the commit they are as in HEAD — and are
     * returned in `nested`; they are in neither `files` nor `changedFiles`.
     */
    snapshotTree(dir: string, ref: string, exclude: string[], skip: string[]): Promise<{ sha: string; files: string[]; nested: string[] }>;
    /**
     * The staged changes, captured once (`write-tree` of a copy of the index): `tree`, the `base` it is compared with (HEAD; the empty tree
     * without commits) and every path that differs, with the blob ids of both sides (null — none on that side: added, deleted, a submodule).
     * The patch and the content check are both built from this one state. Unmerged entries or not a repository — throws.
     */
    stagedState(dir: string): Promise<StagedState>;
    /** `diff --binary --full-index --no-renames <base> <tree>` of a captured state, exactly these paths (literal pathspecs); no paths — "". */
    stagedPatch(dir: string, base: string, tree: string, paths: string[]): Promise<string>;
    /** The raw bytes of these blobs by id (binary intact). A missing object, more than `maxBytes` in all, or a git failure throws. */
    readBlobs(dir: string, ids: string[], maxBytes: number): Promise<Map<string, Buffer>>;
    /**
     * Files that `snapshotTree` with the same `exclude` will put into the commit as changed against HEAD or new: modified, added to the
     * index and untracked. Not included: deleted, ignored by git, matched by `exclude`, and unchanged tracked files (they are already
     * in history). Relative paths; `exclude` patterns as in `excludedBy` (folder and file name — at any depth).
     * Writes nothing to the repository's object store: the content of not-yet-checked files never gets there.
     */
    changedFiles(dir: string, exclude: string[]): Promise<string[]>;
  };
  /**
   * GitHub of the plugin's working copy: GitHub is the source of truth. Local `git` and `gh` under the VesnALIA server's sign-in; never `--force`.
   * Content reaches GitHub only through `publish` (publish.ts): `push` takes a clearance issued by the publication gate.
   * Not a repository or no network — throws.
   */
  github: {
    /** The `origin` url, or null. */
    remote(dir: string): Promise<string | null>;
    /** Every push URL of `origin` (`git remote get-url --push --all origin`, insteadOf rules applied); [] — no origin. */
    pushUrls(dir: string): Promise<string[]>;
    /** The repository as GitHub reports it (`gh repo view --json visibility,owner,nameWithOwner`); null — no such repository or no access. */
    repoInfo(owner: string, name: string): Promise<{ visibility: string; owner: string; nameWithOwner: string } | null>;
    /** Repository `owner/name`: if it exists — its url; if not — it is created as private, with the description. Its visibility is never changed. */
    ensureRepo(owner: string, name: string, description: string): Promise<string>;
    /** `git remote add origin <url>`; an `origin` with a different url throws. */
    setRemote(dir: string, url: string): Promise<void>;
    /** `git fetch origin` (branches go to `refs/remotes/origin/*`). */
    fetch(dir: string): Promise<void>;
    /** Every commit the destination has under any ref (`git ls-remote <url>`): what a publication does not need to scan again. */
    remoteHeads(dir: string, url: string): Promise<string[]>;
    /** The working copy is a shallow clone (`rev-parse --is-shallow-repository`): its history is cut off, so a publication scan of it is refused. */
    shallow(dir: string): Promise<boolean>;
    /**
     * Commits reachable from `sha` and from none of `except` (`rev-list --ignore-missing`: an `except` commit unknown here is skipped).
     * `outgoing`, `commitPaths` and `logLines` read the stored objects and their real parents — no replacement objects, no grafts — the
     * graph a push sends.
     */
    outgoing(dir: string, sha: string, except: string[]): Promise<string[]>;
    /** Paths a commit changes against each of its parents (the root against the empty tree), NUL-delimited by git — no quoting. */
    commitPaths(dir: string, commit: string): Promise<string[]>;
    /**
     * `git log -p` of the same commits as `outgoing`, in `LOG_FORMAT`, every file as text, merges against each parent, line by line (latin1).
     * More than `maxBytes`, a git failure or a timeout throws; an exception from `onLine` stops it and is rethrown.
     */
    logLines(dir: string, sha: string, except: string[], maxBytes: number, onLine: (line: string) => void): Promise<void>;
    /** Exactly the cleared commit to `refs/heads/<branch>` of `origin`; without a valid clearance for this folder — throws, nothing is sent. */
    push(dir: string, clearance: Clearance, branch: string): Promise<void>;
    /** Deletes a branch on GitHub (`:refs/heads/<branch>`): carries no content. */
    deleteBranch(dir: string, branch: string): Promise<void>;
    /** sha of `refs/remotes/origin/<branch>` (as of the last fetch or push), or null. */
    remoteSha(dir: string, branch: string): Promise<string | null>;
    /** How many commits are only in `a` (ahead) and only in `b` (behind). */
    counts(dir: string, a: string, b: string): Promise<{ ahead: number; behind: number }>;
    /** `merge --ff-only <ref>` on the current branch; if it cannot fast-forward — throws with git's text. */
    ffOnly(dir: string, ref: string): Promise<void>;
    /** The branch's open PR into main in the checked repository `repo` (`owner/name`): if there is one — its url; if not — it is created. */
    openPr(dir: string, repo: string, branch: string, title: string, body: string): Promise<string>;
    /** The branch's PR is merged (GitHub marked it as merged). */
    prMerged(dir: string, branch: string): Promise<boolean>;
  };
  projects: {
    /** VesnALIA projects for this folder on this machine (by real path). */
    findByPath(hostId: string, dir: string): Promise<string[]>;
    create(a: { name: string; dir: string; hostId: string }): Promise<string>;
  };
  fs: {
    exists(p: string): Promise<boolean>;
    /** Throws if the source is missing, the target exists (including an empty folder: a bare `rename(2)` would silently replace it) or the target's folder is missing. The implementation checks this before the `rename` itself. */
    rename(from: string, to: string): Promise<void>;
    /** Like `rm -rf`: a missing path is not an error. */
    remove(p: string): Promise<void>;
    /** Names of the folder's entries (not recursive); no such folder — []. */
    list(dir: string): Promise<string[]>;
    freeDiskGb(p: string): Promise<number>;
    /**
     * Creates `<tmpDir>/alia-plugin-<id>/` (a nested folder, like `alia plugin new`) rather than filling `tmpDir` itself. The port creates `tmpDir`
     * too (`mkdir -p`): `Creation` does not call a separate command for it. The exit code of `alia plugin new` guarantees nothing (VesnALIA 0.46 returns 0
     * even when `npm install` failed), so `Creation` checks the nested folder for completeness against `SCAFFOLD_FILES`.
     */
    scaffold(id: string, tmpDir: string): Promise<void>;
  };
  /** A text file in the work's snapshot folder under a label. */
  saveText(workId: string, label: string, relPath: string, content: string): Promise<void>;
  /** VesnALIA's providers and their models with reasoning levels (as in the new-thread dialog). */
  modelCatalog(): Promise<Array<{ id: string; name: string; models: Array<{ id: string; label: string; efforts: string[]; defaultEffort: string | null }>; error: string | null }>>;
  /** The machine VesnALIA itself runs on: the plugin working copies live there. */
  serverHostId(): Promise<string>;
  /** A signal to the UI: the work has changed. */
  changed(workId: string): void;
}
