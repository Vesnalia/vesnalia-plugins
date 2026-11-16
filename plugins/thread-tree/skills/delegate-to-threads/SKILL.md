---
name: delegate-to-threads
description: Use before delegating work to a subagent in a VesnALIA thread — spawn the subagent as a VesnALIA child thread with `alia thread spawn --parent-self` so the user sees it nested under this thread and can open and message it; keep the in-process Agent/subagent tool for short read-only lookups.
---

# Delegate to child threads

A child thread is a full VesnALIA thread nested under its parent in the sidebar. The
user can open it, read it, and message it. A provider subagent (Claude Code's
`Agent` tool, Codex subagents) runs inside your own session: the user only sees
a counter on your row and cannot talk to it.

## Which one

Spawn a child thread when the delegated work:

- edits code or other files, or is one slice of a larger plan;
- will likely run longer than a few minutes;
- is something the user may want to watch, steer, or continue later.

Keep the in-process subagent for short, read-only work whose answer you consume
at once: searching code, reading docs, fetching a page, a quick check.

## Spawning

Write the brief to a file or stdin; the child has none of your context, so give
it the goal, the files and docs to read, what is already ruled out, and what to
report back.

```sh
alia thread spawn --parent-self --project "$ALIA_PROJECT_ID" \
  --title "Short task name" --prompt-file - <<'EOF'
<brief>
EOF
```

Choose where it runs:

- Read-only work, reviews, or edits that must land in your working tree:
  add `--environment "$ALIA_ENVIRONMENT_ID"`. Do not let two threads edit the same
  files in one environment at the same time.
- Independent code changes in parallel: omit the flag; the child gets its own
  worktree on your machine.

Provider, model, and permission mode follow this thread unless you pass
`--provider`, `--model`, or `--permission-mode`.

## Getting results

VesnALIA wakes this thread when a child's turn finishes, fails, or needs input, and
delivers the child's final response; do not poll in a loop. Read a finished
child with `alia thread output <id>`, wait on one with `alia thread wait <id>`, and
send follow-ups with `alia thread tell <id> --message-file -`. Children can spawn
their own children the same way.

## Cleanup

Leave finished children in place so the user can review them; the user archives
them, and archiving a parent asks about its children.
