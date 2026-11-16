# alia-plugin-agent-retry

Retries a failed VesnALIA turn on a configurable, growing backoff — for **any**
failure a provider reports, including ones that carry no structured error info.

## Why

VesnALIA already has two retry layers, and neither covers a long backoff over
arbitrary failures:

| | Pi's built-in retry | built-in `provider-retry` | this plugin |
|---|---|---|---|
| Attempts | configurable | hard-coded 5 | configurable (default 50) |
| Backoff | exponential, capped at 60s by default | `5s × 2ⁿ`, overloaded only | exponential / linear / fixed, configurable base, growth, cap, jitter |
| Which failures | a hard-coded list of provider messages | `overloaded` + resettable subscription-window rate limits | everything except an explicit skip list — **including failures with no error info** |
| Scope | every thread | every thread | per project, provider, thread, visibility |
| Survives restart | no (in-process) | yes | yes |

Pi's retryable-error list lives in `@earendil-works/pi-ai` and cannot be
extended by configuration. Core's `turn.failed` event, by contrast, fires for
every failed turn and carries a durable attempt counter — which is what a long
backoff needs.

## Install

```bash
alia plugin install git:https://github.com/euanguo/bb-plugin-agent-retry.git@^0.1.0
alia plugin disable provider-retry   # otherwise the two retriers race
```

Or from a local checkout:

```bash
npm install
alia plugin build
alia plugin install . --yes
```

## Use

```bash
alia agent-retry status             # effective policy, recent activity, pending retries
alia agent-retry log                # decision history
alia agent-retry explain            # resolved policy + the waits it would use
alia agent-retry simulate --category none --message "service unavailable"
alia agent-retry cancel <thread-id> # drop the queued retry
alia agent-retry retry <thread-id>  # retry now
```

Configuration lives in Settings → Installed plugins → Agent Retry, or
`alia plugin config agent-retry`. See `skills/agent-retry/SKILL.md` for the full
settings reference and the `advancedJson` override format.

`enabled` is a master switch: off leaves a failed turn exactly as core left it
and records nothing. `dryRun` decides and records but queues nothing, which is
how to try a policy before trusting it.

## Layout

| file | role |
|---|---|
| `policy.ts` | pure decision engine — no VesnALIA imports, no clock, fully unit-tested |
| `config.ts` | the two config layers and how they merge |
| `store.ts` | the SQLite decision log and the kv retry-chain state |
| `cli.ts` | `alia agent-retry` |
| `server.ts` | the factory: wires the event handlers, the daily sweep, and does the I/O |

## Develop

```bash
npm test        # 177 scenarios: policy, config, integration, CLI, hygiene
npm run typecheck
alia plugin dev   # rebuild and reload on save
```

`GATES.md` is the acceptance ledger for the release: every gate has a command
and a marker that only appears once its check has passed.

```bash
node test/run-gates.mjs G1   # policy scenarios
node test/git-install-check.mjs
node test/live-check.mjs     # drives a real failure against a running alia
```
