---
name: feature-flags
description: Inspect and toggle LaunchDarkly feature flags from the shell with the `alia feature-flags` command, and attach a flag to the current thread. Use when a task needs to read a flag's state across environments, turn a flag on or off for testing, or record which flag a thread is about.
---

# LaunchDarkly feature flags

The `alia feature-flags` command reads and toggles LaunchDarkly flags. It talks to
LaunchDarkly with the token set in the plugin settings; all changes are real and
take effect immediately.

## Inspect

```sh
alia feature-flags list [--env <env>] [--mine] [--json]   # all flags, per-env state
alia feature-flags status <flag-key> [--json]             # one flag across envs
alia feature-flags open <flag-key>                        # print the LaunchDarkly URL
```

Prefer `--json` when you need to parse the result.

## Toggle

```sh
alia feature-flags on  <flag-key> --env <env> [--yes]
alia feature-flags off <flag-key> --env <env> [--yes]
```

`--env` is required. A toggle changes the live flag right away.

## Attach to the thread

Record which flag the current thread is about, so it shows in the thread's
LaunchDarkly Flags panel and composer banner.

```sh
alia feature-flags link <flag-key>     # attach to the current thread
alia feature-flags unlink <flag-key>   # detach
alia feature-flags linked [--json]     # what is attached to this thread
```

Link the flag a thread is working on when you can tell which one it is (from
the branch, the task, or the user). These commands only work inside a thread.

## Rules

- **Never touch production unless the user asked.** Protected environments
  (see the plugin's `protectedEnvironments` setting, `production` by default)
  refuse to change without `--yes`. Do not pass `--yes` on your own.
- **Revert what you flip.** If you turn a flag on to test something, turn it
  back to its previous state when done. Check the starting state with
  `status` first so you know what to restore.
- Toggle in the lowest environment that works (usually `development`).
- If a command reports no token is set, tell the user to configure the plugin
  rather than guessing a token.
