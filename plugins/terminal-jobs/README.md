# Terminal jobs

Terminal Jobs is a headless [VesnALIA](https://github.com/get-bb/bb) plugin for durable terminal commands. It stores job state in plugin SQLite, writes command artifacts on the target host, observes the VesnALIA terminal, and sends an at-least-once completion notice to one fixed owner thread.

The plugin registers `alia terminal-job`, a managed host entry, and the `terminal-jobs` agent skill. The managed host artifact is also the command runner. A path or Git install does not need a separate runner checkout, link, or `PATH` entry on target hosts.

## Requirements

- VesnALIA 0.41.0 or later with plugin SDK 0.4.34 or later
- Node.js 22 or later on each target host
- A POSIX target host, including WSL; native Windows is rejected before a job is stored

## Install

After version 0.2.0 is released, install its immutable Git tag on the VesnALIA server host:

```sh
alia plugin install git:https://github.com/ryanbbrown/bb-plugin-terminal-jobs.git@v0.2.0
```

VesnALIA builds and downloads the server and host artifacts. No separate target-host setup is required.

## Run and inspect jobs

Run a command in the invoking thread:

```sh
alia terminal-job run \
  --title "build docs" \
  --artifact-root "$ALIA_THREAD_STORAGE/terminal-jobs" \
  --json \
  -- npm run build
```

Use `--thread`, `--environment`, or `--machine` to select another scope. Environment and machine scopes require `--notify-thread`. The invoking shell's current directory does not cross the host boundary. Thread and environment scopes use their VesnALIA environment directory. Only machine scope accepts `--cwd`. Scope flags are mutually exclusive.

A run checks the selected host before it stores a row or creates a terminal. The check rejects an offline host, native Windows, Node before version 22, an incompatible runner protocol, or unsafe runtime paths. `watch` does not use the runner check.

The default delivery is `queue`, which maps to `queue-if-active` and does not interrupt an active owner. `--delivery steer` maps to `steer-if-active`.

Register an existing terminal only when its durable log path is known:

```sh
alia terminal-job watch TERMINAL_ID \
  --notify-thread THREAD_ID \
  --log /absolute/path/to/durable.log \
  --json
```

`watch` does not copy VesnALIA scrollback and has no runner outcome.

Inspect one job, bounded recent history, or an eligible notification:

```sh
alia terminal-job show JOB_ID --json
alia terminal-job list --limit 20 --json
alia terminal-job retry-notification JOB_ID --json
```

`show` and `list` omit command arguments. `list` defaults to 20 rows and accepts 1 through 200. A malformed stored row is reported as skipped and is not changed.

Read bounded native terminal output only while daemon scrollback exists:

```sh
alia terminal output TERMINAL_ID --tail-bytes N
```

For retained output, read `hostId`, `artifacts.root`, and `artifacts.log` from `alia terminal-job show JOB_ID --json`, then run:

```sh
alia file read LOG_PATH --host HOST_ID --root ARTIFACT_ROOT
```

Stop a running job through its VesnALIA terminal:

```sh
alia terminal stop TERMINAL_ID
```

Retry accepts only `retry_wait` and `abandoned`. A crash after VesnALIA accepts a notice but before the plugin records it can cause a duplicate. Every attempt has the same `[terminal-job:JOB_ID]` marker. A row claimed for pruning cannot be retried.

## Secrets and local data

Command arguments, launch metadata, SQLite rows, and logs can contain sensitive data. Environment variables from the shell that invokes `alia terminal-job` do not cross the VesnALIA host boundary. Put secrets in mode-0600 files on the target host, then make the command read those files. Do not put secrets in command arguments.

A run writes these mode-protected files on the target host:

```text
<artifact-root>/<job-id>/
  launch.json
  output.log
  outcome.json
```

The directory uses mode `0700`. Files use mode `0600`. `launch.json` and `outcome.json` use artifact schema version 1 and same-directory atomic renames after `fsync`.

Ordinary `alia terminal stop TERMINAL_ID` is covered on POSIX hosts: VesnALIA sends SIGHUP to the runner, and the runner forwards it to the detached command process group. A forced runner loss, direct SIGKILL, or daemon loss can leave descendant processes, a partial log, and no outcome. A missing or invalid outcome means command success is unknown and never becomes success.

## Prune settled data

Preview old settled jobs first:

```sh
alia terminal-job prune --older-than-days 30 --limit 100 --json
```

Add `--delete` to remove each run's guarded artifact directory on its target host, then remove the matching claimed database row. Watched jobs have no plugin-owned directory, so deletion removes only their rows.

Prune accepts ages from 1 through 36,500 days and limits from 1 through 200. It selects oldest rows first. It cannot select active, unsettled, too-new, malformed, or rows claimed by the current plugin generation. A later explicit prune atomically reclaims a claim left by an earlier plugin generation. A path must match the exact normalized `<artifact-root>/<job-id>` layout before VesnALIA receives a remove request. A missing directory counts as already removed. Any other host removal failure keeps the row for a later retry.

No automatic retention policy runs. Preview and schedule explicit pruning to match your storage policy.

## Develop and verify

Use Node.js 22:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run lint:shell
npm run check:dist
npm run pack:check
npm run smoke:install
```

Tests use the published `@vesnalia/plugin-sdk` 0.4.34 package, its fake server and host-entry harnesses, real temporary SQLite storage, and the built `dist/host.js` runner. Disposable path and local-Git smoke tests use public `alia-app` 0.41.0 and do not install into the user's VesnALIA data directory.

`npm run sdk:check` requires the source declarations and both built artifacts to use exactly SDK 0.4.34. Public `alia-app` 0.41.0 stamps that metadata. Newer compatible hosts satisfy the `>=0.4.34` engine range.

CI runs the full gates on Linux and macOS. WSL follows the Linux path; native Windows is unsupported.

## License

[MIT](LICENSE)
