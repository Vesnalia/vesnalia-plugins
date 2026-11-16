---
name: terminal-jobs
description: Run any agent-started command that can outlive the current tool call. Use for finite jobs, servers, watchers, and other durable terminal work when VesnALIA terminal-job is installed.
---

# Terminal jobs

Use `alia terminal-job run` for each new durable command. Use a specialized skill-owned launcher when one exists. That launcher owns its `terminal-job` call; invoke it directly.

For a finite command in the current thread:

```bash
alia terminal-job run --title "TITLE" --artifact-root "$ALIA_THREAD_STORAGE/terminal-jobs" -- COMMAND ARG...
```

For a server or watcher, use the same command without shell background syntax. The job remains `observing` while the command runs. Stop it when the user asks:

```bash
alia terminal stop TERMINAL_ID
```

Use an explicit scope only when needed:

```bash
alia terminal-job run --title "TITLE" --thread THREAD --notify-thread "$ALIA_THREAD_ID" --artifact-root /absolute/path -- COMMAND ARG...
alia terminal-job run --title "TITLE" --environment ENVIRONMENT --notify-thread "$ALIA_THREAD_ID" --artifact-root /absolute/path -- COMMAND ARG...
alia terminal-job run --title "TITLE" --machine HOST --cwd /absolute/path --notify-thread "$ALIA_THREAD_ID" --artifact-root /absolute/path -- COMMAND ARG...
```

Arguments after literal `--` belong to the command. Pass each argument separately. The invoking shell's environment and current directory do not cross to the target host. Thread and environment scopes use their VesnALIA environment directory. Only machine scope accepts `--cwd`. Put secrets in mode-0600 target-host files and make the command read those files.

Register an existing terminal only when its durable log path is known:

```bash
alia terminal-job watch TERMINAL_ID --notify-thread "$ALIA_THREAD_ID" --log /absolute/path
```

`watch` does not recover scrollback and has no runner outcome. Prefer `run` for new work.

Return control after launch. The plugin sends an at-least-once queued completion message with a stable marker. Inspect bounded history or retry a notice with:

```bash
alia terminal-job show JOB_ID --json
alia terminal-job list --limit 20 --json
alia terminal-job retry-notification JOB_ID --json
```

A retry after uncertain delivery can duplicate the same stable marker. `show` and `list` omit command arguments.

Read bounded native output only while daemon scrollback exists:

```bash
alia terminal output TERMINAL_ID --tail-bytes N
```

For retained output, get `hostId`, `artifacts.root`, and `artifacts.log` from the `show` result, then run:

```bash
alia file read LOG_PATH --host HOST_ID --root ARTIFACT_ROOT
```

Preview settled data before explicit deletion:

```bash
alia terminal-job prune --older-than-days 30 --limit 100 --json
alia terminal-job prune --older-than-days 30 --limit 100 --delete --json
```

Prune removes only guarded run directories and matching settled rows. It removes only the row for a watched job.
