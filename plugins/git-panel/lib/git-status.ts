// What the Git worktree panel derives from raw Git output: per-file status letters and
// tones, name/folder splits, line counts from `git diff --numstat -z`, and the status
// bar's summary with the one next action. Pure, so the host, the app and tests share it.

export type Lines = { added: number | null; removed: number | null };
export type GitFile = {
  path: string;
  index: string;
  worktree: string;
  stagedLines: Lines | null;
  worktreeLines: Lines | null;
};
export type StatusTone = "modified" | "added" | "deleted" | "renamed" | "conflict";
export type Status = { letter: string; label: string; tone: StatusTone };

// VS Code's letters: untracked reads as U, conflicts as "!".
const STATUS: Record<string, Status> = {
  M: { letter: "M", label: "Modified", tone: "modified" },
  T: { letter: "T", label: "Type changed", tone: "modified" },
  A: { letter: "A", label: "Added", tone: "added" },
  "?": { letter: "U", label: "Untracked", tone: "added" },
  D: { letter: "D", label: "Deleted", tone: "deleted" },
  R: { letter: "R", label: "Renamed", tone: "renamed" },
  C: { letter: "C", label: "Copied", tone: "renamed" },
  U: { letter: "!", label: "Conflict", tone: "conflict" },
};

export function statusOf(code: string): Status {
  return STATUS[code] ?? { letter: code.trim() || "•", label: "Changed", tone: "modified" };
}

/** "src/app/page.tsx" → { name: "page.tsx", dir: "src/app" }. Renames show their new path. */
export function fileParts(path: string): { name: string; dir: string } {
  const arrow = path.lastIndexOf(" -> ");
  const target = (arrow === -1 ? path : path.slice(arrow + 4)).replace(/\/+$/, "");
  const slash = target.lastIndexOf("/");
  return slash === -1 ? { name: target, dir: "" } : { name: target.slice(slash + 1), dir: target.slice(0, slash) };
}

/**
 * `git diff --numstat -z` → line counts by path. Records are "added\tremoved\tpath\0";
 * a rename leaves the path empty and follows with "old\0new\0". Binary files report
 * "-" and come back as null counts.
 */
export function parseNumstat(raw: string): Map<string, Lines> {
  const counts = new Map<string, Lines>();
  const parts = raw.split("\0");
  const count = (value: string | undefined) => {
    const n = Number(value);
    return value === undefined || value === "-" || !Number.isFinite(n) ? null : n;
  };
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (!entry) continue;
    const [added, removed, ...rest] = entry.split("\t");
    let path = rest.join("\t");
    if (path === "") {
      i += 2;
      path = parts[i] ?? "";
    }
    if (path !== "") counts.set(path, { added: count(added), removed: count(removed) });
  }
  return counts;
}

export type SummaryTone = "success" | "accent" | "warning" | "muted";
export type NextAction = "commit" | "push" | "pull" | "sync" | "stage-all" | null;

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** The status bar: what state the worktree is in and the single most useful next step. */
export function summaryOf(state: {
  staged: number;
  changed: number;
  ahead: number;
  behind: number;
  upstream: string | null;
}): { tone: SummaryTone; label: string; action: NextAction } {
  const { staged, changed, ahead, behind, upstream } = state;
  const tracked = upstream !== null;
  if (tracked && ahead > 0 && behind > 0) return { tone: "warning", label: `${ahead} ahead · ${behind} behind`, action: "sync" };
  if (staged > 0) return { tone: "success", label: "Ready to commit", action: "commit" };
  if (tracked && behind > 0) return { tone: "warning", label: `${plural(behind, "commit")} to pull`, action: "pull" };
  if (tracked && ahead > 0) return { tone: "accent", label: `${plural(ahead, "commit")} to push`, action: "push" };
  if (changed > 0) return { tone: "muted", label: plural(changed, "unstaged change"), action: "stage-all" };
  if (!tracked) return { tone: "muted", label: "No upstream", action: null };
  return { tone: "success", label: "No new changes", action: null };
}
