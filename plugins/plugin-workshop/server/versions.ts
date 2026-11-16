import { atOrAfter, isCodeStage, pos } from "./stages";

/** The result version: stage handovers and round results are bound to it. */
export interface Version {
  iteration: number;
  headSha: string | null;
  /** The worktree has uncommitted changes. */
  dirty: boolean;
  contextSha: string | null;
  techSha: string | null;
  /** Hash of tz.md without step checkmarks (`normalizePlan`). */
  tzSha: string | null;
  /**
   * Hash of the mockup text files (`mockup/`); null — no mockup. Versions recorded before the «Mockup» stage existed lack the field — the
   * same as null: old works have no mockup.
   */
  mockupSha?: string | null;
}

const mockupOf = (v: Version) => v.mockupSha ?? null;

export function sameVersion(a: Version, b: Version | null): boolean {
  return (
    b !== null && a.iteration === b.iteration && a.headSha === b.headSha && a.dirty === b.dirty && a.contextSha === b.contextSha && a.techSha === b.techSha && a.tzSha === b.tzSha &&
    mockupOf(a) === mockupOf(b)
  );
}

export function parseVersion(raw: string | null): Version | null {
  return raw ? (JSON.parse(raw) as Version) : null;
}

const short = (s: string | null) => (s ? s.slice(0, 7) : "—");

/**
 * Stages whose latest handover no longer holds against the current version — judged by what the stage relied on:
 * Context — `context.md`; Feasibility — also `tech.md`; Spec — also `tz.md`; Mockup — also the mockup; from Implementation on — the code too.
 * A change to what comes after a stage (in work order, not by number) does not affect it: the feasibility check changed — the spec is stale, the context is not.
 */
export function staleStages(approvals: Array<{ stage: number; version: Version | null }>, current: Version): number[] {
  const latest = new Map<number, Version>();
  for (const a of approvals) if (a.version) latest.set(a.stage, a.version);
  const out: number[] = [];
  for (const [stage, v] of latest) {
    const context = v.contextSha !== current.contextSha;
    const tech = atOrAfter(stage, 2) && v.techSha !== current.techSha;
    const tz = atOrAfter(stage, 3) && v.tzSha !== current.tzSha;
    const mockup = atOrAfter(stage, 7) && mockupOf(v) !== mockupOf(current);
    const code = isCodeStage(stage) && v.headSha !== current.headSha;
    if (context || tech || tz || mockup || code) out.push(stage);
  }
  return out.sort((a, b) => pos(a) - pos(b));
}

/**
 * Whether a round result (review, verification report) holds against the current version; null — it holds.
 * Documents (Context, Feasibility, Spec, Mockup): within the iteration — after a review the agent edits the documents to close the items.
 * Code (Implementation, Verification, Rollout): the same HEAD and a clean tree.
 */
export function resultHolds(stage: number, input: Version | null, current: Version): string | null {
  if (!input) return "the version the round ran on is unknown";
  if (input.iteration !== current.iteration) return `the round ran on iteration ${input.iteration}, now it is ${current.iteration}`;
  if (isCodeStage(stage)) {
    if (input.dirty) return "the round ran on an uncommitted tree";
    if (input.headSha !== current.headSha) return `the code changed (${short(input.headSha)} → ${short(current.headSha)})`;
    if (current.dirty) return "the worktree has uncommitted changes";
  }
  return null;
}
