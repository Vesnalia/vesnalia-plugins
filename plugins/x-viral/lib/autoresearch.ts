// The autoresearch loop: propose an edit, evaluate it with the scorer, keep
// it only if the score improves, repeat until nothing helps.
import type { PostContext } from "./features";
import { scorePost, type ScoreReport } from "./scorer";
import { TRANSFORMS, type Transform } from "./transforms";

export interface Suggestion {
  id: string;
  kind: "text" | "context";
  title: string;
  why: string;
  source?: string;
  /** Score if this single change were applied to the current post. */
  projectedScore: number;
  delta: number;
}

export interface Step {
  iteration: number;
  transformId: string;
  title: string;
  note: string;
  before: number;
  after: number;
  text: string;
}

export interface AutoresearchResult {
  original: ScoreReport;
  final: ScoreReport;
  steps: Step[];
  /** Text to post as the first reply, if a transform moved something there. */
  replyText?: string;
  /** Publishing changes that are not text edits, each with its projected score. */
  projections: Suggestion[];
  /** Text edits that were tried but did not improve the score. */
  rejected: string[];
}

export interface AutoresearchOptions {
  maxIterations?: number;
  /** Minimum score gain for a step to be kept. */
  minGain?: number;
  /** Transform ids to skip. */
  exclude?: string[];
}

export function suggestions(report: ScoreReport, exclude: string[] = []): Suggestion[] {
  const out: Suggestion[] = [];
  for (const t of TRANSFORMS) {
    if (exclude.includes(t.id) || !t.applies(report.features, report.context)) continue;
    const result = t.apply(report.text, report.context);
    if (result.text === report.text && JSON.stringify(result.context) === JSON.stringify(report.context)) continue;
    const projected = scorePost(result.text, result.context);
    out.push({
      id: t.id,
      kind: t.kind,
      title: t.title,
      why: t.why,
      source: t.source,
      projectedScore: projected.score,
      delta: Math.round((projected.score - report.score) * 10) / 10,
    });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

export function autoresearch(text: string, ctx?: PostContext, options: AutoresearchOptions = {}): AutoresearchResult {
  const maxIterations = options.maxIterations ?? 10;
  const minGain = options.minGain ?? 0.1;
  const exclude = new Set(options.exclude ?? []);
  const original = scorePost(text, ctx);
  let current = original;
  let replyText: string | undefined;
  const steps: Step[] = [];
  const rejected = new Set<string>();
  const used = new Set<string>();

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    let best: { transform: Transform; report: ScoreReport; replyText?: string; note: string } | null = null;
    for (const t of TRANSFORMS) {
      if (t.kind !== "text" || used.has(t.id) || exclude.has(t.id)) continue;
      if (!t.applies(current.features, current.context)) continue;
      const result = t.apply(current.text, current.context);
      if (result.text === current.text && JSON.stringify(result.context) === JSON.stringify(current.context)) continue;
      const report = scorePost(result.text, result.context);
      if (report.score - current.score < minGain) {
        rejected.add(t.id);
        continue;
      }
      if (best === null || report.score > best.report.score) {
        best = { transform: t, report, replyText: result.replyText, note: result.note };
      }
    }
    if (best === null) break;
    steps.push({
      iteration,
      transformId: best.transform.id,
      title: best.transform.title,
      note: best.note,
      before: current.score,
      after: best.report.score,
      text: best.report.text,
    });
    used.add(best.transform.id);
    rejected.delete(best.transform.id);
    if (best.replyText) replyText = replyText ? `${replyText}\n${best.replyText}` : best.replyText;
    current = best.report;
  }

  const projections = suggestions(current, [...exclude]).filter((s) => s.kind === "context");
  return { original, final: current, steps, replyText, projections, rejected: [...rejected] };
}
