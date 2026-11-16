export type ReviewVerdict = "clear" | "blocking";
export type VerifyVerdict = "pass" | "fail";
export type TechVerdict = "ok" | "caveats" | "impossible";

const lastLine = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? "";

/** The review verdict — only the last non-empty line: `VERDICT: CLEAR | BLOCKING`. */
export function reviewVerdict(text: string): ReviewVerdict | null {
  const m = /^VERDICT:\s*(CLEAR|BLOCKING)\s*$/i.exec(lastLine(text));
  return m ? (m[1]!.toLowerCase() as ReviewVerdict) : null;
}

/** The verification verdict — only the last non-empty line: `VERDICT: PASS | FAIL`. */
export function verifyVerdict(text: string): VerifyVerdict | null {
  const m = /^VERDICT:\s*(PASS|FAIL)\s*$/i.exec(lastLine(text));
  return m ? (m[1]!.toLowerCase() as VerifyVerdict) : null;
}

/** The feasibility verdict — only the last non-empty line: `VERDICT: OK | OK_WITH_CAVEATS | IMPOSSIBLE`. */
export function techVerdict(text: string): TechVerdict | null {
  const m = /^VERDICT:\s*(OK_WITH_CAVEATS|OK|IMPOSSIBLE)\s*$/i.exec(lastLine(text));
  if (!m) return null;
  const v = m[1]!.toUpperCase();
  return v === "OK" ? "ok" : v === "IMPOSSIBLE" ? "impossible" : "caveats";
}

/**
 * Whether the work adds data migrations — a `MIGRATIONS: yes | no` line on its own in the spec.
 * No line, or lines that contradict each other — null: the gate does not guess.
 */
export function migrationsFlag(text: string): boolean | null {
  const flags = new Set([...text.matchAll(/^[ \t]*MIGRATIONS:[ \t]*(yes|no)[ \t]*$/gim)].map((m) => m[1]!.toLowerCase() === "yes"));
  return flags.size === 1 ? [...flags][0]! : null;
}

/** Number of plan tasks — `### Task N:` headings (as writing-plans writes them). */
export function planTaskCount(plan: string): number {
  return new Set([...plan.matchAll(/^###\s+Task\s+(\d+)\b/gim)].map((m) => m[1])).size;
}

/** Tasks done in the subagent-driven-development ledger: `Task N: complete` lines. */
export function ledgerDone(ledger: string): number {
  return new Set([...ledger.matchAll(/^Task\s+(\d+):\s+complete\b/gim)].map((m) => m[1])).size;
}

/** Plan step checkmarks change during implementation — they do not count towards the plan version. */
export function normalizePlan(text: string): string {
  return text.replace(/^(\s*[-*]\s+)\[[xX]\]/gm, "$1[ ]");
}

/**
 * The `owner.md` checklist — what is needed from the owner before implementation: open items (`- [ ] …`) and the number of checked ones (`- [x] …`).
 * Lines without a checkbox do not count: a plain "- nothing" means nothing is needed from the owner.
 */
export function ownerItems(text: string): { open: string[]; done: number } {
  const open: string[] = [];
  let done = 0;
  for (const m of text.matchAll(/^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+(.+?)[ \t]*$/gm)) {
    if (m[1] === " ") open.push(m[2]!);
    else done++;
  }
  return { open, done };
}

export interface NavLine {
  /** Section: `<plugin id>/<section id>`. */
  panel: string;
  /** The neighbouring section to go after; null — at the end of the bar. */
  after: string | null;
}
/**
 * The spec's `NAV:` lines: `NAV: <plugin>/<section> after <neighbour>`, `NAV: <plugin>/<section>` (at the end) or `NAV: none`.
 * null — no lines, or they contradict each other (`none` together with sections): the gate does not guess. `[]` — `NAV: none`.
 */
export function navLines(text: string): NavLine[] | null {
  const id = "[\\w.-]+/[\\w.-]+";
  const lines = [...text.matchAll(/^[ \t]*NAV:[ \t]*(.+?)[ \t]*$/gm)].map((m) => m[1]!);
  if (lines.length === 0) return null;
  const none = lines.filter((l) => /^none$/i.test(l)).length;
  const out: NavLine[] = [];
  for (const l of lines) {
    if (/^none$/i.test(l)) continue;
    const m = new RegExp(`^(${id})(?:[ \\t]+after[ \\t]+(${id}))?$`).exec(l);
    if (!m) return null;
    if (!out.some((x) => x.panel === m[1])) out.push({ panel: m[1]!, after: m[2] ?? null });
  }
  if (none > 0 && out.length > 0) return null;
  return out;
}

/**
 * The section order on the bar with the section in place: removed from where it stood and put right after the neighbour; no neighbour — at the end.
 * null — it is already there.
 */
export function placeAfter(order: readonly string[], panel: string, after: string | null): string[] | null {
  const rest = order.filter((p) => p !== panel);
  const at = after === null ? -1 : rest.indexOf(after);
  const next = at === -1 ? [...rest, panel] : [...rest.slice(0, at + 1), panel, ...rest.slice(at + 1)];
  return next.length === order.length && next.every((p, i) => p === order[i]) ? null : next;
}
