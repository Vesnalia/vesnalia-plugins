# Chief for VesnALIA

Chief supervises work in VesnALIA without introducing another task-management application. A project can have multiple independent Chief supervisors, each with its own workers and reviewers as ordinary **visible VesnALIA threads** filed in one native sidebar section named **Chief**. Opening any of them uses VesnALIA's normal thread chat.

## Install

```sh
alia plugin install git:https://github.com/divyesh-puri/bb-plugin-chief.git@semver:^0.1.0
```

## Workflow

1. Open VesnALIA's project-aware **New Thread** screen and click **Start Chief**. Each click creates and opens a fresh independent Chief for that project; the CLI remains available for automation.
2. Talk to `Chief · <project name>` in the normal thread UI.
3. Chief delegates clearly titled work to a worker in its own managed worktree.
4. Workers report `ready` evidence or a `blocked` state with a blocker and recommendation. Only Chief can mark work `complete`.
5. Lifecycle events alert the correct project Chief when a managed thread becomes idle, fails, is archived/deleted, or appears stalled. Alerts use a durable SQLite outbox and retry after transient delivery failures.
6. Chief inspects live status and bounded output, continues safe reversible work, starts one read-only review after a worker is idle, marks verified non-running work complete, and escalates only genuine decisions.

The plugin never treats a generic SDK error as proof that a thread was deleted. Reconciliation uses live `deletedAt`/`archivedAt`, restores visible Chief-section filing, repairs missed status transitions, and retries transient reads, updates, and alerts.

## Project rules

Put `chief.md` at the project root. Chief reads it through VesnALIA's project file API and periodically refreshes its cache. Missing, empty, or unreadable files use conservative built-in rules.

## Configuration

```sh
alia plugin config chief set chiefProject proj_...
alia plugin config chief set chiefProvider codex
alia plugin config chief set chiefModel gpt-5.4
alia plugin config chief set workerProvider claude-code
alia plugin config chief set workerModel claude-sonnet-4-6
alia plugin config chief set reviewerProvider codex
alia plugin config chief set reviewerModel gpt-5.4
alia plugin config chief set stallMinutes 30
```

Provider/model fields may be empty to use VesnALIA defaults. Chief, worker, and reviewer reasoning are independent select settings. `chiefProject` is the default used outside an existing project context; it does not limit Chief to one project.

## CLI

```sh
alia chief status [--project proj_...] [--json]
alia chief start [--project proj_...] [--json]
alia chief create [--project proj_...] [--json]
alia chief adopt --thread thr_... [--json]
alia chief delegate --title "Fix checkout totals" --mission "..." --criteria "..." [--json]
alia chief inspect thr_...
alia chief continue thr_... --instruction "..." [--allow-edits] [--json]
alia chief review thr_worker [--focus "..."] [--json]
alia chief complete thr_... [--result "..."] [--json]
```

Agent tools expose the lifecycle: `chief_delegate`, project-scoped `chief_roster`, `chief_inspect`, `chief_continue`, `chief_review`, `chief_complete`, and worker/reviewer `chief_report`.

## Build and verify

```sh
npm install
alia plugin types --check
npx tsc --noEmit
npm test
alia plugin build
```

The plugin adds a project-aware **Start Chief** launcher to VesnALIA's New Thread screen and a compact Crown + Chief badge to Chief thread headers. It has no standalone Chief workspace, custom sidebar replacement, or task-management UI.
