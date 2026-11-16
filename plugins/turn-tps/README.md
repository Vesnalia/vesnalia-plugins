# Turn TPS

Displays provider-reported output tokens per second for completed VesnALIA turns.

TPS is output tokens divided by the full turn duration from `turn/started` to
`turn/completed`, including tool execution and waiting. It is not a measurement
of model decoding speed. Output-token semantics follow the provider; reasoning
counts are not added again. Turns with missing usage or lifecycle timestamps
have no badge. Active turns receive their badge after completion.

Usage is accumulated from changes in provider session totals, avoiding duplicate
usage notifications and separating turns. On a counter reset or first observation,
only the provider's reported last request is attributed. Events are read in sequence
with pagination and a bounded per-thread cache. Frontend badges require an exact
thread and turn match; VesnALIA DOM changes may cause a badge to disappear safely.

Validation (Node 22.18+):

```
npm exec tsc -- --noEmit
node --experimental-strip-types check.mjs
alia plugin build .
```

After changing sources, build and run `alia plugin reload turn-tps`.
