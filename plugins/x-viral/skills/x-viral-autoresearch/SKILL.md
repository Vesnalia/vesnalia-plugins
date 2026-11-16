---
name: x-viral-autoresearch
description: Score a draft X (Twitter) post against the open-source For You algorithm and run an autoresearch loop that rewrites it for a higher score. Use whenever the user asks to score, evaluate, improve, optimize, or make a post go viral, or asks how the X algorithm would treat a post.
---

# X viral autoresearch

The X Viral plugin models the ranking in xai-org/x-algorithm: Phoenix predicts a
probability for each viewer action, `RankingScorer` sums them with production
weights (reply 5.0, quote 5.0, share-via-DM 5.0, copy-link 20.0, like 0.5,
report -234), multiplies out-of-network posts by 0.75, and visibility filtering
drops replies/reposts for non-followers and anything older than 48 hours.

Two evaluators are available. The tools return the same text as the CLI.

| Surface | Use |
| --- | --- |
| `x_viral_score` tool / `bb x-viral score "<text>"` | Score 0-100, gates, signals, ranked suggestions each with its projected score |
| `x_viral_autoresearch` tool / `bb x-viral autoresearch "<text>"` | Greedy loop over mechanical edits; returns the improved post and new score |
| `x_viral_video_script` tool / `bb x-viral video "<text>"` | 10-30s beat sheet (hook, beats, ask, captions) from the post's own sentences |
| `bb x-viral weights` | The mirrored production weights |

Every score result ends with **content levers** (question, position, useful
detail, number, story, hook, structure), each with the projected score if the
post earned that signal, and a **reachable** ceiling. Those are the rewrites you
write; the mechanical loop cannot.

Context flags matter: `--image`, `--video`, `--reply`, `--quote`, `--followers N`,
`--mutual`, `--age-hours N`. Ask for them only if the user has not said.

## Procedure (the outer autoresearch loop)

The plugin's inner loop only tries mechanical edits (move link, cut hashtags,
break paragraphs, add a reply prompt). You are the researcher for semantic
rewrites. Run this loop:

1. Score the original with `x_viral_score`. Report the score and the gates.
   A `DROP` gate (reply, repost, >48h, abuse) caps reach at zero; fix the
   format before touching the wording.
2. Run `x_viral_autoresearch` on the original. Take its improved post as the
   current best and note its score.
3. Write three rewrites of the current best that keep the author's meaning and
   voice but change one lever each: (a) a sharper first line under 90 chars,
   (b) a real question or position that earns replies and quotes, (c) a
   concrete, save-worthy detail (number, step, example) that earns copy-link
   and DM shares. Never add engagement bait, hashtags, or spam phrasing.
4. Score all three with `x_viral_score` using the same context. Keep a rewrite
   only if its score beats the current best by at least 1 point.
5. Repeat steps 3-4 until two consecutive rounds produce no improvement, or
   you have run five rounds.
6. Stop when the score is at least 65 (green) or the rounds are exhausted. If
   the reachable ceiling is below 65, say so: the format or idea must change.
7. Reply with: the original score, the final post, its score, the kept steps
   in order, a video script from `x_viral_video_script` (rewrite the hook in
   the author's voice), what media to attach, the publishing changes still on
   the table with projected scores, and any remaining gates.

## Rules

- Do not invent facts, numbers, or quotes when rewriting; use placeholders
  like `[number]` and say so.
- Replace the `What would you add?` placeholder the inner loop appends with a
  question specific to the post.
- Report the score as a model estimate, not a guarantee: the real ranking is
  personalized per viewer and depends on the author's history.
- Prefer the tools over reimplementing the scoring by hand.
