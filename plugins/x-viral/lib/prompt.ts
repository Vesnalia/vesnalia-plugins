// Builds the hand-off prompt for a bb agent thread. The agent runs the outer
// autoresearch loop (semantic rewrites) that the plugin cannot do itself.
import type { Opportunity } from "./opportunities";
import type { PostContext } from "./features";

export function rewritePrompt(input: {
  text: string;
  context: PostContext;
  score: number;
  reachable: number;
  opportunities: Opportunity[];
  /** One-line summary of the attached media check, if any. */
  media?: string;
}): string {
  const flags = Object.entries(input.context)
    .filter(([, v]) => v !== undefined && v !== false && v !== 0)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
  const levers = input.opportunities
    .filter((o) => o.delta > 0)
    .slice(0, 5)
    .map((o) => `- ${o.title} (projected ${o.projectedScore}): ${o.howTo}`)
    .join("\n");
  return [
    "Use the x-viral-autoresearch skill. Rewrite this X post until x_viral_score reports a viral reach score of at least 65 (green), or you have done five rounds.",
    "",
    `Current score: ${input.score}. Reachable with content changes: about ${input.reachable}.`,
    flags ? `Context to pass on every score call: ${flags}.` : "Context: none stated; ask me before assuming media.",
    input.media ? `Attached media: ${input.media}` : "",
    "",
    "Levers to pull, in order of projected impact:",
    levers || "- (no content levers left; focus on wording and a media plan)",
    "",
    "Rules: keep my meaning and voice; do not invent facts or numbers, use [placeholders] and tell me; no hashtags, engagement bait, or spam phrasing; keep any link for the first reply.",
    "Finish with: the final post, its score, the kept steps, a 15-30s video script (hook, beats, ask), and what media to attach.",
    "",
    "Post:",
    "```",
    input.text,
    "```",
  ].join("\n");
}
