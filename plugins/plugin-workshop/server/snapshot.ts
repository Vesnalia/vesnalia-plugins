import { SymlinkRefused, type Ports, type StagedState, type Withheld } from "./ports";
import { redact, SECRET_NAME_PATTERNS, secretFileName, secretFindings } from "./secrets";

export { findSecrets, redact, secretFileName, secretFindings } from "./secrets";

/** Never in the cancel snapshot, whatever the work's `.gitignore` says: dependencies, build output, the Workshop's working folders. */
const CANCEL_BASE: readonly string[] = ["node_modules/", "dist/", ".superpowers/"];

/**
 * What never goes into the cancel snapshot commit: `CANCEL_BASE` and key files by name (`SECRET_NAME_PATTERNS` — the one file-name rule).
 * Patterns as in `git.snapshotTree`: `name/` — a folder at any depth, `*` — any part of a name, without a slash — by file name.
 */
export const CANCEL_EXCLUDE: readonly string[] = Object.freeze([...CANCEL_BASE, ...SECRET_NAME_PATTERNS]);

/** The withheld label of a key file by name. */
export const BY_NAME = "key file by name";

/** At most this much staged content (both sides of every staged path in the patch) is read for its check; more — the patch is withheld unchecked. */
export const MAX_STAGED_BYTES = 64 * 1024 * 1024;

export interface CancelWork {
  id: string;
  task_key: string;
  environment_id: string;
  /** The work's working tree (worktree). */
  worktreeDir: string;
  /** The plugin's working copy: the snapshot ref lives in its repository. */
  pluginDir: string;
}
/**
 * `skipped` — files left out of the commit because of their content; `withheld` — everything left out and not kept anywhere (key files by
 * name, files with findings, the staged patch when it has a finding), with labels only; `patch` — what happened to `staged.patch`.
 * `nested` — nested repositories of the working tree: not in the snapshot (left as in HEAD) and not checked — names only.
 */
export type CancelResult =
  | { ok: true; sha: string; skipped: string[]; withheld: Withheld[]; patch: "saved" | "empty" | "withheld"; nested: string[] }
  | { ok: false; reason: string };

/**
 * Labels of secret indicators in a worktree file; `[]` — clean, the file is already gone, or it is a symbolic link (the commit keeps the
 * link itself, not what it points to). A binary file is read as latin1, so plain text inside it is visible.
 */
async function scanFile(ports: Ports, environmentId: string, rel: string): Promise<string[]> {
  let f: Awaited<ReturnType<Ports["readRaw"]>>;
  try {
    f = await ports.readRaw(environmentId, rel);
  } catch (e) {
    if (e instanceof SymlinkRefused) return [];
    throw e;
  }
  if (!f) return [];
  return secretFindings(f.encoding === "utf8" ? f.content : Buffer.from(f.content, "base64").toString("latin1"));
}

/**
 * `staged.patch` of the cancel snapshot, bound to one captured index state (`git.stagedState`): the patch is built from that state's tree,
 * and what is checked is exactly the blobs it carries — both sides of every path in it, raw bytes, binary included (a binary patch is
 * compressed: its text shows none of the content). Key files by name and `skipped` paths stay out of it (key files are added to `withheld`).
 * Any finding, content that cannot be read in full (more than `MAX_STAGED_BYTES`, a missing object) or a state that cannot be captured
 * (unmerged entries) withholds the whole patch: `ok: false` with labels only — `<path>: <label>` or why it was not checked.
 */
async function checkedStagedPatch(ports: Ports, dir: string, skipped: string[], withheld: Withheld[]): Promise<{ ok: true; patch: string } | { ok: false; labels: string[] }> {
  const why = (e: unknown) => redact(e instanceof Error ? e.message : String(e)).slice(0, 200);
  let state: StagedState;
  try {
    state = await ports.git.stagedState(dir);
  } catch (e) {
    return { ok: false, labels: [`staged changes not captured, not checked (${why(e)})`] };
  }
  for (const e of state.paths) if (secretFileName(e.path) && !withheld.some((x) => x.path === e.path)) withheld.push({ path: e.path, labels: [BY_NAME] });
  const allowed = state.paths.filter((e) => !secretFileName(e.path) && !skipped.includes(e.path));
  let blobs: Map<string, Buffer>;
  try {
    blobs = await ports.git.readBlobs(dir, allowed.flatMap((e) => [e.new, e.old].filter((id): id is string => id !== null)), MAX_STAGED_BYTES);
  } catch (e) {
    return { ok: false, labels: [`staged content not read in full, not checked (${why(e)})`] };
  }
  const found = new Set<string>();
  for (const e of allowed) {
    for (const [side, id] of [["staged", e.new], ["HEAD", e.old]] as const) {
      const bytes = id === null ? undefined : blobs.get(id);
      if (id !== null && bytes === undefined) return { ok: false, labels: [`staged content not read in full, not checked (${e.path})`] };
      // Raw bytes as latin1: plain text inside a binary file is visible to the patterns.
      if (bytes) for (const label of secretFindings(bytes.toString("latin1"))) found.add(`${e.path} (${side}): ${label}`);
    }
  }
  if (found.size > 0) return { ok: false, labels: [...found] };
  const patch = await ports.git.stagedPatch(dir, state.base, state.tree, allowed.map((e) => e.path));
  // The patch text itself once more (its headers and text hunks): the same patterns.
  const inPatch = secretFindings(patch);
  return inPatch.length > 0 ? { ok: false, labels: inPatch } : { ok: true, patch };
}

/**
 * Snapshot on work cancel: the whole working tree, including uncommitted and new files, as a commit under `refs/workshop/<KEY>/canceled`.
 * A secret is neither committed nor kept: key files by name and files whose content has a finding are left out of the commit and are not
 * copied anywhere — the snapshot's `manifest.json` (`<time>-canceled`) lists them with finding labels, never values. What is staged is kept
 * as `staged.patch` built from the non-secret paths only (`checkedStagedPatch`); if anything it carries has a finding, or cannot be read in full, it
 * is not saved either (the manifest says so).
 * Only files the commit would take (`changedFiles`) are checked: ignored files are not read, unchanged tracked ones are already in history.
 * Any failure returns `ok: false`: the worktree stays, and the caller does not remove it.
 */
export async function cancelSnapshot(ports: Ports, w: CancelWork): Promise<CancelResult> {
  const ref = `refs/workshop/${w.task_key}/canceled`;
  // Labels carry the time, like the engine's snapshots: without it, «canceled…» would shadow later snapshots in `readSaved`'s reverse sort.
  const at = ports.now();
  const label = `${at}-canceled`;
  let step = "file list";
  try {
    const withheld: Withheld[] = [];
    const skipped: string[] = [];
    // Key files are listed by name without being read; the rest is read and scanned.
    for (const rel of await ports.git.changedFiles(w.worktreeDir, [...CANCEL_BASE])) {
      if (secretFileName(rel)) {
        withheld.push({ path: rel, labels: [BY_NAME] });
        continue;
      }
      step = `checking ${rel}`;
      const found = await scanFile(ports, w.environment_id, rel);
      if (found.length > 0) {
        skipped.push(rel);
        withheld.push({ path: rel, labels: found });
      }
    }
    // What lives outside git comes first: if saving it fails, there is no commit at all.
    step = "staged.patch";
    const staged = await checkedStagedPatch(ports, w.worktreeDir, skipped, withheld);
    let patchState: "saved" | "empty" | "withheld";
    if (!staged.ok) {
      patchState = "withheld";
      withheld.push({ path: "staged.patch", labels: staged.labels });
    } else {
      await ports.saveText(w.id, label, "staged.patch", staged.patch);
      patchState = staged.patch === "" ? "empty" : "saved";
    }
    step = "manifest";
    await ports.saveText(w.id, label, "manifest.json", `${JSON.stringify({ ref, withheld, stagedPatch: patchState }, null, 2)}\n`);
    step = "snapshot commit";
    const { sha, nested } = await ports.git.snapshotTree(w.worktreeDir, ref, [...CANCEL_EXCLUDE], skipped);
    step = `ref ${ref}`;
    await ports.git.updateRef(w.pluginDir, ref, sha);
    return { ok: true, sha, skipped, withheld, patch: patchState, nested };
  } catch (e) {
    return { ok: false, reason: `cancel snapshot failed (${step}): ${e instanceof Error ? e.message : String(e)}` };
  }
}
