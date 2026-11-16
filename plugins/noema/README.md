# alia-plugin-noema

Federated agentic memory for VesnALIA coding agents. Bridges VesnALIA threads into a
Noema cortex over its Streamable HTTP MCP endpoint, giving agents durable,
searchable memory across sessions.

## Tools

Six native agent tools mirroring Noema's core surface:

- **`noema_search`** — full-text search over memory traces, ranked by relevance.
- **`noema_remember`** — create a new memory trace (fact, decision, preference,
  context, skill, intent, observation, or note).
- **`noema_recall`** — read a specific trace by ID, including its full body.
- **`noema_list`** — list traces, optionally filtered by type, author, tag, or origin.
- **`noema_update`** — update fields of an existing trace.
- **`noema_lineage`** — show a trace's derivation graph.

## How it works

The plugin implements a minimal MCP client for Noema's Streamable HTTP
transport (protocol `2025-03-26`), including full session lifecycle: it
initialises a session on first use and transparently re-initialises if the
session expires (HTTP 404). Concurrent tool calls are serialised so they don't
race the initialisation handshake.

## Settings

| Setting | Default | Description |
|---|---|---|
| `noemaHttpUrl` | `http://127.0.0.1:3004` | Noema Streamable HTTP MCP endpoint (`noema serve --transport http`). |
| `noemaCortex` | `coding-agents` | Cortex name. |
| `noemaAccessKey` | *(env `NOEMA_MCP_KEY`)* | MCP access key. Stored as a secret. |

The access key is read from the `NOEMA_MCP_KEY` environment variable by
default and stored as a secret setting — it is never written to the database
or sent to the frontend.

## Install

```sh
npm install
alia plugin install .
```

After editing sources, reload:

```sh
alia plugin reload noema
```

## Configure

```sh
alia plugin config noema
alia plugin config noema set noemaCortex coding-agents
```

## Build

```sh
alia plugin build
```
