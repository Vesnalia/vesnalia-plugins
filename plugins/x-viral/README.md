# alia-plugin-x-viral

Scores a draft X post against the open-source [X For You algorithm](https://github.com/xai-org/x-algorithm)
and runs an autoresearch loop (propose edit → rescore → keep if better) to improve it.

## What it models

- `lib/xalgo.ts` mirrors the production weights and ranking constants from
  `home-mixer/params/param.rs` (reply 5.0, copy-link 20.0, report -234, OON factor 0.75, 48h age filter, cold-start thresholds).
- `lib/scorer.ts` estimates per-action probabilities from post features (a heuristic stand-in for Phoenix), combines them the way `RankingScorer` does, applies the out-of-network discount and visibility gates, and maps the result to 0-100.
- `lib/transforms.ts` is the candidate-edit library; `lib/autoresearch.ts` is the greedy loop.

## Surfaces

- Sidebar page **X Viral**: paste, score, autoresearch, copy the improved version.
- CLI: `alia x-viral score "<text>" [--image --video --reply --followers N]`, `alia x-viral autoresearch "<text>"`, `alia x-viral weights`.
- Agent tools `x_viral_score` and `x_viral_autoresearch`, plus the `x-viral-autoresearch` skill that drives an LLM outer loop for semantic rewrites.

## Develop

```
npm install --include=dev
npm test
npm run typecheck
alia plugin install .
alia plugin dev
```
