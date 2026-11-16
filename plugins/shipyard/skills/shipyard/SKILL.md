---
name: shipyard
description: Capture ideas, brainstorm, plan, run, and review agent tasks on the project's Shipyard Kanban board with `alia shipyard`. Use when the user asks to add tasks to the board, check what agents are doing, review or merge task results, or record a project lesson.
---

# Shipyard

Shipyard is a Kanban board of coding tasks for a VesnALIA project. Each task runs in
its own visible VesnALIA thread and git worktree. The board has six columns:

| Column | Meaning |
| --- | --- |
| `ideas` | Saved for later. Nothing runs. |
| `brainstorm` | An agent shapes the idea into a spec with the user, in its thread. |
| `queue` | Starts when the project has a free slot. |
| `in_progress` | The agent triages, plans (optional), builds, and validates. |
| `human_review` | The user reviews the work or approves the plan: request changes, open a PR, merge, or mark done. |
| `done` | Finished. |

Moving a card forward is a command. `brainstorm` starts a brainstorm, `queue`
waits for a slot, and `in_progress` starts or continues now.

## Commands

All commands use the current thread's project. Add `--project <id>` outside a
project thread. Task ids accept a unique prefix.

```sh
alia shipyard list [--column human_review] [--json]
alia shipyard show <id> [--json]                # plan, triage, validation report, files, activity
alia shipyard idea "<text>"                     # save an idea in Ideas
alia shipyard create "<description>" [--title "<title>"] [--start | --brainstorm] [--plan auto|always|skip]
alia shipyard start <id>                        # queue from Ideas or Brainstorm, or continue a stopped task
alia shipyard move <id> <column>
alia shipyard approve <id>                      # approve a plan that waits in human_review
alia shipyard stop <id>
alia shipyard feedback <id> "<changes>" [--start-over]   # on a plan: revise it; on a blocked task: your answer
alia shipyard pr <id>                           # agent pushes and opens a GitHub PR
alia shipyard merge <id>                        # merges the PR; resolves conflicts first if needed
alia shipyard done <id>
alia shipyard delete <id>
alia shipyard learn "<lesson>"                  # a lasting project preference
alia shipyard lessons
```

## How to help the user

- When the user describes several pieces of work, create one task for each
  independent piece. Write the description as a goal with constraints and a
  clear "done" condition. Add `--start` only when the user wants the work to
  begin now. Use `alia shipyard idea` for a rough idea the user wants to keep
  for later, and `--plan skip` for a small, clear change.
- Prefer small tasks that touch different files. Parallel tasks merge into
  the same base branch.
- To report status, run `alia shipyard list`. For a task in `human_review`, run
  `alia shipyard show <id>` and summarize its validation report and open
  findings.
- A task with the status "Blocked" or "Needs your input" waits for an answer.
  Show the user the agent's question from `alia shipyard show <id>`, and send
  their answer with `alia shipyard feedback <id> "<answer>"`.
- Do not merge, discard, or delete a task unless the user asks.
- Record a lesson only for a lasting preference, not for a one-off fix.

## Inside a task thread

A task thread gets five tools: `shipyard_triage`, `shipyard_report`,
`shipyard_learn`, `shipyard_spec` (the agreed spec of a brainstorm), and
`shipyard_done` (ends a stage as done, blocked, or needs input). The
Shipyard prompts tell the agent when to call each one. Do not call them in
other threads.
