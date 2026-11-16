import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@vesnalia/plugin-sdk/host";
import { hostContract } from "./contract.js";
import { parseNumstat, type Lines } from "./lib/git-status.js";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `git ${args[0]} failed`)));
  });
}

function parseStatus(raw: string) {
  const parts = raw.split("\0");
  const files: Array<{ path: string; index: string; worktree: string }> = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const index = entry.slice(0, 1);
    const worktree = entry.slice(1, 2);
    const path = entry.slice(3);
    // Porcelain v1 -z writes a rename as "XY new\0old\0": keep the new path, skip the old one.
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") i += 1;
    files.push({ path, index, worktree });
  }
  return files;
}

// Untracked files have no diff to count, so count their lines directly. Capped so a
// large or binary file (or hundreds of them) can't slow the panel down.
const UNTRACKED_MAX_BYTES = 512_000;
const UNTRACKED_MAX_FILES = 200;

async function untrackedLines(cwd: string, path: string): Promise<Lines | null> {
  if (path.endsWith("/")) return null;
  try {
    const full = join(cwd, path);
    if ((await stat(full)).size > UNTRACKED_MAX_BYTES) return null;
    const text = await readFile(full, "utf8");
    if (text.includes("\0")) return null;
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    return { added: lines, removed: 0 };
  } catch {
    return null;
  }
}

async function remote(cwd: string) {
  const upstream = (await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => "")).trim() || null;
  if (!upstream) return { upstream, ahead: 0, behind: 0 };
  const [ahead, behind] = (await git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])).trim().split(/\s+/).map(Number);
  return { upstream, ahead: behind || 0, behind: ahead || 0 };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async status({ cwd }) {
      const [branch, branches, raw, remoteState, worktreeStat, stagedStat, stashCount, lastCommit] = await Promise.all([
        git(cwd, ["branch", "--show-current"]).then((value) => value.trim() || null),
        git(cwd, ["for-each-ref", "--format=%(refname)\t%(objectname:short)\t%(subject)", "refs/heads", "refs/remotes/origin"]).then((value) => value.split("\n").filter(Boolean).flatMap((line) => {
          const [ref, sha, subject] = line.split("\t");
          if (ref === "refs/remotes/origin/HEAD") return [];
          const scope = ref.startsWith("refs/heads/") ? "local" as const : "remote" as const;
          const name = scope === "local" ? ref.slice("refs/heads/".length) : ref.slice("refs/remotes/".length);
          return [{ name, scope, sha, subject }];
        })),
        git(cwd, ["status", "--porcelain=v1", "-z"]),
        remote(cwd),
        git(cwd, ["diff", "--numstat", "-z"]).catch(() => ""),
        git(cwd, ["diff", "--cached", "--numstat", "-z"]).catch(() => ""),
        git(cwd, ["stash", "list"]).then((value) => value.split("\n").filter(Boolean).length, () => 0),
        git(cwd, ["log", "-1", "--format=%h%x09%s"]).then((value) => {
          const [sha, ...subject] = value.trim().split("\t");
          return sha ? { sha, subject: subject.join("\t") } : null;
        }, () => null),
      ]);
      const worktreeCounts = parseNumstat(worktreeStat);
      const stagedCounts = parseNumstat(stagedStat);
      let untrackedRead = 0;
      const files = await Promise.all(parseStatus(raw).map(async (file) => {
        const untracked = file.index === "?";
        const worktreeLines = untracked
          ? untrackedRead++ < UNTRACKED_MAX_FILES ? await untrackedLines(cwd, file.path) : null
          : worktreeCounts.get(file.path) ?? null;
        return { ...file, stagedLines: stagedCounts.get(file.path) ?? null, worktreeLines };
      }));
      return { branch, branches, files, remote: remoteState, stashCount, lastCommit };
    },
    async stage({ cwd, paths }) { if (paths.length) await git(cwd, ["add", "--", ...paths]); return { ok: true }; },
    async unstage({ cwd, paths }) { if (paths.length) await git(cwd, ["restore", "--staged", "--", ...paths]); return { ok: true }; },
    async switchBranch({ cwd, branch }) {
      const dirty = await git(cwd, ["status", "--porcelain"]);
      if (dirty.trim()) throw new Error("Stage, commit, or stash changes before switching branches.");
      if (branch.startsWith("origin/")) {
        const local = branch.slice("origin/".length);
        const localExists = await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${local}`]).then(() => true, () => false);
        await git(cwd, localExists ? ["switch", "--", local] : ["switch", "--track", branch]);
      } else {
        await git(cwd, ["switch", "--", branch]);
      }
      return { ok: true };
    },
    // Branches off the current HEAD and checks it out; uncommitted work comes along.
    async createBranch({ cwd, branch }) { await git(cwd, ["switch", "-c", branch]); return { ok: true }; },
    // Local branches only; git refuses a remote-tracking ref, which is what we want.
    async renameBranch({ cwd, branch, name }) { await git(cwd, ["branch", "-m", branch, name]); return { ok: true }; },
    async pull({ cwd }) {
      await git(cwd, ["fetch", "--prune"]);
      const state = await remote(cwd);
      if (!state.upstream) throw new Error("This branch has no upstream remote.");
      if (state.ahead > 0 && state.behind > 0) throw new Error("Branch has diverged. Resolve it before pulling.");
      if (state.behind === 0) return { message: "Already up to date." };
      await git(cwd, ["pull", "--ff-only"]);
      return { message: "Pulled changes." };
    },
    async push({ cwd }) {
      const state = await remote(cwd);
      if (!state.upstream) throw new Error("This branch has no upstream remote.");
      if (state.behind > 0) throw new Error("Pull incoming commits before pushing.");
      if (state.ahead === 0) return { message: "Nothing to push." };
      await git(cwd, ["push"]);
      return { message: "Pushed changes." };
    },
    async fetch({ cwd }) {
      await git(cwd, ["fetch", "--prune"]);
      return { message: "Fetched from remote." };
    },
    // Fetch, replay local commits on top of incoming ones, then push. A conflict aborts
    // the rebase, which puts the branch (and autostashed changes) back as they were.
    async sync({ cwd }) {
      await git(cwd, ["fetch", "--prune"]);
      const before = await remote(cwd);
      if (!before.upstream) throw new Error("This branch has no upstream remote.");
      if (before.behind > 0) {
        try {
          await git(cwd, ["pull", "--rebase", "--autostash"]);
        } catch {
          await git(cwd, ["rebase", "--abort"]).catch(() => undefined);
          throw new Error("Sync stopped: your commits conflict with incoming ones. Nothing was changed — pull and resolve it manually.");
        }
      }
      const after = await remote(cwd);
      if (after.ahead > 0) await git(cwd, ["push"]);
      if (before.behind === 0 && after.ahead === 0) return { message: "Already in sync." };
      return { message: `Synced · pulled ${before.behind}, pushed ${after.ahead}.` };
    },
    // Soft reset: the commit goes away, its changes stay staged. Refused once the commit
    // is on the upstream, because undoing it would rewrite shared history.
    async undoCommit({ cwd }) {
      const head = await git(cwd, ["rev-parse", "--verify", "HEAD"]).catch(() => "");
      if (!head.trim()) throw new Error("There is no commit to undo.");
      const hasParent = await git(cwd, ["rev-parse", "--verify", "HEAD~1"]).then(() => true, () => false);
      if (!hasParent) throw new Error("The first commit can't be undone here.");
      const state = await remote(cwd);
      if (state.upstream && state.ahead === 0) throw new Error("The last commit is already pushed; undoing it would rewrite shared history.");
      const subject = (await git(cwd, ["log", "-1", "--format=%s"])).trim();
      await git(cwd, ["reset", "--soft", "HEAD~1"]);
      return { message: `Undid “${subject}” — its changes are staged.` };
    },
    async stash({ cwd }) {
      const dirty = await git(cwd, ["status", "--porcelain"]);
      if (!dirty.trim()) return { message: "Nothing to stash." };
      await git(cwd, ["stash", "push", "--include-untracked", "-m", `Git worktree · ${new Date().toISOString()}`]);
      return { message: "Stashed all changes." };
    },
    async stashPop({ cwd }) {
      const list = (await git(cwd, ["stash", "list"])).trim();
      if (!list) throw new Error("There are no stashes to pop.");
      try {
        await git(cwd, ["stash", "pop"]);
      } catch (error) {
        // git keeps the stash when it can't apply cleanly.
        throw new Error(`The stash didn't apply cleanly and was kept. ${error instanceof Error ? error.message : ""}`.trim());
      }
      return { message: "Applied and dropped the latest stash." };
    },
  },
});
