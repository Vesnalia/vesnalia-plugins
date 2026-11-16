---
name: board
description: Work the project's Kanban over VesnALIA Tasks — the "Task board" plugin page. Read and change real VesnALIA Tasks (statuses, priorities, due dates, labels, descriptions, comments) that show up on the user's board.
---

# Tasks Kanban board ("Task board")

The user has a project-wide Kanban page in the left sidebar (plugin
`tasks-kanban`, panel "Task board", Russian UI shows "Доска задач"). It is a
live view over the built-in **VesnALIA Tasks** tracker: the same tasks, columns,
and data that `alia tasks` uses. Nothing is a copy — a card moved on the board
moves the real task.

## When to use

- The user refers to "the board", "kanban", "доска", or to task columns
  (Backlog / To Do / In Progress / In Review / Done / Canceled).
- The user asks to move, finish, start, or create a task and expects it to
  appear on the board.
- You are handed a task key (for example `SPBU-10` or `PROJ-3`) and asked to
  progress it.

## How to act on tasks

Use the built-in `alia tasks` CLI — the board refreshes automatically from the
same data:

```sh
alia tasks project list                     # find tracker projects and prefixes
alia tasks list --project <PREFIX>          # see keys, statuses, due dates
alia tasks show <KEY>                       # full task: description, comments
alia tasks update <KEY> --status in_progress # move a card
alia tasks update <KEY> --priority high --due 2026-12-01
alia tasks create --project <PREFIX> --title "…" --description-file ./x.md
alia tasks comment <KEY> --body "…"
```

Prefer stable keys (`SPBU-10`) over ids. After every meaningful change, the
board (and the sidebar task list) update on their own — do not tell the user
to refresh.

## Keep the board honest

- Set the status to what the work really is: `in_progress` while working,
  `in_review` when it needs the user's eyes, `done` only when done.
- One comment per meaningful milestone; no progress pings.
- If you create a task for a deadline the user stated, set `--due` to that
  date (YYYY-MM-DD) so it shows on the card.
