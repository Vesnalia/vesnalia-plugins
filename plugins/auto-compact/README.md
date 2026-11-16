# alia-plugin-auto-compact

Automatically compacts a thread's context window when usage reaches a
configurable percentage (default 80%).

- `server.ts` — the backend: `thread.idle` / `thread.failed` handlers that
  read `contextWindowUsage` from the thread timeline and call
  `threads.compact` at or above the threshold, a 15-minute per-thread
  cooldown, `enabled` + `thresholdPercent` settings, a `compact_now` RPC,
  and a `alia auto-compact` CLI (`status`, `check`, `now`). Threads whose
  provider cannot compact are reported as unsupported and skipped quietly.
- `app.tsx` — a **Compact** button in every thread header that compacts the
  visible thread on demand via the `compact_now` RPC.
- `skills/auto-compact/SKILL.md` — tells agents how the plugin behaves and
  how to use the CLI. VesnALIA imports it into agent threads automatically.
- `server.test.ts` — unit tests over the official fake-plugin harness
  (`@vesnalia/plugin-sdk/testing`): threshold, cooldown, disabled state,
  failed threads, and the CLI.

```sh
alia auto-compact status [--json]
alia auto-compact check [thread-id] [--json]
alia auto-compact now [thread-id] [--json]
alia plugin config auto-compact set thresholdPercent 90
```

Run `npm test` for the suite, `npm run check` for the typecheck, and
`alia plugin build` before reinstalling.
