# alia-plugin-otel

A [VesnALIA](https://getbb.app) plugin that exports OpenTelemetry (OTLP/HTTP, JSON) from VesnALIA.

It never exports prompt, response, tool, thread-title, path or error text. There is no option for it. Every exported attribute is an id, an enum value, a model name, a project name or a number.

## What it exports

**Spans** (one trace per delegation tree):

- `chat <model>` for each finished turn. Attributes follow the GenAI conventions: `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`. VesnALIA adds `alia.thread.id`, `alia.project.id`, `alia.project.name`, `alia.environment.id`, `alia.machine.id`, `alia.machine.name`, `alia.provider.id`, `alia.parent_thread.id`, `alia.root_thread.id`, `alia.turn.status`, `alia.turn.initiator`, `alia.cost.usd` (when the provider reports a cost), `alia.origin.plugin` and `alia.automation.run`.
- `alia.thread` for a whole thread, sent when the thread is archived or deleted.

A child thread (delegation, `route_worker`, subagent thread) uses the trace id of its root thread, and its `alia.thread` span is a child of its parent's `alia.thread` span. The turn spans of a thread are children of that thread's span.

**Metrics** (cumulative, low-cardinality: no thread id). Turn and thread metrics carry `alia.machine.name`, the VesnALIA machine that ran the thread:

| Name | Type | Notes |
| --- | --- | --- |
| `gen_ai.client.token.usage` | histogram | `gen_ai.token.type` = `input` or `output` |
| `gen_ai.client.operation.duration` | histogram | seconds per turn |
| `alia.gen_ai.client.cache_tokens` | counter | `alia.cache.type` = `read` or `write` |
| `alia.gen_ai.client.cost` | counter | USD, only when the provider reports it |
| `alia.turns` | counter | by `alia.turn.status` |
| `alia.thread.transitions`, `alia.thread.active.duration` | counter, histogram | thread lifecycle |
| `alia.automation.runs` | counter | finished threads that automations started |
| `alia.provider.usage.used_percent`, `.reset_time`, `.cost_used`, `.cost_limit` | gauge | per machine (`alia.machine.id`, `alia.machine.name`), provider, account and quota window |

Provider usage windows come from VesnALIA's built-in Provider usage plugin. Account e-mail and display names are not exported. `alia.provider.account` is a 12-character one-way hash of the account login, so two machines on the same account can be told apart from two accounts.

`alia.machine.name` is the machine name in VesnALIA (`alia machine list`). The VesnALIA server sees the threads of every machine, so the resource attributes (`host.name`) name the server, and `alia.machine.name` names the machine where the thread ran.

A flush sends only the metric series that changed since the last delivered export, so an idle VesnALIA sends no metrics. Every series is sent again once per `metricsRefreshSeconds` (default 3600; 0 turns the refresh off). Quota gauges are sent at each usage poll.

## Install

```
alia plugin install github:lanjak/alia-plugin-otel
alia plugin config otel set endpoint http://collector:4318
alia plugin config otel set headers 'x-otlp-token=SECRET'
```

Settings: `endpoint`, `headers` (secret), `resourceAttributes`, `traces`, `metrics`, `usageWindows`, `flushSeconds`, `usagePollSeconds`, `metricsRefreshSeconds`. Start with the endpoint set. The plugin sends nothing without it.

## Correlation with the provider's own telemetry

- Every turn span carries `session.id`, the provider's own session id (VesnALIA's `providerThreadId`). Claude Code reports the same value as `session.id` on its own events, so you can join the two on it.
- VesnALIA cannot set `TRACEPARENT` for a provider process, so provider spans are **not** in the same trace as these spans. The join key is `session.id`, plus time.
- Token counts here come from VesnALIA's view of the provider. Whether `input_tokens` includes cached tokens depends on the provider. Treat these figures as context, and take billing figures from the provider or gateway.
- The automation id is not exported. Threads that automations start have `alia.automation.run = true`.

## Limits

- No history before install. A thread that existed before install starts at its newest event.
- Spans for a turn are sent after it ends. A turn that is still running is not visible yet.
- Spans wait in memory (5000 at most, oldest dropped) while the collector is down. Metrics are cumulative and reset when VesnALIA restarts. Changed series stay marked until a metrics export succeeds.
- No sampling and no log signal.

## Develop

```
npm install
npm test
npm run typecheck
alia plugin build
```

MIT license.
