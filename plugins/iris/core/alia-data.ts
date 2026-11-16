// Live data from VesnALIA itself, for any card: load("VesnALIA:<source>").
//
// The plugin's server reads VesnALIA through the plugin SDK, scoped to the card's own
// thread (its project and the threads it spawned), and the card draws it with any
// component. Inside a live card it re-reads every 2 s like a file.

export const ALIA_DATA_PREFIX = "alia:";

export interface AliaSourceSpec {
  name: string;
  /** Whether it needs the card's thread (anything about threads, git or PRs). */
  thread: boolean;
  summary: string;
}

/** Every source, with what it returns, for the prompt, iris_docs and the gallery. */
export const ALIA_SOURCES: readonly AliaSourceSpec[] = [
  { name: "thread", thread: true, summary: "this thread: {id, title, status, waitingOnYou, queued, context: {used, window, percent, model, categories: [{label, tokens}]}, cost: {amount, currency} | null}" },
  { name: "threads", thread: true, summary: "threads this thread started (scope=project: the project's top-level threads; usage=1 adds context and cost): [{id, title, status, waitingOnYou, queuedWork: none|waiting|failed, updatedAt, branch, context?, cost?}]" },
  { name: "usage", thread: false, summary: "plan usage windows per provider: [{provider, plan, label, usedPercent, resetsAt, spentUsd, limitUsd}]" },
  { name: "commits", thread: true, summary: "this branch's commits since its base: {branch, base, ahead, behind, commits: [{sha, subject, author, at}]}" },
  { name: "pr", thread: true, summary: "this branch's pull request: {number, title, url, state, draft, checks: {state, passed, failed, pending}, review, mergeable}" },
  { name: "changes", thread: true, summary: "files changed on this branch, uncommitted included: {files: [{path, status, added, removed}], added, removed}" },
  { name: "environments", thread: true, summary: "the project's worktrees: [{branch, threads, changedFiles, pullRequest}]" },
  { name: "machines", thread: false, summary: "alia machines: [{name, status, lastSeenAt}]" },
  { name: "plugins", thread: false, summary: "installed plugins and their health: [{id, version, status, detail}]" },
  { name: "terminals", thread: true, summary: "this thread's terminals (output=1 adds the last 4 KB each prints, output=16000 up to 16 KB; draw it with Logs): [{id, title, status: starting|running|exited|disconnected, exitCode, cwd, createdAt, output?}]" },
];

export function isAliaSource(path: string): boolean {
  return path.startsWith(ALIA_DATA_PREFIX);
}

export function parseAliaSource(spec: string): { ok: true; name: string; query: Record<string, string> } | { ok: false; error: string } {
  if (!isAliaSource(spec)) return { ok: false, error: "not a VesnALIA source" };
  const rest = spec.slice(ALIA_DATA_PREFIX.length);
  const q = rest.indexOf("?");
  const name = (q >= 0 ? rest.slice(0, q) : rest).trim();
  if (!ALIA_SOURCES.some((s) => s.name === name)) return { ok: false, error: `"VesnALIA:${name}" isn't a VesnALIA source; there are ${ALIA_SOURCES.map((s) => `alia:${s.name}`).join(", ")}` };
  const query: Record<string, string> = {};
  if (q >= 0) {
    for (const pair of rest.slice(q + 1).split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const k = eq >= 0 ? pair.slice(0, eq) : pair;
      const v = eq >= 0 ? pair.slice(eq + 1) : "1";
      if (!/^[a-z]{1,20}$/.test(k)) return { ok: false, error: `"${k}" isn't an option of VesnALIA:${name}` };
      try {
        query[k] = decodeURIComponent(v.replace(/\+/g, " ")).slice(0, 100);
      } catch {
        return { ok: false, error: `the value of "${k}" has a broken escape` };
      }
    }
  }
  return { ok: true, name, query };
}
