# Ollama Fleet

Local inference routing and observability for BB. Connect multiple Ollama
servers, discover models, check health, and route a generation job to an
appropriate model/server with bounded fallback.

```text
Ollama A ─┐
Ollama B ─┼─> Ollama Fleet ─> route / fallback
Ollama C ─┘          └──────> optional Agent Board observability
```

## Why Fleet

Several Ollama machines mean several model inventories, manual model choices,
and endpoints that may go offline. Fleet brings discovery, selection, fallback,
and local delegation visibility into BB. It is an Ollama-specific tool, not an
orchestration framework. Recommendations use deterministic model-name heuristics,
health, configured preferences, and available metadata; they are not quality guarantees.

## Features

- Multiple endpoints, health probes, model inventory and optional running/VRAM metadata.
- Metadata checks and small generation tests with latency/throughput benchmarks.
- Recommendations, reliability preferences, model overrides and bounded fallback.
- Bounded health and generation history.
- Safe job lifecycle, actual selected model/server, and BB origin linkage where available.
- Sidebar dashboard, CLI, agent tools and public RPC.
- Optional Agent Board integration; Fleet does not depend on Agent Board.

## Installation

First public beta: **0.6.0**. Install the released Git tag with BB:

```sh
bb plugin install git:https://github.com/aaronphifer/bb-plugin-ollama-fleet.git@v0.6.0
```

BB's managed Git installer installs runtime dependencies and builds the frontend
and server from source. Git releases intentionally omit `dist/`. A local path
install uses your existing dependencies; prepare a checkout with:

```sh
npm ci
bb plugin build
bb plugin install .
```

See [compatibility and release evidence](RELEASE_AUDIT.md). Declared floors are
BB >=0.40 and SDK >=0.4.21; development SDK is locked at 0.4.34. These floors
are not a claim that all supported versions have been live-tested.

## Configuration

Add an endpoint from the sidebar or CLI, using a friendly public display name:

```sh
bb ollama-fleet add "Example workstation" http://ollama.example:11434
bb ollama-fleet status
bb ollama-fleet models
bb ollama-fleet recommend coding --local-only
bb ollama-fleet route general "Reply with READY" --local-only --max-attempts 1
```

Replace `ollama.example` with your own Ollama server hostname. Use endpoints you trust.
URL-embedded credentials are rejected. Do not put
secrets into names or job labels. `--local-only` excludes models classified as
cloud-backed; classification is name-based and can be overridden, so operators
must configure it honestly. `/api/ps` failure does not mark a healthy `/api/tags`
endpoint offline. The open dashboard refreshes health every 60 seconds.

## Agent Tools / RPC

| Agent tool | Purpose |
| --- | --- |
| `ollama_fleet_status` | Endpoint health |
| `ollama_fleet_models` | Model inventory |
| `ollama_fleet_test` | Metadata or small generation test |
| `ollama_fleet_recommend` | Select candidates |
| `ollama_fleet_history` | Health and benchmark history |
| `ollama_fleet_route` | Generate with bounded fallback |

Public RPC methods are `fleet_list` (null input), `fleet_add` (`name`, `baseUrl`),
`fleet_remove` (`id`), `fleet_probe` (`id`), `fleet_probe_all` (null input),
`fleet_test_model` (`id`, `model`, optional `generate`, `prompt`),
`fleet_recommend`, `fleet_history` (optional `endpointId`), `fleet_route`, and
`fleet_observability_snapshot`. The latter's bounded schema is described below;
`server.ts` exports the authoritative RPC contract.

## Agent Board Integration

[Agent Board >=0.6.0](https://github.com/aaronphifer/bb-plugin-agent-board)
is an optional companion that visualizes Fleet jobs and delegated local workers.
It uses only the public snapshot. Agent-tool calls can link jobs to their BB
thread/project; direct
CLI/RPC routes have null origin and appear as standalone jobs. Fleet remains
independently installable and usable.

## Privacy / Security

Inference and endpoint probes target configured Ollama endpoints. The separate,
explicit `bb-models sync` command contacts Ollama Cloud and modifies Pi files as
documented below. Configured Ollama servers may themselves proxy cloud inference.
HTTP redirect handling follows fetch defaults; the endpoint boundary is not a
network sandbox. Choose trustworthy endpoints and network access controls.

The public job registry excludes raw prompts, responses, reasoning, credentials,
and endpoint URLs. It keeps bounded metadata only. Observability failures do not
control generation. Friendly endpoint/model names and caller labels may be
visible to authorized BB users; redaction cannot make arbitrary text safe.
Route results still return the prompt/answer to their caller. Health/test history
is separate from the public job registry. Plugins run with BB's trust.
See [SECURITY.md](SECURITY.md) for reporting readiness.

## Testing and routing constraints

The default `test` remains a fast `/api/show` metadata check. Add `--generate`
to make a small, deterministic `/api/chat` request and report wall-clock time,
Ollama durations, generated tokens, and tokens per second. `--prompt` accepts a
quoted custom smoke-test prompt and implies `--generate`.

```
bb ollama-fleet test <endpoint-id> qwen3-coder:30b
bb ollama-fleet test <endpoint-id> qwen3-coder:30b --generate
bb ollama-fleet test <endpoint-id> qwen3-coder:30b --prompt "Reply with READY"
```

`recommend --min-context <tokens>` lazily checks `/api/show` only for the
highest-ranked candidates until it has enough eligible choices. This avoids
probing every model during normal health refreshes. `--prefer-running` adds an
explainable score bonus to models already loaded according to `/api/ps`.

## Reliability and fallback routing

Fleet retains at most 500 endpoint health events and 200 model-test events, so
history remains bounded. `history` shows recent availability and generation
performance. `recommend --prefer-reliable` adds an explainable reliability
bonus derived from the latest endpoint checks and generation results.

Two consecutive generation failures place that endpoint/model pair in a
15-minute cooldown. Cooldown models are omitted from new recommendations while
other eligible models remain available.

`route` recommends an ordered chain, performs generation with the first model,
and tries the next candidate only when an attempt fails. The default is three
attempts and the hard maximum is five because every fallback performs inference.

```
bb ollama-fleet recommend coding --prefer-reliable
bb ollama-fleet history <endpoint-id>
bb ollama-fleet route coding "Return a TypeScript function that adds two numbers" \
  --local-only --prefer-running --prefer-reliable --max-attempts 3
```

## Model overrides

Overrides are matched case-insensitively by exact model name and persist in bb's
plugin storage. Omitted values keep their existing setting.

```
bb ollama-fleet override list
bb ollama-fleet override set ops:latest --tags security,general --priority 20
bb ollama-fleet override set my-model:latest --location cloud
bb ollama-fleet override set nomic-embed-text:latest --tags none
bb ollama-fleet override clear ops:latest
```

A priority from `-100` to `100` adjusts the deterministic recommendation score.
The recommendation result includes the score and reasons so routing decisions
remain inspectable.

## Ollama Cloud in BB's model list

BB's Pi provider reads `~/.pi/agent/models.json` for custom providers and its
live `model/list` response feeds BB's model picker. Fleet can safely merge the
current catalog from Ollama Cloud's authoritative `https://ollama.com/api/tags`
endpoint without modifying BB core or replacing any other Pi providers:

```
bb ollama-fleet bb-models sync
bb ollama-fleet bb-models status
```

The sync owns only the `ollama-cloud` provider entry. It preserves the rest of
the JSON document, writes atomically with mode `0600`, and creates
`models.json.ollama-fleet.bak` before changing an existing file. The catalog
stores the environment-variable name `OLLAMA_API_KEY`, never its value. When
that variable is available to BB, Fleet also writes the credential to Pi's
protected `~/.pi/agent/auth.json` store with mode `0600`, preserving every
other credential and backing up an existing file. This is required because a
custom Pi provider cannot reliably inherit a newly added BB environment key.

The catalog endpoint is live, so rerun `sync` when Ollama adds or retires cloud
models. `remove` deletes Fleet's provider entry and its matching Pi credential
while preserving every other provider and credential:

```
bb ollama-fleet bb-models remove
```

## Job observability (0.6.0)

Public RPC `fleet_observability_snapshot({ limit?: number, activeOnly?: boolean,
originThreadId?: string })` returns `{ schemaVersion: 1, observedAt, truncated, jobs }`.
The default and hard maximum are 20 rows; larger limits are rejected. Active
rows sort first, then most recently updated. The independent wire contract is
defined in `lib/observability.ts`. Each row contains only job identity/revision,
state, origin, task type/label, actual model, friendly server ID/name, lifecycle
timestamps/duration, attempt count, coarse activity, and categorical error.

`fleet_route`, the CLI route command (`--label`), and `ollama_fleet_route` accept
an optional label of at most 120 characters. Without one, labels are generic
`Local <task type> task`; no label is derived from the prompt. Only the agent
tool captures trusted thread/project origin. Direct RPC and CLI jobs have null
origin. The existing route response is unchanged and still includes its answer.

Jobs transition routing → running → completed/failed/cancelled. Fallback keeps
the job ID, increments revision/attempt count, and replaces actual model/server.
No queue state or inference internals are invented. Agent abort cancels the
Ollama HTTP generation request and prevents further fallbacks; ongoing model
discovery may finish before the call returns. Cancellation of the HTTP request
does not prove remote compute stopped.

A single `observability-v1` KV record keeps at most 100 terminal jobs plus 20
active jobs, with a 240 KB byte ceiling. Oldest terminal metadata is evicted.
All current active calls remain tracked in memory, including calls outside that
persisted active window. Reload reconciles persisted nonterminal records to
cancelled with an explanation that Fleet reloaded before a recorded finish;
it makes no claim about underlying remote compute. Writes coalesce serially
and never serialize route execution. KV and signal failures are fail-open.

The tiny `fleet-jobs-changed` signal carries only jobId/revision/state. There is
no custom cross-plugin event bus. Snapshot consumers must handle truncation.
No prompts, answers, reasoning, endpoint URLs, or provider payloads enter this
registry. Display fields redact URLs/common credential forms and stay bounded.
Errors use a small categorical allowlist (always ≤360 characters), never raw
provider messages. Caller labels and configured server/model names are public
display metadata; callers must not intentionally put private content in them.

Run `npm test`, `npm run typecheck`, and `bb plugin build`. Tests include the
public SDK dependency scan and actual registered RPC/agent-tool lifecycle paths.

## Bounds

Health history: 500 events. Model-test history: 200 events. Routes default to
three attempts, maximum five. Public snapshot: maximum 20 rows. Persisted job
registry: 100 terminal plus 20 active jobs and a 240 KB ceiling; active in-memory
calls may exceed the persisted window. Consumers must handle truncation.

## Known Limitations

- No queue, token stream, per-attempt history API, or raw result preview.
- Current BB tool context does not provide a tool-call ID.
- Origin exists only where trusted agent-tool context supplies it.
- Cancellation aborts HTTP and further fallback; it does not prove remote compute stopped.
- Cloud catalog/Pi synchronization is explicit and filesystem-coupled; it is not generic provider routing.

## Development

```sh
npm ci
npm test
npm run typecheck
bb plugin build
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and
[release evidence](RELEASE_AUDIT.md). Git installs build from source using BB’s managed installer, so `dist/` is
intentionally ignored. npm publication would need reviewed prebuilt artifacts,
metadata and third-party notices; no npm release is prepared in this phase.

## License

[MIT](LICENSE), Copyright (c) 2026 Aaron Phifer. Third-party code retains its
own [notices and licenses](THIRD_PARTY_NOTICES.md).
