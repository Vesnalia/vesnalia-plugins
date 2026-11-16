---
name: context-handoff
description: Respond to an automatic Context Handoff checkpoint request, confirm a continuation's checkpoint, or inspect this thread's handoff status.
---

# Context Handoff

The user controls handoff with the per-thread switch above the chat input: enabling below 20% arms a handoff at 30% of the reported context window; enabling at or above 20% requests the next safe stopping point. Continuations are direct children of the original, start enabled, and hand off at 30%. Do not enable it or initiate a handoff yourself.

## In the thread that hands off

When a `[Context Handoff]` message arrives, finish the current turn and any important step, running tools, dependent operations, and verification at a safe point. Do not cut off a turn or abandon work midway. Follow its instructions to preserve the original request and later requirements in `PLAN.md` and write fresh progress and the exact next step in `HANDOFF.md` under the specified workspace folder. The first line of `HANDOFF.md` must be the exact `Checkpoint: <id>` line the message gives. Preserve decisions, rejected approaches, unanswered questions, and verification results. Do not invent new work or bypass a pending user decision.

After saving the checkpoint, run `alia context-handoff ready`. Trust the line it prints, not the exit code (VesnALIA's CLI on Windows can exit with an error after printing).

- `HANDOFF_OK` means the next thread has started. Give the user its link in one line and stop working in this thread.
- `Not handed off` says exactly what to do: fix the named notes and run it again; or wait a minute without working and run it again (a reminder follows); or stop and tell the user (the next part failed or stopped, or VesnALIA refused to start it); or carry on here (handoff was switched off). Do that and nothing else.
- Never start another thread yourself, and never re-enable the switch.

## In a new part

Once, at the start, read `PLAN.md` and `HANDOFF.md`, then run `alia context-handoff resume <id>` with the id from `HANDOFF.md`'s `Checkpoint:` line before any other work. Continue from the recorded next step only after it prints `RESUME_OK`. If a file or the Checkpoint line is missing, or it prints `Not resumed`, do what that line says; usually that is to tell the user in one line and stop. Do not rebuild the work from memory or from the earlier thread.

## Status

`alia context-handoff status [--json]` reports this thread's switch, stage, the next part's state, and context usage. Commands in an agent session can act only on that session's thread. The previous mode, now, and skip commands are no longer available.
