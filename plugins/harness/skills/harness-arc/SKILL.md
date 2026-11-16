---
name: harness-arc
description: Drive work through the Harness plugin's Explore → Plan → Worker → Critic → Promote arc and its one-node-at-a-time DAG. Use when the user mentions the harness, Standard Harness, custom Harnesses, prewalk, DAG plans, artifacts/ discipline, Critic APPROVE/REWORK/BLOCK, or asks to advance, rewind, or plan the current thread.
---

# Harness arc

The Harness plugin is the fulcrum between expectations and the model. Roles stay isolated. A prompt that plans, implements, and critiques itself confuses its own objectives.

Ordinary chats stay ordinary until the operator explicitly starts a Harness.

## Standard Harness (default)

1. **Explore** — map the problem. Do not implement yet. Stays on the parent thread.
2. **Plan** — freeze an explicit DAG. Stays on the parent thread.
3. **Worker** — implement one node. Spawns a child thread.
4. **Critic** — simplify and push back. Complete with APPROVE, REWORK, or BLOCK. Spawns a child thread.
5. **Promote** — the job is unfinished until you communicate it. Spawns a child thread.

Custom Harnesses clone this five-arc shape. Name, description, per-phase instructions, parent/child execution, artifact policy, promote mode (`always` or `off`), and max corrections can change. Starting snapshots the resolved definition into the plan so later edits do not rewrite in-flight work. This plugin injects only `harness-arc`; it cannot attach arbitrary VesnALIA skills.

Milestone Pipeline is removed. Do not start `--milestone` or `milestone-pipeline`.

## Commands

| Command | Effect |
| --- | --- |
| `alia harness status` | Current phase, resolved model, next DAG node |
| `alia harness start --task "<text>"` | Start Standard Harness |
| `alia harness start --task "<text>" --harness <id>` | Start a named Harness |
| `alia harness advance` | Move one phase forward |
| `alia harness rewind` | Move one phase back (critic → worker) |
| `alia harness set-phase <phase>` | Jump to explore\|plan\|worker\|critic\|promote |
| `alia harness init` | Create `artifacts/`, `plans/`, and `HARNESS.md` |
| `alia harness plan create "<name>"` | Seed a five-node DAG (add `--no-seed` for empty) |
| `alia harness plan list` / `show <id>` | List or inspect a plan |
| `alia harness plan next <id>` | Next unblocked node |
| `alia harness plan start <id> <node>` | Start a node (spawns a child when execution is child) |
| `alia harness plan complete <id> <node> [--verdict APPROVE\|REWORK\|BLOCK] [--summary "<text>"]` | Mark that node done |
| `alia harness plan add <id> <title> [--phase worker] [--deps a,b]` | Add a node |

Pass `--thread <id>` when you are not already inside that thread. Add `--json` when the output drives code.

Native tools: `harness_get_arc`, `harness_advance`, `harness_create_plan`, `harness_next_node`, `harness_complete_node`.

## Procedure

1. `alia harness status` (or `harness_get_arc`) before changing anything.
2. Stay in the current phase. If you need a DAG, advance to Plan and write a DAG instead of improvising a giant todo list in prose.
3. Worker: start the next node, finish it, complete it, then take the following node. Never start two nodes.
4. Keep auditable outputs in `artifacts/`. Do not dump scratch into the repo root.
5. After Worker, advance to Critic. Complete Critic with APPROVE, REWORK, or BLOCK. REWORK reopens Worker after stopping the live Critic child.
6. Promote last: tell the people who need to know. BLOCK prevents Promote until the operator resets it.

## Role routing

Settings → Role routing picks a real provider and model for Explore/Plan (parent on Standard), Worker, Critic, and Promote.

A DAG node can override that slot. Unset means inherit the parent thread's provider/model when VesnALIA exposes `defaultExecutionOptions`. Otherwise attempt telemetry records `inherited-unknown` with null provider/model. No cost is invented.

Do not auto-complete a node when the child goes idle. The operator clicks Done or records a Critic verdict.

Plugin RPC is full-trust local UI/CLI. It is not a tenant auth boundary. Plan mutations require the owning parent thread.
