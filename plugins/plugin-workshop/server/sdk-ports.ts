import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { basename, dirname, extname, join, posix, resolve, sep } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  MachineUnavailable, sourcePath, SymlinkRefused, WorktreeGone,
  type GitFacts, type HolderState, type InstallJob, type InstalledPlugin, type Ports, type RawFile, type TaskRef, type TaskStatus, type ThreadStatus, type Withheld,
} from "./ports";
import { githubRepo, LOG_FORMAT, takeClearance } from "./publish";
import { redact, secretFileName, secretFindings } from "./secrets";
import { MAIN_BRANCH } from "./gates";
import { BUILD_LOCK } from "./rules";
import { PLUGINS_ROOT, SELF_ID } from "./stages";

// Live bb error texts: missing file — «HTTP 404: Path does not exist: …», missing thread — «HTTP 404: Thread not found».
/** No such thread. Only for thread requests: «Host not found» would match here too. */
const NOT_FOUND = /not.?found|ENOENT|no such file|does not exist/i;
/** No such file or folder on the machine. Narrow on purpose: «HTTP 404: Host not found» is not "no such file". */
const PATH_MISSING = /Path does not exist|ENOENT|no such file/i;
/** Machine offline. Live text: «HTTP 502: Host is not connected» (caught by `not connected`); the other alternatives are just in case — extend them from `host call failed` log entries. */
const OFFLINE = /offline|not connected|disconnected|unreachable|daemon|timed? ?out|ECONNREFUSED|host.*unavailable/i;
/**
 * No environment, or it is not ready. bb: «HTTP 409: Environment unavailable» — the status is not ready (still being created or already removed),
 * «HTTP 404: Environment not found»; the machine daemon: `unknown environment`.
 */
const ENV_GONE = /Environment unavailable|unknown environment|Environment not found/i;
const MAX_COPY_BYTES = 25 * 1024 * 1024;
const TEXT_EXT = new Set([".md", ".txt", ".json", ".log", ".ts", ".tsx", ".js", ".html", ".css", ".yml", ".yaml", ".patch", ".diff"]);
const MIME: Record<string, string> = { ".md": "text/markdown", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json" };
const THREAD_STATUSES: readonly string[] = ["active", "error", "idle", "pending", "starting", "stopping"];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const taskShape = z.looseObject({ id: z.string(), key: z.string(), projectId: z.string(), title: z.string(), status: z.string() });
const taskMutationOut = z.union([z.looseObject({ ok: z.literal(true), task: taskShape }), z.looseObject({ ok: z.literal(false), error: z.unknown() })]);
const taskByKeyOut = z.looseObject({ task: taskShape.nullable() });
const listProjectsOut = z.looseObject({ projects: z.array(z.looseObject({ id: z.string(), linkedBbProjectId: z.string().nullable() })) });
/** The tracker's `listTasks`: the result includes the description; paging is by `nextCursor`. */
const listTasksOut = z.looseObject({ tasks: z.array(taskShape.extend({ description: z.string().nullable().optional() })), nextCursor: z.string().nullable().optional() });
const anyOut = z.unknown();

// --- bb responses about plugins, install jobs and projects: schemas at the boundary ---

const PLUGIN_STATES = ["running", "needs-configuration", "degraded", "error", "incompatible", "missing", "disabled", "starting"] as const;
const pluginListOut = z.looseObject({
  plugins: z.array(
    z.looseObject({
      id: z.string(), name: z.string().nullable().optional(), status: z.enum(PLUGIN_STATES), enabled: z.boolean(), source: z.string(),
      rootDir: z.string().nullable().optional(), statusDetail: z.string().nullable().optional(),
    }),
  ),
});
/** Install job (SDK 0.6.37): the source is `target.source` when `target.kind = "source"`; `error` only on `failed`. */
const jobShape = z.looseObject({
  id: z.string(),
  state: z.enum(["queued", "running", "cancelling", "succeeded", "failed", "cancelled"]),
  target: z.looseObject({ kind: z.string(), source: z.string().optional() }),
  error: z.string().nullable().optional(),
});
const projectsOut = z.array(z.looseObject({ id: z.string(), sources: z.array(z.looseObject({ hostId: z.string(), path: z.string() })).optional() }));
const createdOut = z.looseObject({ id: z.string() });
const configOut = z.looseObject({ primaryHostId: z.string().nullable().optional() });
const UNKNOWN_JOB = /unknown install job/i;

/**
 * Parses a bb response against a schema. On a mismatch (e.g. a state this code does not know) the raw values of the offending fields go
 * to the plugin log, then it throws: strictness stays, and the cause is visible in `bb plugin logs plugin-workshop`.
 */
function parseOrLog<T>(schema: z.ZodType<T>, raw: unknown, what: string, warn: (m: string) => void): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  for (const issue of r.error.issues.slice(0, 5)) {
    let v: unknown = raw;
    for (const k of issue.path) v = v === null || typeof v !== "object" ? undefined : (v as Record<PropertyKey, unknown>)[k];
    warn(redact(`${what}: ${issue.path.map(String).join(".") || "(whole response)"} = ${String(JSON.stringify(v)).slice(0, 200)} — ${issue.message}`));
  }
  throw r.error;
}

function jobOf(raw: unknown, warn: (m: string) => void): InstallJob {
  const j = parseOrLog(jobShape, raw, "installJobs", warn);
  const source = j.target.kind === "source" ? (j.target.source ?? null) : null;
  return { id: j.id, source, state: j.state, error: j.state === "failed" ? (j.error ?? "install failed") : null };
}

// --- processes ---

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}
const GIT_TIMEOUT_MS = 60_000;
/** `bb plugin new`: up to 15 minutes waiting for the lock (`flock -w 900`) plus the scaffold itself with `npm install`. */
const SCAFFOLD_TIMEOUT_MS = 20 * 60_000;
/**
 * Runs a command to completion without throwing on a non-zero exit code (the caller interprets it). Throws if it failed to start, timed
 * out or was killed by a signal: the outcome is then unknown.
 */
function run(file: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<Run> {
  const timeout = o.timeout ?? GIT_TIMEOUT_MS;
  return new Promise((done, fail) => {
    execFile(file, args, { cwd: o.cwd, env: o.env, timeout, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (!err) return done({ code: 0, stdout, stderr });
      const e = err as Error & { code?: unknown; killed?: boolean };
      if (typeof e.code === "number" && !e.killed) return done({ code: e.code, stdout, stderr });
      const why = e.killed ? `timed out after ${Math.round(timeout / 1000)} s` : e.message;
      fail(new Error(`${file} ${args.filter((a) => !a.startsWith("-")).slice(0, 3).join(" ")}: ${why}${stderr.trim() ? ` — ${stderr.trim().slice(-500)}` : ""}`));
    });
  });
}
/**
 * Like `run`, with `input` written to the command's stdin (`--stdin` revision lists: no argument length limit, and a remote-supplied sha is
 * never parsed as an option).
 */
function runInput(file: string, args: string[], input: string, o: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<Run> {
  const timeout = o.timeout ?? GIT_TIMEOUT_MS;
  return new Promise((done, fail) => {
    const child = execFile(file, args, { env: o.env, timeout, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (!err) return done({ code: 0, stdout, stderr });
      const e = err as Error & { code?: unknown; killed?: boolean };
      if (typeof e.code === "number" && !e.killed) return done({ code: e.code, stdout, stderr });
      fail(new Error(`${file} ${args.filter((a) => !a.startsWith("-")).slice(0, 3).join(" ")}: ${e.killed ? `timed out after ${Math.round(timeout / 1000)} s` : e.message}`));
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
}

/**
 * Streams a command's stdout line by line (`\n`, decoded as latin1: byte for byte, no multi-byte character split across chunks). More than
 * `maxBytes`, a timeout, a non-zero exit or an exception from `onLine` kills the command and throws.
 */
function streamLines(
  file: string, args: string[], input: string, o: { env: NodeJS.ProcessEnv; timeout: number; maxBytes: number }, onLine: (line: string) => void,
): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { env: o.env, stdio: ["pipe", "pipe", "pipe"] });
    let bytes = 0;
    let rest = "";
    let stderr = "";
    let failure: Error | null = null;
    const stop = (e: Error) => {
      if (failure) return;
      failure = e;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop(new Error(`timed out after ${Math.round(o.timeout / 1000)} s`)), o.timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > o.maxBytes) return stop(new Error(`more than ${Math.round(o.maxBytes / 1024 / 1024)} MB of changes`));
      const lines = (rest + chunk.toString("latin1")).split("\n");
      rest = lines.pop() ?? "";
      try {
        for (const l of lines) onLine(l);
      } catch (e) {
        stop(e instanceof Error ? e : new Error(String(e)));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });
    child.on("error", (e) => stop(e));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) return fail(failure);
      if (code !== 0) return fail(new Error(`${file} exited with ${code ?? signal}${stderr.trim() ? ` — ${stderr.trim().slice(-500)}` : ""}`));
      try {
        if (rest !== "") onLine(rest);
      } catch (e) {
        return fail(e instanceof Error ? e : new Error(String(e)));
      }
      done();
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}
/** Like `streamLines`, but the whole stdout as bytes (binary content intact). More than `maxBytes`, a timeout or a non-zero exit throws. */
function runBytes(file: string, args: string[], input: string, o: { env: NodeJS.ProcessEnv; timeout: number; maxBytes: number }): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { env: o.env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let failure: Error | null = null;
    const stop = (e: Error) => {
      if (failure) return;
      failure = e;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop(new Error(`timed out after ${Math.round(o.timeout / 1000)} s`)), o.timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > o.maxBytes) return stop(new Error(`more than ${Math.round(o.maxBytes / 1024 / 1024)} MB`));
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });
    child.on("error", (e) => stop(e));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) return fail(failure);
      if (code !== 0) return fail(new Error(`${file} exited with ${code ?? signal}${stderr.trim() ? ` — ${stderr.trim().slice(-500)}` : ""}`));
      done(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}
/**
 * `cat-file --batch` output for exactly `ids`, in order: `<id> blob <size>\n<bytes>\n` each. A missing object, another type, a cut-off or
 * extra answer throws — what was not read whole is not vouched for.
 */
function batchBlobs(out: Buffer, ids: string[]): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  let at = 0;
  for (const id of ids) {
    const nl = out.indexOf(10, at);
    if (nl < 0) throw new Error("git cat-file: the answer is cut off");
    const head = out.toString("latin1", at, nl);
    if (head === `${id} missing`) throw new Error(`git cat-file: object ${id.slice(0, 12)} is missing`);
    const m = /^([0-9a-f]+) (\S+) (\d+)$/.exec(head);
    if (!m || m[1] !== id) throw new Error("git cat-file: unexpected answer");
    if (m[2] !== "blob") throw new Error(`git cat-file: ${id.slice(0, 12)} is a ${m[2]}, not a blob`);
    const start = nl + 1;
    const end = start + Number(m[3]);
    if (end >= out.length || out[end] !== 10) throw new Error("git cat-file: the answer is cut off");
    blobs.set(id, out.subarray(start, end));
    at = end + 1;
  }
  if (at !== out.length) throw new Error("git cat-file: more answers than objects asked for");
  return blobs;
}
/** Git environment without inherited pointers to some other repository, index, shallow or graft file, or replacement settings. */
const GIT_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX|SHALLOW_FILE|GRAFT_FILE|REPLACE_REF_BASE|NO_REPLACE_OBJECTS)$/.test(k),
  ),
);
/** Reads: git does not take `index.lock` to refresh file stat info — someone else may be working in the working copy. */
const GIT_READ: NodeJS.ProcessEnv = { ...GIT_ENV, GIT_OPTIONAL_LOCKS: "0" };
/**
 * A graft file that cannot exist (a path under `/dev/null`): git reads no grafts and says nothing about it. `info/grafts` would give
 * commits other parents than the ones a push sends.
 */
const NO_GRAFTS = "/dev/null/workshop-no-grafts";
/** `git --no-replace-objects`: the command-line half of `GIT_EXACT`. */
const NO_REPLACE = "--no-replace-objects";
/**
 * Reads of what is published or kept: exactly the stored objects and their real parents. Replacement objects (`refs/replace/*`) would show
 * clean content in place of a secret-bearing commit or blob while a push sends the original, and grafts would hide parents. Both are off:
 * `--no-replace-objects` on the command (`NO_REPLACE`) and here, and a graft file that does not exist.
 */
const GIT_EXACT: NodeJS.ProcessEnv = { ...GIT_READ, GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: NO_GRAFTS };
/** Network (fetch, push): no terminal prompts — credentials come from `gh auth git-credential` in the git config; not signed in is an error, not a hang. */
const GIT_NET: NodeJS.ProcessEnv = { ...GIT_ENV, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
/** The push walks the same graph the publication scan read: no replacements, no grafts. */
const GIT_PUSH: NodeJS.ProcessEnv = { ...GIT_NET, GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: NO_GRAFTS };
const GH_ENV: NodeJS.ProcessEnv = { ...GIT_ENV, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" };
const NET_TIMEOUT_MS = 120_000;
/** A full commit id (SHA-1 or SHA-256): what goes into `--stdin` revision lists. */
const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** A branch the Workshop pushes to: no option-like start, no `..`, no ref-format oddities. */
const SAFE_BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]+(?<![/.])$/;
/** `gh repo view --json visibility,owner,nameWithOwner`. */
const repoInfoOut = z.looseObject({ visibility: z.string(), owner: z.looseObject({ login: z.string() }), nameWithOwner: z.string() });
/** Repository owner and name: only Latin letters, digits, `.`, `_`, `-` — they are passed as `gh` arguments. */
function safeRepoPart(s: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s)) throw new Error(`invalid GitHub name: «${s}»`);
  return s;
}
/** An answer within `ms`; the timer is cleared as soon as the answer arrives (no dangling rejection is left behind). */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(what)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
/** Per-folder queue of network git operations (process-wide). */
const NET_CHAINS = new Map<string, Promise<unknown>>();
function netQueue<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = NET_CHAINS.get(dir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  NET_CHAINS.set(dir, tail);
  void tail.then(() => {
    if (NET_CHAINS.get(dir) === tail) NET_CHAINS.delete(dir);
  });
  return next;
}
/** A GitHub repository URL (`githubRepo`, publish.ts) → `owner/name`; not GitHub, or not a valid owner and name — null. Links are built only from this. */
export function repoOf(url: string): string | null {
  const r = githubRepo(url);
  return r ? `${r.owner}/${r.name}` : null;
}
const gitRun = (dir: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV) => run("git", ["-C", dir, ...args], { env });
async function gitOut(dir: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV): Promise<string> {
  const r = await gitRun(dir, args, env);
  // The subcommand names the error, not a leading global option (`--no-replace-objects`, `-c <setting>`).
  const name = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c") ?? args[0];
  if (r.code !== 0) throw new Error(`git ${name} in ${dir}: ${r.stderr.trim() || `exit code ${r.code}`}`);
  return r.stdout;
}
/** `--quiet` comparison: 0 — same, 1 — different, anything else — an error. */
async function gitSame(dir: string, args: string[]): Promise<boolean> {
  const r = await gitRun(dir, args, GIT_READ);
  if (r.code === 0 || r.code === 1) return r.code === 0;
  throw new Error(`git ${args.join(" ")} in ${dir}: ${r.stderr.trim() || `exit code ${r.code}`}`);
}
const splitZ = (s: string) => s.split("\0").filter(Boolean);
/**
 * `diff --raw -z --no-renames --no-abbrev` (and `diff-tree -r -z`): `:<old mode> <new mode> <old id> <new id> <status>\0<path>\0` → path,
 * new mode and the blob ids of both sides (null — nothing on that side: added, deleted, or a submodule, whose id is a commit, not a blob).
 */
function rawEntries(out: string): Array<{ path: string; mode: string; oldBlob: string | null; newBlob: string | null }> {
  const parts = out.split("\0");
  const entries: Array<{ path: string; mode: string; oldBlob: string | null; newBlob: string | null }> = [];
  const blob = (mode: string | undefined, id: string | undefined) => (mode && id && mode !== "000000" && mode !== "160000" && FULL_SHA.test(id) && !/^0+$/.test(id) ? id : null);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const head = parts[i]!;
    if (!head.startsWith(":")) throw new Error(`git diff --raw: unexpected line «${head.slice(0, 80)}»`);
    const [oldMode, newMode, oldId, newId] = head.slice(1).split(" ");
    entries.push({ path: parts[i + 1]!, mode: newMode ?? "", oldBlob: blob(oldMode, oldId), newBlob: blob(newMode, newId) });
  }
  return entries;
}
/** A path for `GIT_ALTERNATE_OBJECT_DIRECTORIES` (a `:`-separated list): a path with `:` or a quote is quoted, the way git reads it. */
const alternate = (p: string) => (/[:"\\]/.test(p) ? `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : p);
/** Git's empty tree: the diff base for a repository without commits. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const missing = (e: unknown) => ["ENOENT", "ENOTDIR"].includes(String((e as { code?: unknown }).code));
/** The last n characters of a log, on one line. */
const clipTail = (text: string, n: number) => {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > n ? `…${t.slice(-n)}` : t || "(log is empty)";
};

/** An `excludedBy` pattern (ports.ts) as a git pathspec: `glob` magic, where `*` does not cross `/` and `**\/` means any depth. */
function excludeSpec(pattern: string): string {
  if (pattern === "" || pattern.startsWith("/")) throw new Error(`exclude pattern must be relative: «${pattern}»`);
  const g = (p: string) => p.replace(/[?[\]\\]/g, "\\$&");
  if (pattern.endsWith("/")) return `:(exclude,glob)**/${g(pattern.slice(0, -1))}/**`;
  if (!pattern.includes("/")) return `:(exclude,glob)**/${g(pattern)}`;
  return `:(exclude,glob)${g(pattern)}`;
}
/** Working-tree pathspec minus excluded and skipped paths; file names are taken as is (`literal`), with slashes, spaces, `*`. */
const treeSpecs = (exclude: string[], skip: string[] = []) => ["--", ".", ...exclude.map(excludeSpec), ...skip.map((f) => `:(exclude,literal)${f}`)];

// --- build lock ---

export const LOCKS_DIR = join(homedir(), ".bb", "locks", SELF_ID);
export { BUILD_LOCK } from "./rules";
/**
 * Build lock holder: `flock -w 900 build.lock sh -c <script> workshop-holder <id> <token>`. It holds the lock while `<id>.want`
 * contains its token, with the mark `<id>.held` = `<sh pid> <token>`; with no claim or a foreign token it exits. The folder is in single
 * quotes, so a quote in it throws.
 */
export function holderScript(locksDir: string): string {
  if (locksDir.includes("'")) throw new Error(`a lock folder containing a single quote is not supported: ${locksDir}`);
  return `LOCKS='${locksDir}'; w="$LOCKS/$1.want"; [ "$(cat "$w" 2>/dev/null)" = "$2" ] || exit 0; echo "$$ $2" > "$LOCKS/$1.held"; while [ "$(cat "$w" 2>/dev/null)" = "$2" ]; do sleep 2; done; rm -f "$LOCKS/$1.held"`;
}
/** The attempt id and the token go into file names, shell arguments and the `pgrep` pattern: only Latin letters, digits, `_` and `-`. */
function safeName(kind: string, v: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v)) throw new Error(`lock ${kind} «${v}»: only Latin letters, digits, «_» and «-»`);
  return v;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `bb plugin new` under the lock: first remove whatever an interrupted earlier run left in the nested folder (it held the lock until the end). */
const SCAFFOLD_SCRIPT = `rm -rf -- "bb-plugin-$1" && exec "$2" plugin new "$1"`;
const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SdkPortsOptions {
  /** Folder for claims and holder marks; default `~/.bb/locks/<plugin id>`. A temporary one in tests. */
  locksDir?: string;
  /** Build lock; default: the `buildLock` setting (`~/.bb/locks/build.lock`). A temporary file in tests. */
  buildLock?: string;
  /** Root of the plugin working copies (`plugins.folders`); default: the `pluginsRoot` setting (`~/plugins`). */
  pluginsRoot?: string;
  /** The `bb` command used for scaffolding; a fake in tests (tests never run the real `bb plugin new`). */
  bbBin?: string;
  /** Folder for dependency install state; default `workshop-deps` next to the claims folder (`~/.bb/locks/workshop-deps`). */
  depsDir?: string;
  /** The npm command; a fake in tests. */
  npmBin?: string;
}

/** A dependency install running longer than this is considered hung: the process is killed and the attempt fails. */
const DEPS_MAX_MS = 20 * 60_000;
/** Marker in `node_modules`: the dependencies are installed exactly per this lockfile (sha). `npm ci` wipes `node_modules`, and the marker with it. */
const DEPS_MARK = ".workshop-deps";
/**
 * Background install of the working copy's dependencies: $1 — folder, $2 — lockfile fingerprint, $3 — path without extension for the log
 * and the exit code, $4 — npm. The exit code is written atomically, last: if it is missing, the install is still running or the process vanished.
 */
const DEPS_SCRIPT = [
  'exec >"$3.log" 2>&1',
  'cd "$1" || { echo 97 >"$3.exit.tmp"; mv "$3.exit.tmp" "$3.exit"; exit 97; }',
  `rm -f "node_modules/${DEPS_MARK}"`,
  'if [ -f package-lock.json ]; then "$4" ci --ignore-scripts --no-audit --no-fund; else "$4" install --ignore-scripts --no-audit --no-fund --no-package-lock; fi',
  "code=$?",
  `if [ "$code" -eq 0 ]; then printf '%s' "$2" >"node_modules/${DEPS_MARK}"; fi`,
  'echo "$code" >"$3.exit.tmp" && mv "$3.exit.tmp" "$3.exit"',
].join("\n");

class TooManyFiles extends Error {}

/** A path under base; anything that ends up outside after resolving `..` is an error. */
function inside(base: string, p: string): string {
  const root = resolve(base);
  const r = resolve(p);
  if (r !== root && !r.startsWith(root + sep)) throw new Error(`path outside the work snapshots: ${p}`);
  return r;
}

interface ThreadFacts {
  status?: string;
  environmentId?: string | null;
  archivedAt?: number | null;
  deletedAt?: number | null;
}
/** threads.get returns the thread either flat or wrapped in `{ thread }` (with include). */
const threadOf = (r: unknown): ThreadFacts => ((r as { thread?: ThreadFacts }).thread ?? r) as ThreadFacts;

export function sdkPorts(bb: BbPluginApi, onChange: (workId: string) => void, opts: SdkPortsOptions = {}): Ports {
  const locksDir = opts.locksDir ?? LOCKS_DIR;
  const buildLock = opts.buildLock ?? BUILD_LOCK;
  const HOLDER_SCRIPT = holderScript(locksDir);
  const bbBin = opts.bbBin ?? "bb";
  const depsDir = opts.depsDir ?? join(dirname(locksDir), "workshop-deps");
  const npmBin = opts.npmBin ?? "npm";
  /** Fingerprint of what the dependencies are installed from: the lockfile, or package.json without one; null — no package.json, nothing to install. */
  async function depsWant(dir: string): Promise<string | null> {
    for (const [name, tag] of [["package-lock.json", "lock"], ["package.json", "pkg"]] as const) {
      const text = await readFile(join(dir, name), "utf8").catch((e: unknown) => {
        if (missing(e)) return null;
        throw e;
      });
      if (text !== null) return `${tag}:${createHash("sha256").update(text).digest("hex")}`;
    }
    return null;
  }
  const depsBase = (dir: string) => join(depsDir, safeName("folder", basename(dir)));
  const pidAlive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  /**
   * The recorded install process is still the one this plugin started for this folder: `sh -c <script> workshop-deps <dir> <want> <base> …`,
   * checked by its command line (`/proc/<pid>/cmdline`) — the pid may have been reused by an unrelated process, which must not be signalled.
   */
  async function depsAlive(pid: number, dir: string, want: string, base: string): Promise<boolean> {
    if (!Number.isInteger(pid) || pid <= 1 || !pidAlive(pid)) return false;
    const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0");
    const at = argv.indexOf("workshop-deps");
    return at > 0 && argv[at + 1] === dir && argv[at + 2] === want && argv[at + 3] === base;
  }
  /** The plugin log keeps what it is given: token-shaped text is redacted first. */
  const warnLog = (m: string) => bb.log.warn(redact(m));
  /** An error from a call on a machine: no file → null; machine offline → MachineUnavailable; anything else is rethrown as is. */
  function classify(e: unknown): null {
    const text = errText(e);
    if (PATH_MISSING.test(text)) return null;
    warnLog(`host call failed: ${text}`);
    if (OFFLINE.test(text)) throw new MachineUnavailable(text);
    throw e;
  }
  /** Environment not ready: "still being created" is an ordinary error (it passes by itself); otherwise the worktree is gone. */
  async function notReady(environmentId: string, e: unknown): Promise<never> {
    const text = errText(e);
    if (/Environment unavailable/i.test(text)) {
      const env = (await bb.sdk.environments.get({ environmentId }).catch((g: unknown) => {
        if (ENV_GONE.test(errText(g))) throw new WorktreeGone(text);
        throw g;
      })) as { status?: string };
      if (env.status === "creating" || env.status === "provisioning") throw new Error(`environment ${environmentId} is still being created`);
    }
    throw new WorktreeGone(text);
  }
  const locations = new Map<string, { hostId: string; path: string }>();
  async function loc(environmentId: string) {
    const cached = locations.get(environmentId);
    if (cached) return cached;
    const e = (await bb.sdk.environments.get({ environmentId }).catch((err: unknown) => {
      if (ENV_GONE.test(errText(err))) throw new WorktreeGone(errText(err));
      throw err;
    })) as { hostId: string; path: string | null };
    if (!e.path) throw new Error(`environment ${environmentId} has no path`);
    const l = { hostId: e.hostId, path: e.path };
    locations.set(environmentId, l);
    return l;
  }
  /**
   * On the bb server machine (where the worktree is a local folder) a file is read only by its own path: a symbolic link, or a path through
   * one (its real path differs from the folder's real path plus `rel`), throws `SymlinkRefused`. On another machine there is no local check
   * — the host's `rootPath` confinement is all there is.
   */
  async function refuseLinks(l: { hostId: string; path: string }, rel: string): Promise<void> {
    if (l.hostId !== (await ports.serverHostId().catch(() => null))) return;
    const real = await realpath(join(l.path, rel)).catch((e: unknown) => {
      if (missing(e)) return null;
      throw e;
    });
    if (real === null) return;
    if (real !== join(await realpath(l.path), rel)) throw new SymlinkRefused(`${rel}: a symbolic link or a path through one — not followed`);
  }
  async function readHost(environmentId: string, rel: string, noLinks = false) {
    const l = await loc(environmentId);
    if (noLinks) await refuseLinks(l, rel);
    try {
      const f = await bb.sdk.files.read({ hostId: l.hostId, path: posix.join(l.path, rel), rootPath: l.path });
      return "content" in f ? f : null;
    } catch (e) {
      return classify(e);
    }
  }
  const tasksRpc = <T>(method: string, input: unknown, outputSchema: z.ZodType<T>) =>
    bb.sdk.plugins.callRpc({ pluginId: "tasks", method, input: input as never, outputSchema }) as Promise<T>;
  const mutate = async (method: string, input: unknown): Promise<TaskRef> => {
    const r = await tasksRpc(method, input, taskMutationOut);
    if (!r.ok) throw new Error(`tasks.${method}: ${JSON.stringify((r as { error: unknown }).error)}`);
    const t = (r as { task: z.infer<typeof taskShape> }).task;
    return { id: t.id, key: t.key, projectId: t.projectId, title: t.title };
  };
  let dataDir: string | null = null;
  const worksDir = async (workId: string) => {
    dataDir ??= ((await bb.sdk.system.config()) as { dataDir: string }).dataDir;
    return join(dataDir, "plugins", SELF_ID, "works", workId);
  };
  let serverHost: string | null = null;

  // --- lock: claims, marks, holder processes ---
  const wantPath = (id: string) => join(locksDir, `${id}.want`);
  const heldPath = (id: string) => join(locksDir, `${id}.held`);
  /** Holder mark `<pid> <token>`; missing or unreadable — null. */
  async function mark(id: string): Promise<{ pid: number; token: string } | null> {
    const m = /^(\d+) (\S+)\s*$/.exec(await readFile(heldPath(id), "utf8").catch(() => ""));
    return m ? { pid: Number(m[1]), token: m[2]! } : null;
  }
  /** Process `pid` is a live holder of this generation (checked by its command line: the pid may have been reused). */
  async function holderAlive(pid: number, id: string, token: string): Promise<boolean> {
    const cmd = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    return cmd.split("\0").filter(Boolean).join(" ").endsWith(` workshop-holder ${id} ${token}`);
  }
  /** Whether any holder process of this generation is alive (`flock` waiting for the lock, or `sh` holding it). */
  async function generationAlive(id: string, token: string): Promise<boolean> {
    const r = await run("pgrep", ["-f", `workshop-holder ${escapeRe(id)} ${escapeRe(token)}$`]);
    if (r.code === 0 || r.code === 1) return r.code === 0;
    throw new Error(`pgrep: ${r.stderr.trim() || `exit code ${r.code}`}`);
  }

  /**
   * The working tree on top of HEAD in a temporary index (`GIT_INDEX_FILE`; the real index and its flags are untouched): `read-tree HEAD`,
   * then `add -A` minus excluded (`exclude`), skipped (`skip`) and nested repositories. Nested ones are untracked repositories (`ls-files
   * --others` lists them as `name/`; an empty one would also break `add`) and submodules with a moved commit (mode 160000): they can
   * neither be read as a file nor checked, so they stay as in HEAD and are returned in `nested`. `files` — modified and new against HEAD.
   * `objects: "scratch"` — a check pass: `add -A` writes objects into a temporary store (`GIT_OBJECT_DIRECTORY`), the real one is
   * attached read-only (`GIT_ALTERNATE_OBJECT_DIRECTORIES`), so unchecked files (secrets) never reach the plugin's repository.
   * `"real"` — the snapshot commit: its objects must live in the repository.
   */
  async function staged<T>(
    dir: string, exclude: string[], skip: string[], objects: "real" | "scratch",
    use: (st: { env: NodeJS.ProcessEnv; parent: string | null; files: string[]; nested: string[] }) => Promise<T>,
  ): Promise<T> {
    const tmp = await mkdtemp(join(tmpdir(), "workshop-index-"));
    const env: NodeJS.ProcessEnv = { ...GIT_ENV, GIT_INDEX_FILE: join(tmp, "index") };
    try {
      if (objects === "scratch") {
        // A linked worktree shares the main object store (`--git-path objects` points to it).
        const real = (await gitOut(dir, ["rev-parse", "--path-format=absolute", "--git-path", "objects"], GIT_READ)).trim();
        await mkdir(join(tmp, "objects"));
        env.GIT_OBJECT_DIRECTORY = join(tmp, "objects");
        env.GIT_ALTERNATE_OBJECT_DIRECTORIES = alternate(real);
      }
      const h = await gitRun(dir, ["rev-parse", "-q", "--verify", "HEAD"]);
      const parent = h.code === 0 ? h.stdout.trim() : null;
      const fromHead = () => gitOut(dir, parent ? ["read-tree", parent] : ["read-tree", "--empty"], env);
      await fromHead();
      const nested = splitZ(await gitOut(dir, ["ls-files", "--others", "--exclude-standard", "-z", ...treeSpecs(exclude, skip)], env))
        .filter((p) => p.endsWith("/"))
        .map((p) => p.slice(0, -1));
      const add = () => gitOut(dir, ["add", "-A", ...treeSpecs(exclude, [...skip, ...nested])], env);
      await add();
      // `--ignore-submodules=none`: a `diff.ignoreSubmodules` or `submodule.*.ignore` setting must not hide a moved submodule.
      let entries = rawEntries(await gitOut(dir, ["diff", "--cached", "--raw", "-z", "--no-renames", "--no-abbrev", "--ignore-submodules=none", "--diff-filter=d", parent ?? EMPTY_TREE, "--"], env));
      const links = entries.filter((e) => e.mode === "160000").map((e) => e.path);
      if (links.length > 0) {
        nested.push(...links);
        await fromHead();
        await add();
        entries = entries.filter((e) => e.mode !== "160000");
      }
      return await use({ env, parent, files: entries.map((e) => e.path), nested });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  const ports: Ports = {
    now: () => Date.now(),
    // An aborted wait is not an error: the polling loop sees the stop by itself and exits.
    sleep: (ms, signal) => delay(ms, undefined, { signal }).catch(() => undefined),
    async spawn(a) {
      const environment =
        a.environment.kind === "reuse"
          ? ({ type: "reuse", environmentId: a.environment.environmentId } as const)
          : ({ type: "host", hostId: a.environment.hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } } as const);
      const t = await bb.sdk.threads.spawn({
        projectId: a.projectId,
        environment,
        providerId: a.providerId,
        model: a.model,
        ...(a.reasoningLevel ? { reasoningLevel: a.reasoningLevel as never } : {}),
        title: a.title,
        prompt: a.prompt,
        permissionMode: "full",
        pluginMetadata: a.metadata,
        ...(a.hidden ? { visibility: "hidden" as const } : {}),
      });
      return t.id;
    },
    async findThread(projectId, opKey, since) {
      // The list is ordered by activity, not by creation, so pages cannot be cut off by age. We page through all of the plugin's threads
      // in the project and pick candidates by createdAt >= since. An error or "could not look through everything" throws instead of
      // returning "no thread": "no thread" lets the Engine create a second agent.
      for (let offset = 0; offset < 500; offset += 50) {
        const page = (await bb.sdk.threads.list({ projectId, originPluginId: SELF_ID, includeHidden: true, limit: 50, offset })) as Array<{ id: string; createdAt: number }>;
        for (const t of page.filter((x) => x.createdAt >= since)) {
          const m = (await bb.sdk.threads.getPluginMetadata({ threadId: t.id })) as { opKey?: unknown };
          if (m.opKey === opKey) return t.id;
        }
        if (page.length < 50) return null;
      }
      throw new Error("thread lookup by retry key: more than 500 plugin threads in the project — cannot confirm");
    },
    /** "unknown" only when the thread does not exist (404 or deleted). Any other failure or an unexpected response throws. */
    async status(threadId) {
      let t: ThreadFacts;
      try {
        t = threadOf(await bb.sdk.threads.get({ threadId }));
      } catch (e) {
        if (NOT_FOUND.test(errText(e))) return "unknown";
        throw e;
      }
      if (t.deletedAt != null) return "unknown";
      if (typeof t.status !== "string" || !THREAD_STATUSES.includes(t.status)) throw new Error(`thread ${threadId}: unexpected status ${JSON.stringify(t.status)}`);
      return t.status as ThreadStatus;
    },
    async threadStamp(threadId) {
      try {
        const t = (threadOf(await bb.sdk.threads.get({ threadId })) as ThreadFacts & { updatedAt?: unknown });
        return typeof t.updatedAt === "number" ? t.updatedAt : null;
      } catch (e) {
        if (NOT_FOUND.test(errText(e))) return null;
        throw e;
      }
    },
    async threadOutput(threadId) {
      const r = (await bb.sdk.threads.output({ threadId })) as { output?: unknown };
      return typeof r.output === "string" ? r.output : null;
    },
    async environmentOf(threadId) {
      for (let i = 0; i < 10; i++) {
        const t = threadOf(await bb.sdk.threads.get({ threadId }));
        if (t.environmentId) {
          const e = (await bb.sdk.environments.get({ environmentId: t.environmentId })) as { mergeBaseBranch?: string | null; defaultBranch?: string | null };
          return { environmentId: t.environmentId, baseBranch: e.mergeBaseBranch ?? e.defaultBranch ?? null };
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      return null;
    },
    async send(threadId, text) {
      await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] });
    },
    async stop(threadId) {
      await bb.sdk.threads.stop({ threadId });
    },
    /** Idempotent: a thread that is already archived (or already deleted) is not an error. The thread's state decides, not the error text. */
    async archive(threadId) {
      try {
        await bb.sdk.threads.archive({ threadId });
      } catch (e) {
        let t: ThreadFacts;
        try {
          t = threadOf(await bb.sdk.threads.get({ threadId }));
        } catch (g) {
          if (NOT_FOUND.test(errText(g))) return;
          throw e;
        }
        if (t.archivedAt == null && t.deletedAt == null) throw e;
      }
    },
    async head(environmentId) {
      let st: Awaited<ReturnType<typeof bb.sdk.environments.status>>;
      try {
        st = await bb.sdk.environments.status({ environmentId });
      } catch (e) {
        warnLog(`environments.status ${environmentId}: ${errText(e)}`);
        if (ENV_GONE.test(errText(e))) await notReady(environmentId, e);
        if (OFFLINE.test(errText(e))) throw new MachineUnavailable(errText(e));
        throw e;
      }
      if (st.outcome === "unavailable") {
        const text = `worktree unavailable (${st.failure.code}): ${st.failure.message}`;
        if (st.failure.code === "path_not_found" || st.failure.code === "unknown_environment") throw new WorktreeGone(text);
        if (st.failure.code === "permission_denied" || st.failure.code === "unknown") throw new MachineUnavailable(st.failure.message);
        throw new Error(text);
      }
      if (st.outcome !== "available") return { sha: null, dirty: false };
      const c = st.workspace.checkout;
      return { sha: c.kind === "branch" || c.kind === "detached" ? c.headSha : null, dirty: st.workspace.workingTree.hasUncommittedChanges };
    },
    async read(environmentId, rel) {
      const f = await readHost(environmentId, rel);
      if (!f) return null;
      return f.contentEncoding === "utf8" ? f.content : Buffer.from(f.content, "base64").toString("utf8");
    },
    async readRaw(environmentId, rel): Promise<RawFile | null> {
      const f = await readHost(environmentId, rel, true);
      if (!f) return null;
      return { content: f.content, encoding: f.contentEncoding, mime: f.mimeType ?? MIME[extname(rel)] ?? "application/octet-stream", size: f.sizeBytes };
    },
    async list(environmentId, relDir) {
      const l = await loc(environmentId);
      try {
        const r = await bb.sdk.files.listPaths({ hostId: l.hostId, path: posix.join(l.path, relDir), includeFiles: true, includeDirectories: false, includeHidden: true, limit: 500 });
        if (r.truncated) throw new TooManyFiles(`too many files in ${relDir}`);
        return r.paths.map((p) => posix.join(relDir, p.path));
      } catch (e) {
        if (e instanceof TooManyFiles) throw e;
        return classify(e) ?? [];
      }
    },
    /** The path comes from the `loc` cache, but the worktree's liveness is checked on every call: removed — WorktreeGone, machine not answering — MachineUnavailable. */
    async worktreeDir(environmentId) {
      const l = await loc(environmentId);
      await ports.head(environmentId);
      return l.path;
    },
    /** All of `.superpowers/` is kept out of git: it holds both the Workshop's files and the implementer's SDD journal (`.superpowers/sdd/`) — otherwise the worktree is "dirty" and hand-over is blocked. */
    async ensureWorkDir(environmentId) {
      const l = await loc(environmentId);
      await bb.sdk.files.write({ hostId: l.hostId, path: posix.join(l.path, ".superpowers/.gitignore"), rootPath: l.path, content: "*\n", createParents: true });
    },
    /**
     * Key files by name, symbolic links and files whose content has a finding are not copied: they are returned in `withheld` (labels only).
     * Folders are created `0700`, files `0600`: the snapshots are the work's documents, readable by the plugin alone.
     */
    async saveArtifacts(workId, environmentId, what, label) {
      const base = await worksDir(workId);
      const target = inside(base, join(base, label));
      const listed = (await Promise.all(what.dirs.map((d) => ports.list(environmentId, d)))).flat();
      let n = 0;
      const withheld: Withheld[] = [];
      for (const rel of [...new Set([...what.files, ...listed])]) {
        if (secretFileName(rel)) {
          withheld.push({ path: rel, labels: ["key file by name"] });
          continue;
        }
        let f: RawFile | null;
        try {
          f = await ports.readRaw(environmentId, rel);
        } catch (e) {
          if (!(e instanceof SymlinkRefused)) throw e;
          withheld.push({ path: rel, labels: ["symbolic link"] });
          continue;
        }
        if (!f && (listed.includes(rel) || what.mustExist.includes(rel))) throw new Error(`${rel}: file disappeared during the snapshot — snapshot incomplete`);
        if (!f) continue;
        if (f.size > MAX_COPY_BYTES) throw new Error(`${rel}: larger than 25 MB — snapshot incomplete`);
        const buf = Buffer.from(f.content, f.encoding === "utf8" ? "utf8" : "base64");
        // A binary file is read as latin1: plain text inside it is visible to the patterns.
        const found = secretFindings(f.encoding === "utf8" ? f.content : buf.toString("latin1"));
        if (found.length > 0) {
          withheld.push({ path: rel, labels: found });
          continue;
        }
        const out = inside(target, join(target, rel));
        await mkdir(dirname(out), { recursive: true, mode: 0o700 });
        await writeFile(out, buf, { mode: 0o600 });
        n++;
      }
      return { saved: n, withheld };
    },
    /** The newest snapshot that has the file. A symbolic link there, or a real path outside the snapshot, is refused — not followed. */
    async readSaved(workId, rel) {
      const base = await worksDir(workId);
      const labels = (await readdir(base).catch(() => [] as string[])).sort().reverse();
      for (const label of labels) {
        const snap = join(base, label);
        const p = inside(snap, join(snap, rel));
        const st = await lstat(p).catch(() => null);
        if (!st) continue;
        if (st.isSymbolicLink()) throw new SymlinkRefused(`${rel}: a symbolic link in the work snapshot — not followed`);
        if (!st.isFile()) continue;
        inside(await realpath(snap), await realpath(p));
        const buf = await readFile(p);
        const ext = extname(rel);
        const text = TEXT_EXT.has(ext);
        return { content: buf.toString(text ? "utf8" : "base64"), encoding: text ? "utf8" : "base64", mime: MIME[ext] ?? (text ? "text/plain" : "application/octet-stream"), size: buf.length };
      }
      return null;
    },
    async listSaved(workId, relDir) {
      const base = await worksDir(workId);
      const labels = (await readdir(base).catch(() => [] as string[])).sort().reverse();
      for (const label of labels) {
        const snap = join(base, label);
        const dir = inside(snap, join(snap, relDir));
        const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => null);
        if (!entries) continue;
        return entries.filter((e) => e.isFile()).map((e) => posix.join(relDir, posix.relative(dir, join(e.parentPath, e.name)).split("\\").join("/")));
      }
      return [];
    },
    ui: {
      async panels() {
        const { preferences } = await bb.sdk.system.uiPreferences.list();
        const o = preferences["sidebar.pluginPanelOrder"];
        const v = preferences["sidebar.visiblePluginPanels"];
        return { order: [...(o?.value ?? [])], orderRevision: o?.revision ?? 0, visible: v?.value ? [...v.value] : null, visibleRevision: v?.revision ?? 0 };
      },
      async setOrder(order, expectedRevision) {
        await bb.sdk.system.uiPreferences.set({ key: "sidebar.pluginPanelOrder", value: order, expectedRevision });
      },
      async setVisible(visible, expectedRevision) {
        await bb.sdk.system.uiPreferences.set({ key: "sidebar.visiblePluginPanels", value: visible, expectedRevision });
      },
    },
    async projectHost(projectId) {
      const p = (await bb.sdk.projects.get({ projectId })) as { sources?: Array<{ hostId: string; isDefault?: boolean }> };
      const s = p.sources?.find((x) => x.isDefault) ?? p.sources?.[0];
      if (!s) throw new Error("the project has no folder on any machine");
      return s.hostId;
    },
    tasks: {
      /** The tracker's `search` is a substring match on title, description and key (canceled tasks included); the marker is then checked exactly in the description. */
      async findByMarker(tasksProjectId, marker) {
        const out: TaskRef[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 100; page++) {
          const input: Record<string, unknown> = { projectId: tasksProjectId, search: marker, limit: 500, ...(cursor ? { cursor } : {}) };
          const r = await tasksRpc("listTasks", input, listTasksOut);
          for (const t of r.tasks) if (t.description?.includes(marker)) out.push({ id: t.id, key: t.key, projectId: t.projectId, title: t.title });
          cursor = r.nextCursor ?? null;
          if (!cursor) return out;
        }
        throw new Error(`task lookup by marker ${marker}: more than 100 pages — cannot confirm`);
      },
      async byKey(key) {
        const r = await tasksRpc("getTaskByKey", { taskKey: key }, taskByKeyOut);
        return r.task ? { id: r.task.id, key: r.task.key, projectId: r.task.projectId, title: r.task.title } : null;
      },
      async linkedProject(bbProjectId) {
        const { projects } = await tasksRpc("listProjects", {}, listProjectsOut);
        return projects.find((p) => p.linkedBbProjectId === bbProjectId)?.id ?? null;
      },
      async linkedBbProject(tasksProjectId) {
        const { projects } = await tasksRpc("listProjects", {}, listProjectsOut);
        return projects.find((p) => p.id === tasksProjectId)?.linkedBbProjectId ?? null;
      },
      // What goes to the tracker is redacted: token-shaped text in a request or a note does not end up in a task.
      create: (a) => mutate("createTask", { projectId: a.tasksProjectId, title: redact(a.title), description: redact(a.description), status: "todo", priority: "medium" }),
      async setStatus(taskId, status: TaskStatus) {
        await mutate("updateTask", { taskId, status, authorName: "Plugin Workshop" });
      },
      async comment(taskId, body) {
        // Without a signature the tracker would show «You» as the author.
        await tasksRpc("createComment", { taskId, body: `Plugin Workshop: ${redact(body)}`, notify: false }, anyOut);
      },
      async attach(taskId, threadId) {
        await tasksRpc("taskThreadsAttach", { taskId, threadId }, anyOut);
      },
    },
    plugins: {
      async list(): Promise<InstalledPlugin[]> {
        const { plugins } = parseOrLog(pluginListOut, await bb.sdk.plugins.list(), "plugins.list", warnLog);
        return plugins
          .filter((p) => !p.source.startsWith("builtin:"))
          .map((p) => ({ id: p.id, name: p.name ?? null, state: p.status, enabled: p.enabled, source: p.source, rootDir: p.rootDir ?? null, error: p.statusDetail ?? null }));
      },
      async folders() {
        const root = opts.pluginsRoot ?? PLUGINS_ROOT;
        const entries = await readdir(root, { withFileTypes: true }).catch((e: unknown) => {
          if (missing(e)) return [];
          throw e;
        });
        const out: Array<{ id: string; dir: string; name: string | null }> = [];
        for (const e of entries) {
          if (!e.name.startsWith("bb-plugin-") || e.name === "bb-plugin-") continue;
          const dir = join(root, e.name);
          const isDir = e.isDirectory() || (e.isSymbolicLink() && (await stat(dir).then((s) => s.isDirectory(), () => false)));
          if (!isDir) continue;
          const manifest = await readFile(join(dir, "package.json"), "utf8")
            .then((t) => JSON.parse(t) as { bb?: { name?: unknown } } | null)
            .catch(() => null);
          const name = typeof manifest?.bb?.name === "string" ? manifest.bb.name : null;
          out.push({ id: e.name.slice("bb-plugin-".length), dir, name });
        }
        return out;
      },
      /** The source in the form of the CLI and `InstalledPlugin.source` (`path:<folder>`): while a job with the same string is running, bb returns that job. */
      async startInstall(dir) {
        const p = sourcePath(dir);
        if (!p) throw new Error(`install: an absolute folder path is required, not «${dir}»`);
        return jobOf(await bb.sdk.plugins.startInstall({ source: `path:${p}` }), warnLog).id;
      },
      async job(id) {
        try {
          return jobOf(await bb.sdk.plugins.installJobs.get({ jobId: id }), warnLog);
        } catch (e) {
          if (UNKNOWN_JOB.test(errText(e))) return null;
          throw e;
        }
      },
      async jobs() {
        const list = await bb.sdk.plugins.installJobs.list();
        return z.array(z.unknown()).parse(list).map((j) => jobOf(j, warnLog));
      },
      async cancelJob(id) {
        await bb.sdk.plugins.installJobs.cancel({ jobId: id });
      },
      async enable(id) {
        await bb.sdk.plugins.enable({ pluginId: id });
      },
      async disable(id) {
        await bb.sdk.plugins.disable({ pluginId: id });
      },
    },
    deps: {
      async state(dir) {
        const want = await depsWant(dir);
        if (want === null) return { kind: "ok" };
        const mark = await readFile(join(dir, "node_modules", DEPS_MARK), "utf8").catch(() => null);
        if (mark?.trim() === want) return { kind: "ok" };
        const base = depsBase(dir);
        const run = await readFile(`${base}.json`, "utf8")
          .then((t) => JSON.parse(t) as { want: string; pid: number; startedAt: number })
          .catch(() => null);
        if (!run || run.want !== want) return { kind: "need" };
        const exit = await readFile(`${base}.exit`, "utf8").catch(() => null);
        // npm's log ends up in an attempt error and on the card: token-shaped text is redacted.
        const tail = async () => redact(clipTail(await readFile(`${base}.log`, "utf8").catch(() => ""), 600));
        if (exit === null) {
          if (!(await depsAlive(run.pid, dir, want, base))) return { kind: "failed", text: `the install process vanished; npm: ${await tail()}`, startedAt: run.startedAt };
          if (Date.now() - run.startedAt <= DEPS_MAX_MS) return { kind: "running" };
          try {
            process.kill(-run.pid, "SIGTERM");
          } catch {
            /* already exited */
          }
          return { kind: "failed", text: `install ran longer than ${DEPS_MAX_MS / 60_000} minutes — killed; npm: ${await tail()}`, startedAt: run.startedAt };
        }
        const code = exit.trim();
        if (code === "0") return { kind: "failed", text: "npm finished without an error, but the install marker is missing — someone touched node_modules", startedAt: run.startedAt };
        return { kind: "failed", text: `npm exited with code ${code}: ${await tail()}`, startedAt: run.startedAt };
      },
      async start(dir) {
        const want = await depsWant(dir);
        if (want === null) return;
        await mkdir(depsDir, { recursive: true });
        const base = depsBase(dir);
        for (const ext of [".exit", ".exit.tmp", ".json"]) await rm(`${base}${ext}`, { force: true });
        const child = spawn("sh", ["-c", DEPS_SCRIPT, "workshop-deps", dir, want, base, npmBin], { detached: true, stdio: "ignore" });
        child.on("error", (e) => warnLog(`dependency install in ${dir} failed to start: ${errText(e)}`));
        child.unref();
        if (child.pid === undefined) throw new Error(`dependency install in ${dir} failed to start`);
        await writeFile(`${base}.json`, JSON.stringify({ want, pid: child.pid, startedAt: Date.now() }));
      },
    },
    lock: {
      /**
       * The claim with its token (atomically, so the holder never reads half of it), then a foreign mark is removed — the holder of the
       * previous generation sees a foreign token and exits by itself; a new holder is started only if no live holder of this generation exists.
       */
      async request(attemptId, token) {
        const id = safeName("attempt", attemptId);
        safeName("token", token);
        await mkdir(locksDir, { recursive: true });
        await mkdir(dirname(buildLock), { recursive: true }); // `flock` creates the lock file itself, but not its folder
        await writeFile(`${wantPath(id)}.tmp`, token);
        await rename(`${wantPath(id)}.tmp`, wantPath(id));
        const m = await mark(id);
        if (m && m.token !== token) await rm(heldPath(id), { force: true });
        if (await generationAlive(id, token)) return;
        // No `-o`: `sh` inherits the lock descriptor, so the lock is held as long as `sh` lives.
        const child = spawn("flock", ["-w", "900", buildLock, "sh", "-c", HOLDER_SCRIPT, "workshop-holder", id, token], { detached: true, stdio: "ignore" });
        child.on("error", (e) => warnLog(`build lock holder for ${id} failed to start: ${errText(e)}`));
        child.unref();
      },
      async state(attemptId, token): Promise<HolderState> {
        const id = safeName("attempt", attemptId);
        safeName("token", token);
        const m = await mark(id);
        if (m && m.token === token && (await holderAlive(m.pid, id, token))) return "held";
        return (await generationAlive(id, token)) ? "waiting" : "none";
      },
      async release(attemptId) {
        await rm(wantPath(safeName("attempt", attemptId)), { force: true });
      },
      async sweep(keep) {
        const names = await readdir(locksDir).catch((e: unknown) => {
          if (missing(e)) return [] as string[];
          throw e;
        });
        for (const n of names) {
          const m = /^(.+?)\.(want|held|want\.tmp)$/.exec(n);
          if (m && !keep.includes(m[1]!)) await rm(join(locksDir, n), { force: true });
        }
      },
    },
    git: {
      /** Git means the folder's own repository only: a folder inside some other repository (or a missing folder) is "no git". */
      async facts(dir): Promise<GitFacts> {
        const none: GitFacts = { hasGit: false, branch: null, head: null, dirtyCount: 0 };
        const real = await realpath(dir).catch((e: unknown) => {
          if (missing(e)) return null;
          throw e;
        });
        if (real === null) return none;
        const top = await gitRun(dir, ["rev-parse", "--show-toplevel"], GIT_READ);
        if (top.code !== 0) {
          if (/not a git repository/i.test(top.stderr)) return none;
          throw new Error(`git rev-parse in ${dir}: ${top.stderr.trim() || `exit code ${top.code}`}`);
        }
        if ((await realpath(top.stdout.trim())) !== real) return none;
        // `symbolic-ref`, not `rev-parse --abbrev-ref`: a repository without commits already has a branch but no HEAD yet.
        const branch = await gitRun(dir, ["symbolic-ref", "-q", "--short", "HEAD"], GIT_READ);
        const head = await gitRun(dir, ["rev-parse", "-q", "--verify", "HEAD"], GIT_READ);
        return {
          hasGit: true,
          branch: branch.code === 0 ? branch.stdout.trim() || null : null,
          head: head.code === 0 ? head.stdout.trim() : null,
          dirtyCount: (await ports.git.statusLines(dir)).length,
        };
      },
      /** An unknown commit is not an ancestor (same as in the fake); not a repository — throws. */
      async isAncestor(dir, ancestor, descendant) {
        await gitOut(dir, ["rev-parse", "--git-dir"], GIT_READ);
        for (const sha of [ancestor, descendant]) if ((await gitRun(dir, ["cat-file", "-e", `${sha}^{commit}`], GIT_READ)).code !== 0) return false;
        return gitSame(dir, ["merge-base", "--is-ancestor", ancestor, descendant]);
      },
      async diffNames(dir, from, to) {
        const out = await gitOut(dir, ["diff", "--name-only", from, to], GIT_READ);
        return out.split("\n").map((l) => l.trim()).filter(Boolean);
      },
      async diffText(dir, from, to, max) {
        const out = await gitOut(dir, ["diff", "--no-color", "--no-ext-diff", from, to], GIT_READ);
        return out.length > max ? out.slice(0, max) : out;
      },
      /** Working files and index exactly as in sha, and no new (non-ignored) files. */
      async copyEquals(dir, sha) {
        if (!(await gitSame(dir, ["diff", "--quiet", "--no-ext-diff", sha, "--"]))) return false;
        if (!(await gitSame(dir, ["diff", "--cached", "--quiet", "--no-ext-diff", sha, "--"]))) return false;
        return (await gitOut(dir, ["ls-files", "--others", "--exclude-standard", "-z"], GIT_READ)) === "";
      },
      /** A refusal carries git's text: which file is in the way or what is locked (`index.lock`). */
      async resetKeep(dir, sha) {
        const r = await gitRun(dir, ["reset", "-q", "--keep", sha]);
        return r.code === 0 ? "ok" : { refused: (r.stderr || r.stdout).trim() || `exit code ${r.code}` };
      },
      async statusLines(dir) {
        return (await gitOut(dir, ["status", "--porcelain", "--untracked-files=normal"], GIT_READ)).split("\n").filter(Boolean);
      },
      async resetHard(dir, sha) {
        await gitOut(dir, ["reset", "-q", "--hard", sha]);
      },
      async updateRef(dir, ref, sha) {
        await gitOut(dir, ["update-ref", ref, sha]);
      },
      async initCommit(dir, message) {
        if (!(await ports.git.facts(dir)).hasGit) await gitOut(dir, ["init", "-q", "-b", "main"]);
        await gitOut(dir, ["add", "-A"]);
        await gitOut(dir, ["commit", "-q", "--no-verify", "--allow-empty", "-m", message]);
        return (await gitOut(dir, ["rev-parse", "HEAD"])).trim();
      },
      /** Commits what `staged` collected (the same procedure as `changedFiles`): `write-tree`, `commit-tree -p HEAD`, `update-ref`. */
      async snapshotTree(dir, ref, exclude, skip) {
        return staged(dir, exclude, skip, "real", async (st) => {
          const tree = (await gitOut(dir, ["write-tree"], st.env)).trim();
          const sha = (await gitOut(dir, ["commit-tree", tree, ...(st.parent ? ["-p", st.parent] : []), "-m", `Plugin Workshop: snapshot ${ref}`], st.env)).trim();
          await gitOut(dir, ["update-ref", ref, sha]);
          return { sha, files: st.files, nested: st.nested };
        });
      },
      /**
       * The index captured once: a copy of the index file (git replaces it by a rename, so the copy is one whole state; the real index and its
       * lock are untouched), `write-tree` of the copy, and the paths that differ between HEAD (the empty tree without commits) and that tree,
       * with the blob ids of both sides. No replacement objects, no grafts: the ids are the stored objects themselves.
       */
      async stagedState(dir) {
        const indexPath = (await gitOut(dir, ["rev-parse", "--path-format=absolute", "--git-path", "index"], GIT_READ)).trim();
        const h = await gitRun(dir, [NO_REPLACE, "rev-parse", "-q", "--verify", "HEAD^{commit}"], GIT_EXACT);
        if (h.code !== 0 && h.code !== 1) throw new Error(`git rev-parse HEAD in ${dir}: ${h.stderr.trim() || `exit code ${h.code}`}`);
        const base = h.code === 0 ? h.stdout.trim() : EMPTY_TREE;
        const tmp = await mkdtemp(join(tmpdir(), "workshop-staged-"));
        try {
          const copy = join(tmp, "index");
          const bytes = await readFile(indexPath).catch((e: unknown) => {
            if (missing(e)) return null;
            throw e;
          });
          // No index file at all: git reads a missing one as an empty index.
          if (bytes !== null) await writeFile(copy, bytes, { mode: 0o600 });
          // `core.splitIndex=false`: the copy is written back whole, nothing new appears next to the real index.
          const tree = (await gitOut(dir, ["-c", "core.splitIndex=false", NO_REPLACE, "write-tree"], { ...GIT_EXACT, GIT_INDEX_FILE: copy })).trim();
          const raw = await gitOut(dir, [NO_REPLACE, "diff-tree", "-r", "-z", "--no-renames", "--no-abbrev", base, tree], GIT_EXACT);
          return { base, tree, paths: rawEntries(raw).map((e) => ({ path: e.path, old: e.oldBlob, new: e.newBlob })) };
        } finally {
          await rm(tmp, { recursive: true, force: true });
        }
      },
      /**
       * The patch of a captured state: `diff --binary --full-index <base> <tree>` of exactly these paths (`:(literal)` pathspecs: a name with `*`,
       * `:` or `[` is that file only). No paths — no git call: `--` with nothing after it would be every path.
       */
      async stagedPatch(dir, base, tree, paths) {
        if (paths.length === 0) return "";
        if (!FULL_SHA.test(base) || !FULL_SHA.test(tree)) throw new Error("git diff: a tree id is malformed");
        const specs = paths.map((p) => `:(literal)${p}`);
        return gitOut(dir, [NO_REPLACE, "diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", base, tree, "--", ...specs], GIT_EXACT);
      },
      /** The raw bytes of these blobs (`cat-file --batch`, no replacement objects). A missing object, another type, more than `maxBytes` in all — throws. */
      async readBlobs(dir, ids, maxBytes) {
        const want = [...new Set(ids)];
        if (want.length === 0) return new Map<string, Buffer>();
        if (want.some((id) => !FULL_SHA.test(id))) throw new Error("git cat-file: an object id is malformed");
        // The cap is on the content; each answer adds a header line of at most ~100 bytes.
        const out = await runBytes("git", [NO_REPLACE, "-C", dir, "cat-file", "--batch"], `${want.join("\n")}\n`, { env: GIT_EXACT, timeout: 5 * 60_000, maxBytes: maxBytes + want.length * 100 });
        const blobs = batchBlobs(out, want);
        if ([...blobs.values()].reduce((n, b) => n + b.length, 0) > maxBytes) throw new Error(`more than ${Math.round(maxBytes / 1024 / 1024)} MB of content`);
        return blobs;
      },
      /**
       * Exactly what `snapshotTree` will take: the same temporary index, not the real one. Through the real index, files with `--skip-worktree`,
       * `--assume-unchanged` or untracked by `rm --cached` under `.gitignore` would look unchanged, and the snapshot would take them unchecked.
       * Objects of the check pass's `add -A` go to a temporary store: files the check later rejects are never written to the repository.
       */
      async changedFiles(dir, exclude) {
        return staged(dir, exclude, [], "scratch", async (st) => st.files);
      },
    },
    github: {
      async remote(dir) {
        const r = await gitRun(dir, ["remote", "get-url", "origin"], GIT_READ);
        if (r.code === 0) return r.stdout.trim() || null;
        if (/no such remote/i.test(r.stderr)) return null;
        throw new Error(`git remote get-url in ${dir}: ${r.stderr.trim() || `exit code ${r.code}`}`);
      },
      /** `--all`: a remote with several push URLs pushes to every one of them — the gate must see them all. */
      async pushUrls(dir) {
        const r = await gitRun(dir, ["remote", "get-url", "--push", "--all", "origin"], GIT_READ);
        if (r.code === 0) return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        if (/no such remote/i.test(r.stderr)) return [];
        throw new Error(`git remote get-url --push in ${dir}: ${r.stderr.trim() || `exit code ${r.code}`}`);
      },
      async repoInfo(owner, name) {
        const repo = `${safeRepoPart(owner)}/${safeRepoPart(name)}`;
        const r = await run("gh", ["repo", "view", repo, "--json", "visibility,owner,nameWithOwner"], { env: GH_ENV });
        if (r.code !== 0) {
          if (/could not resolve|not found/i.test(r.stderr)) return null;
          throw new Error(`gh repo view ${repo}: ${r.stderr.trim() || `exit code ${r.code}`}`);
        }
        const j = repoInfoOut.parse(JSON.parse(r.stdout));
        return { visibility: j.visibility, owner: j.owner.login, nameWithOwner: j.nameWithOwner };
      },
      async ensureRepo(owner, name, description) {
        const repo = `${safeRepoPart(owner)}/${safeRepoPart(name)}`;
        const seen = await run("gh", ["repo", "view", repo, "--json", "url", "--jq", ".url"], { env: GH_ENV });
        if (seen.code === 0 && seen.stdout.trim()) return `${seen.stdout.trim()}.git`;
        if (!/could not resolve|not found/i.test(seen.stderr)) throw new Error(`gh repo view ${repo}: ${seen.stderr.trim() || `exit code ${seen.code}`}`);
        const made = await run("gh", ["repo", "create", repo, "--private", "--disable-wiki", "--description", description.slice(0, 300)], { env: GH_ENV });
        if (made.code !== 0) throw new Error(`gh repo create ${repo}: ${made.stderr.trim() || `exit code ${made.code}`}`);
        return `https://github.com/${repo}.git`;
      },
      async setRemote(dir, url) {
        const now = await ports.github.remote(dir);
        if (now === url) return;
        if (now !== null) throw new Error(`${dir} already has a different origin: ${now}`);
        await gitOut(dir, ["remote", "add", "origin", url]);
      },
      // fetch, push and fast-forward of one folder run one at a time: two at once trip over ref locks (`refs/remotes/origin/*.lock`).
      async fetch(dir) {
        return netQueue(dir, async () => {
          const r = await run("git", ["-C", dir, "fetch", "-q", "--no-tags", "--prune", "origin"], { env: GIT_NET, timeout: NET_TIMEOUT_MS });
          if (r.code !== 0) throw new Error(`git fetch in ${dir}: ${r.stderr.trim() || `exit code ${r.code}`}`);
        });
      },
      /** The checked push URL itself, not `origin`'s fetch URL: what the destination has, not what some other repository has. */
      async remoteHeads(dir, url) {
        if (url.startsWith("-")) throw new Error(`ls-remote: not a repository URL: ${url}`);
        const r = await run("git", ["-C", dir, "ls-remote", url], { env: GIT_NET, timeout: NET_TIMEOUT_MS });
        if (r.code !== 0) throw new Error(`git ls-remote in ${dir}: ${r.stderr.trim() || `exit code ${r.code}`}`);
        const out = new Set<string>();
        for (const line of r.stdout.split("\n").filter(Boolean)) {
          const sha = line.split("\t")[0] ?? "";
          if (!FULL_SHA.test(sha)) throw new Error(`git ls-remote in ${dir}: unexpected line «${line.slice(0, 80)}»`);
          out.add(sha);
        }
        return [...out];
      },
      /** `rev-parse --is-shallow-repository`, read the same way as the scan: anything but `true` or `false` throws. */
      async shallow(dir) {
        const out = (await gitOut(dir, [NO_REPLACE, "rev-parse", "--is-shallow-repository"], GIT_EXACT)).trim();
        if (out !== "true" && out !== "false") throw new Error(`git rev-parse --is-shallow-repository in ${dir}: unexpected answer`);
        return out === "true";
      },
      // What the scan reads — the commit list, the paths and the content — is read on one graph: the stored objects and their real parents
      // (`NO_REPLACE` and `GIT_EXACT`: no replacement objects, no grafts), the graph the push sends.
      async outgoing(dir, sha, except) {
        if (!FULL_SHA.test(sha) || (await gitRun(dir, [NO_REPLACE, "cat-file", "-e", `${sha}^{commit}`], GIT_EXACT)).code !== 0) throw new Error(`${sha}: not a commit in ${dir}`);
        if (except.some((x) => !FULL_SHA.test(x))) throw new Error("rev-list: a destination commit id is malformed");
        const r = await runInput("git", [NO_REPLACE, "-C", dir, "rev-list", "--ignore-missing", "--stdin"], [sha, ...except.map((x) => `^${x}`)].join("\n") + "\n", { env: GIT_EXACT });
        if (r.code !== 0) throw new Error(`git rev-list in ${dir}: ${r.stderr.trim() || `exit code ${r.code}`}`);
        return r.stdout.split("\n").filter(Boolean);
      },
      async commitPaths(dir, commit) {
        if (!FULL_SHA.test(commit)) throw new Error(`diff-tree: not a commit id: ${commit}`);
        return splitZ(await gitOut(dir, [NO_REPLACE, "diff-tree", "-r", "-z", "--no-commit-id", "--name-only", "-m", "--root", commit], GIT_EXACT));
      },
      /**
       * Every outgoing commit's own changes, each merge against each parent (`--diff-merges=separate`, whatever `log.diffMerges` says), every
       * file as text (`-a`), no renames, no external diff or textconv, fixed prefixes and submodule format whatever the config says.
       */
      async logLines(dir, sha, except, maxBytes, onLine) {
        if (!FULL_SHA.test(sha) || except.some((x) => !FULL_SHA.test(x))) throw new Error("git log: a commit id is malformed");
        const args = [
          NO_REPLACE, "-C", dir, "log", "--ignore-missing", "--stdin", "-p", "--diff-merges=separate", "--root", "-a", "--no-ext-diff", "--no-textconv", "--no-color",
          "--no-renames", "--no-relative", "--src-prefix=a/", "--dst-prefix=b/", "--submodule=short", "--no-show-signature", `--format=${LOG_FORMAT}`,
        ];
        await streamLines("git", args, [sha, ...except.map((x) => `^${x}`)].join("\n") + "\n", { env: GIT_EXACT, timeout: 10 * 60_000, maxBytes }, onLine);
      },
      /**
       * Only with a clearance from the publication gate for this folder (used once), and only while `origin` still pushes to the URL the gate
       * checked. Exactly the cleared commit, an explicit refspec, no tags, no submodules, never `--force`; the same graph the scan read.
       */
      async push(dir, clearance, branch) {
        if (!takeClearance(clearance, dir)) throw new Error("push: no publication gate result for this folder and commit — nothing is pushed");
        if (!SAFE_BRANCH.test(branch)) throw new Error(`push: not a branch name the Workshop pushes to: «${branch}»`);
        const urls = await ports.github.pushUrls(dir);
        if (urls.length !== 1 || urls[0] !== clearance.url) throw new Error("push: origin's push URL changed after the check — nothing is pushed");
        return netQueue(dir, async () => {
          const r = await run("git", [NO_REPLACE, "-C", dir, "push", "-q", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", "origin", `${clearance.sha}:refs/heads/${branch}`], {
            env: GIT_PUSH,
            timeout: NET_TIMEOUT_MS,
          });
          if (r.code !== 0) throw new Error(`git push in ${dir}: ${(r.stderr || r.stdout).trim().slice(-500) || `exit code ${r.code}`}`);
        });
      },
      async deleteBranch(dir, branch) {
        if (!SAFE_BRANCH.test(branch)) throw new Error(`delete: not a branch name the Workshop pushes to: «${branch}»`);
        return netQueue(dir, async () => {
          const r = await run("git", ["-C", dir, "push", "-q", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", "origin", `:refs/heads/${branch}`], { env: GIT_NET, timeout: NET_TIMEOUT_MS });
          if (r.code !== 0) throw new Error(`git push in ${dir}: ${(r.stderr || r.stdout).trim().slice(-500) || `exit code ${r.code}`}`);
        });
      },
      async remoteSha(dir, branch) {
        const r = await gitRun(dir, ["rev-parse", "-q", "--verify", `refs/remotes/origin/${branch}^{commit}`], GIT_READ);
        return r.code === 0 ? r.stdout.trim() : null;
      },
      async counts(dir, a, b) {
        const out = (await gitOut(dir, ["rev-list", "--left-right", "--count", `${a}...${b}`], GIT_READ)).trim().split(/\s+/);
        return { ahead: Number(out[0] ?? 0), behind: Number(out[1] ?? 0) };
      },
      async ffOnly(dir, ref) {
        await netQueue(dir, () => gitOut(dir, ["merge", "-q", "--ff-only", ref]));
      },
      async prMerged(dir, branch) {
        const url = await ports.github.remote(dir);
        const repo = url ? repoOf(url) : null;
        if (!repo) return false;
        const r = await run("gh", ["pr", "list", "--repo", repo, "--head", branch, "--state", "merged", "--json", "number", "--jq", "length"], { env: GH_ENV });
        if (r.code !== 0) throw new Error(`gh pr list ${repo}: ${r.stderr.trim() || `exit code ${r.code}`}`);
        return Number(r.stdout.trim() || "0") > 0;
      },
      /** `repo` is the destination the gate checked; the caller keeps the returned address only if it is a PR of exactly that repository. */
      async openPr(_dir, repo, branch, title, body) {
        const r0 = githubRepo(`https://github.com/${repo}`);
        if (!r0 || !SAFE_BRANCH.test(branch)) throw new Error(`gh pr create: not a checked repository or branch: ${repo} ${branch}`);
        const open = await run("gh", ["pr", "list", "--repo", repo, "--head", branch, "--state", "open", "--json", "url", "--jq", ".[0].url"], { env: GH_ENV });
        if (open.code !== 0) throw new Error(`gh pr list ${repo}: ${open.stderr.trim() || `exit code ${open.code}`}`);
        if (open.stdout.trim()) return open.stdout.trim();
        const made = await run("gh", ["pr", "create", "--repo", repo, "--head", branch, "--base", MAIN_BRANCH, "--title", title, "--body", body], { env: GH_ENV });
        if (made.code !== 0) throw new Error(`gh pr create ${repo}: ${made.stderr.trim() || `exit code ${made.code}`}`);
        return made.stdout.trim().split("\n").pop() ?? "";
      },
    },
    projects: {
      /** Paths are compared after `realpath` (a nonexistent one after `resolve`): a symlink is the same folder. */
      async findByPath(hostId, dir) {
        const real = (p: string) => realpath(p).catch(() => resolve(p));
        const want = await real(dir);
        const out: string[] = [];
        for (const p of projectsOut.parse(await bb.sdk.projects.list())) {
          for (const s of p.sources ?? []) {
            if (s.hostId === hostId && (await real(s.path)) === want) {
              out.push(p.id);
              break;
            }
          }
        }
        return out;
      },
      async create(a) {
        return createdOut.parse(await bb.sdk.projects.create({ name: a.name, source: { type: "local_path", hostId: a.hostId, path: a.dir } })).id;
      },
    },
    fs: {
      /** Whether the path is taken, by `lstat`: even a dangling symlink takes the place. */
      async exists(p) {
        try {
          await lstat(p);
          return true;
        } catch (e) {
          if (missing(e)) return false;
          throw e;
        }
      },
      async rename(from, to) {
        if (!(await ports.fs.exists(from))) throw new Error(`rename ${from}: no such path`);
        if (await ports.fs.exists(to)) throw new Error(`rename ${to}: already exists`);
        if (!(await ports.fs.exists(dirname(to)))) throw new Error(`rename ${to}: no such folder ${dirname(to)}`);
        await rename(from, to);
      },
      async remove(p) {
        await rm(p, { recursive: true, force: true });
      },
      async list(dir) {
        return readdir(dir).catch((e: unknown) => {
          if (missing(e)) return [];
          throw e;
        });
      },
      async freeDiskGb(p) {
        const s = await statfs(p);
        return (s.bavail * s.bsize) / 1024 ** 3;
      },
      /**
       * `mkdir -p tmpDir`, then under the build lock (`flock -w 900`) in `tmpDir`: remove the nested folder an interrupted earlier run may
       * have left, and `bb plugin new <id>`, which creates `<tmpDir>/bb-plugin-<id>/`. `Creation` checks completeness.
       */
      async scaffold(id, tmpDir) {
        if (!PLUGIN_ID.test(id)) throw new Error(`scaffold: «${id}» is not a plugin id`);
        await mkdir(tmpDir, { recursive: true });
        const r = await run("flock", ["-w", "900", buildLock, "sh", "-c", SCAFFOLD_SCRIPT, "workshop-scaffold", id, bbBin], { cwd: tmpDir, timeout: SCAFFOLD_TIMEOUT_MS });
        if (r.code !== 0) throw new Error(`bb plugin new ${id}: exit code ${r.code}${(r.stderr || r.stdout).trim() ? ` — ${(r.stderr || r.stdout).trim().slice(-500)}` : ""}`);
      },
    },
    async saveText(workId, label, relPath, content) {
      const base = await worksDir(workId);
      const snap = inside(base, join(base, label));
      const out = inside(snap, join(snap, relPath));
      await mkdir(dirname(out), { recursive: true, mode: 0o700 });
      await writeFile(out, content, { mode: 0o600 });
    },
    /**
     * Enabled providers and their models: `providers.list` and `providers.models` (the same list as in the new-thread dialog). Providers are
     * queried in parallel, each for at most 10 s: a hung ACP provider does not hold up the form. One that returns no models stays, with a note.
     */
    async modelCatalog() {
      const list = (await bb.sdk.providers.list()) as Array<{ id: string; name?: string; displayName?: string }>;
      return Promise.all(
        list.map(async (p) => {
          const name = p.displayName || p.name || p.id;
          try {
            const r = (await withTimeout(bb.sdk.providers.models({ providerId: p.id }), 10_000, "no answer within 10 s")) as {
              models?: Array<{ model: string; displayName?: string; defaultReasoningEffort?: string; supportedReasoningEfforts?: Array<{ reasoningEffort: string }> }>;
              modelLoadError?: { code?: string; detail?: string | null } | null;
            };
            const models = (r.models ?? []).map((m) => ({
              id: m.model,
              label: m.displayName || m.model,
              efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
              defaultEffort: m.defaultReasoningEffort ?? null,
            }));
            const error = r.modelLoadError ? `${r.modelLoadError.code ?? "error"}${r.modelLoadError.detail ? `: ${r.modelLoadError.detail}` : ""}` : models.length === 0 ? "no models" : null;
            return { id: p.id, name, models, error };
          } catch (e) {
            return { id: p.id, name, models: [], error: errText(e) };
          }
        }),
      );
    },
    /** The machine the bb server runs on (`primaryHostId`): the plugin working copies live there. */
    async serverHostId() {
      if (serverHost) return serverHost;
      const c = configOut.parse(await bb.sdk.system.config());
      if (!c.primaryHostId) throw new Error("bb did not report its server machine (primaryHostId)");
      serverHost = c.primaryHostId;
      return serverHost;
    },
    changed: onChange,
  };
  return ports;
}
