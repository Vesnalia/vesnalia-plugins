Move your T3 Code threads into VesnALIA without losing the conversation or the agent's context.

## What you get

- Every selected T3 thread appears in the matching VesnALIA project with its messages, reasoning, tool calls, plans, and original dates.
- A follow-up message in VesnALIA continues the conversation with the agent's full context, for both Claude Code and Codex threads.
- Settled T3 threads can come over archived, and T3 projects with nothing to import can still become VesnALIA projects.

## How it works

Run `alia t3-import preview` to see which threads would be imported and which VesnALIA projects they land in. Settled threads are left out unless you add `--archive-settled` or `--include-settled`. Nothing changes until `alia t3-import run --yes`, which backs up the VesnALIA database first and skips any thread it has already imported.

## Requirements

T3 Code, Claude Code or Codex, and VesnALIA must run on the same computer. This release supports VesnALIA 0.45 and writes threads directly to the VesnALIA database, checking its tables before every run.
