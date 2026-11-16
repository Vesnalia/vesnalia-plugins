// Content-level levers the mechanical loop cannot pull. Each one names a
// positive signal the post does not yet trigger, explains how to earn it, and
// projects the score if it did (by applying that signal's multipliers).
import type { Features, PostContext } from "./features";
import { scorePost, type Heads, type ScoreReport } from "./scorer";
import { SOURCES } from "./xalgo";

export interface Opportunity {
  id: string;
  title: string;
  howTo: string;
  why: string;
  source?: string;
  projectedScore: number;
  delta: number;
}

interface OpportunityRule {
  id: string;
  title: string;
  howTo: string;
  why: string;
  source?: string;
  multipliers: Partial<Heads>;
  applies(f: Features, c: Required<PostContext>): boolean;
}

export const OPPORTUNITY_RULES: OpportunityRule[] = [
  {
    id: "ask-a-question",
    title: "End with a question only your reader can answer",
    howTo: "Close with one specific question tied to the post's claim (not 'thoughts?'). Make it answerable in a single line so replying is cheap.",
    why: "Reply is weighted 5.0, ten times a like, and a real question roughly doubles predicted reply rate.",
    source: SOURCES.weights,
    multipliers: { reply: 2.0, dwellTimeSecs: 1.1 },
    applies: (f) => f.questions === 0 && !f.replyPrompt,
  },
  {
    id: "take-a-position",
    title: "Take a position someone will want to argue with",
    howTo: "State the claim plainly and name what it contradicts ('Most teams do X. It's wrong because…'). Avoid hedges; keep it defensible.",
    why: "Positions earn replies and quotes, both weighted 5.0. The cost is a small rise in not-interested and block risk, which the projection already includes.",
    source: SOURCES.weights,
    multipliers: { reply: 1.6, quote: 1.8, favorite: 1.1, notInterested: 1.3, blockAuthor: 1.3 },
    applies: (f) => !f.opinion,
  },
  {
    id: "make-it-useful",
    title: "Give the reader something to save or send",
    howTo: "Add the how: a step, a template, a checklist, a rule of thumb, or the exact thing you changed. Frame it as 'here's how' or 'the mistake was'.",
    why: "Copy-link is weighted 20 and DM-share 5. Practical content is what people forward.",
    source: SOURCES.weights,
    multipliers: { shareViaCopyLink: 1.8, shareViaDm: 1.5, share: 1.5, retweet: 1.3, dwellTimeSecs: 1.3 },
    applies: (f) => !f.utility,
  },
  {
    id: "add-a-number",
    title: "Put a concrete number in it",
    howTo: "Replace vague words with a measurement: the before/after, the count, the timeframe, the cost. One real number beats three adjectives.",
    why: "Specificity reads as credible and lifts repost and copy-link propensity.",
    multipliers: { retweet: 1.25, shareViaCopyLink: 1.3, favorite: 1.1 },
    applies: (f) => !f.hasNumbers,
  },
  {
    id: "tell-the-story",
    title: "Open with what happened to you",
    howTo: "Lead with a first-person moment ('Two weeks ago I…', 'I shipped…', 'I was wrong about…') and let the lesson follow from it.",
    why: "Narrative raises predicted dwell seconds (0.004 each) and follow-author (4.0).",
    source: SOURCES.weights,
    multipliers: { dwellTimeSecs: 1.4, dwell: 1.15, followAuthor: 1.8, reply: 1.2, notDwelled: 0.85 },
    applies: (f) => !f.story,
  },
  {
    id: "tighten-the-hook",
    title: "Make the first line a scroll-stopper under 90 characters",
    howTo: "Put the most surprising claim or number first, alone on line one, then a blank line. Cut the setup; the body can carry it.",
    why: "The first line decides P(not dwelled) (−0.02) and dwell; a short opener on its own line is what the model sees first.",
    multipliers: { notDwelled: 0.85, dwell: 1.15, dwellTimeSecs: 1.1 },
    applies: (f) => !(f.firstLineChars > 0 && f.firstLineChars <= 90 && f.lines > 1),
  },
  {
    id: "structure-it",
    title: "Break it into a scannable list",
    howTo: "Turn the middle into 3-5 short lines, each starting with a number or dash, one idea per line.",
    why: "Structure keeps readers on the post: more predicted dwell, less not-dwelled, more copy-link.",
    multipliers: { dwellTimeSecs: 1.3, dwell: 1.1, notDwelled: 0.85, shareViaCopyLink: 1.2 },
    applies: (f) => !f.listStructure && f.chars >= 140,
  },
];

export function opportunities(report: ScoreReport): Opportunity[] {
  const out: Opportunity[] = [];
  for (const rule of OPPORTUNITY_RULES) {
    if (!rule.applies(report.features, report.context)) continue;
    const projected = scorePost(report.text, report.context, rule.multipliers);
    out.push({
      id: rule.id,
      title: rule.title,
      howTo: rule.howTo,
      why: rule.why,
      source: rule.source,
      projectedScore: projected.score,
      delta: Math.round((projected.score - report.score) * 10) / 10,
    });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

export interface Reachable {
  /** Score if every applicable opportunity landed and the best media was attached. */
  score: number;
  /** What that assumes, in order of impact. */
  assumes: string[];
}

/** The ceiling this post can reach with content changes; the "what it takes to go green" number. */
export function reachable(report: ScoreReport): Reachable {
  const combined: Partial<Heads> = {};
  const assumes: string[] = [];
  for (const o of opportunities(report)) {
    const rule = OPPORTUNITY_RULES.find((r) => r.id === o.id);
    if (!rule || o.delta <= 0) continue;
    for (const [head, mult] of Object.entries(rule.multipliers) as [keyof Heads, number][]) {
      combined[head] = (combined[head] ?? 1) * mult;
    }
    assumes.push(o.title);
  }
  let context = report.context;
  if (!context.hasVideo && !context.hasImage) {
    context = { ...context, hasVideo: true, videoSeconds: 15 };
    assumes.push("A 15s video attached (an image gets most of the way)");
  }
  if (context.isReply || context.isRepost) {
    context = { ...context, isReply: false, isRepost: false };
    assumes.push("Posted as an original, not a reply or repost");
  }
  const projected = scorePost(report.text, context, combined);
  return { score: projected.score, assumes };
}
