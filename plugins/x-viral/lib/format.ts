// Markdown rendering for the CLI and the agent tool.
import type { AutoresearchResult, Suggestion } from "./autoresearch";
import type { Opportunity, Reachable } from "./opportunities";
import type { ScoreReport, Term } from "./scorer";

function formatLevers(lines: string[], opportunities: Opportunity[] | undefined, reachable: Reachable | undefined): void {
  if (reachable) {
    lines.push("", `Reachable with content changes: ~${reachable.score}/100 (green is 65+). Assumes:`);
    for (const a of reachable.assumes) lines.push(`  - ${a}`);
  }
  if (opportunities && opportunities.length > 0) {
    lines.push("", "Content levers the loop cannot pull for you (projected score if you do):");
    for (const o of opportunities) {
      const delta = o.delta >= 0 ? `+${o.delta}` : String(o.delta);
      lines.push(`  ${delta.padStart(6)} → ${o.projectedScore}  ${o.title}`);
      lines.push(`         How: ${o.howTo}`);
    }
  }
}

const HEAD_LABEL: Record<Term["head"], string> = {
  favorite: "like",
  reply: "reply",
  retweet: "repost",
  quote: "quote",
  share: "share",
  shareViaDm: "share via DM",
  shareViaCopyLink: "copy link",
  dwell: "dwell",
  dwellTimeSecs: "dwell seconds",
  click: "click",
  openLink: "open link",
  photoExpand: "photo expand",
  videoOpen: "video open",
  followAuthor: "follow author",
  notInterested: "not interested",
  muteAuthor: "mute",
  blockAuthor: "block",
  report: "report",
  notDwelled: "not dwelled",
};

function fmt(n: number, digits = 4): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function formatReport(
  r: ScoreReport,
  opts: { suggestions?: Suggestion[]; opportunities?: Opportunity[]; reachable?: Reachable; verbose?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(`Viral reach score: ${r.score}/100   (followers-only view: ${r.inNetworkScore}/100)`);
  lines.push(`Weighted sum: +${fmt(r.weighted.positive)} − ${fmt(r.weighted.negative)} = ${fmt(r.weighted.combined)}   × OON factor ${r.multipliers.oon}`);
  if (r.multipliers.coldStartEligible) lines.push("Cold-start eligible: yes (≤1000 followers, <1000 impressions, <24h) — one post per feed can be lifted to slot 15-16.");
  if (r.multipliers.mutualReplyBoost) lines.push("Mutual-follow reply boost: reply weight 5 → 20 for this original post.");
  if (r.gates.length > 0) {
    lines.push("", "Gates:");
    for (const g of r.gates) lines.push(`  [${g.severity.toUpperCase()}] ${g.title} — ${g.detail} (${g.source})`);
  }
  if (r.signals.length > 0) {
    lines.push("", "Signals the model would read:");
    for (const s of r.signals) {
      const sign = s.effect === "positive" ? "+" : s.effect === "negative" ? "−" : "±";
      lines.push(`  ${sign} ${s.label}: ${s.why}`);
    }
  }
  const top = [...r.terms].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, opts.verbose ? 19 : 8);
  lines.push("", "Score breakdown (P(action) × weight):");
  for (const t of top) {
    lines.push(`  ${HEAD_LABEL[t.head].padEnd(15)} ${fmt(t.probability, 5).padStart(8)} × ${String(t.weight).padStart(7)} = ${(t.contribution >= 0 ? "+" : "") + fmt(t.contribution, 5)}`);
  }
  if (opts.suggestions && opts.suggestions.length > 0) {
    lines.push("", "Suggestions (each scored independently against this post):");
    for (const s of opts.suggestions) {
      const delta = s.delta >= 0 ? `+${s.delta}` : String(s.delta);
      lines.push(`  ${delta.padStart(6)} → ${s.projectedScore}  ${s.title}${s.kind === "context" ? " (publishing change)" : ""}`);
      lines.push(`         ${s.why}${s.source ? ` [${s.source}]` : ""}`);
    }
  }
  formatLevers(lines, opts.opportunities, opts.reachable);
  return lines.join("\n");
}

export function formatAutoresearch(a: AutoresearchResult, opts: { opportunities?: Opportunity[]; reachable?: Reachable } = {}): string {
  const lines: string[] = [];
  lines.push(`Original score: ${a.original.score}/100`);
  if (a.steps.length === 0) {
    lines.push("No text edit improved the score; the post already clears every automatic check.");
  } else {
    lines.push("", "Autoresearch steps (kept only if the score rose):");
    for (const s of a.steps) lines.push(`  ${s.iteration}. ${s.title}: ${s.before} → ${s.after}   (${s.note})`);
  }
  if (a.rejected.length > 0) lines.push("", `Tried and rejected: ${a.rejected.join(", ")}`);
  lines.push("", `Improved post (${a.final.score}/100):`, "---", a.final.text, "---");
  if (a.replyText) lines.push("", "Post as the first reply:", a.replyText);
  if (a.projections.length > 0) {
    lines.push("", "Publishing changes still on the table:");
    for (const p of a.projections) {
      const delta = p.delta >= 0 ? `+${p.delta}` : String(p.delta);
      lines.push(`  ${delta.padStart(6)} → ${p.projectedScore}  ${p.title}`);
    }
  }
  if (a.final.gates.length > 0) {
    lines.push("", "Remaining gates:");
    for (const g of a.final.gates) lines.push(`  [${g.severity.toUpperCase()}] ${g.title}`);
  }
  formatLevers(lines, opts.opportunities, opts.reachable);
  return lines.join("\n");
}
