---
name: plugin-updates
description: Check VesnALIA plugins for updates, including newer releases outside a plugin's installed semver range or pin, with the `alia plugin-updates` CLI. Use when the user asks whether plugins have updates, or to update, or to ignore one.
---

# Plugin updates

`alia plugin outdated` only reports updates inside each plugin's installed
range. `alia plugin-updates` also finds newer git releases beyond the range
(e.g. `^0.7.0` → `0.9.2`) or newer than a pinned commit or tag.

## Commands

| Command | Effect |
| --- | --- |
| `alia plugin-updates list [--json]` | Show the last check's results. |
| `alia plugin-updates check [--json] [--reannounce]` | Check now (contacts each plugin's git remote). `--reannounce` toasts already-announced updates again. |
| `alia plugin-updates update <id>` | Start VesnALIA's in-place update for a compatible update (deferred until the plugin's pending out-of-range update, if any, is done). |
| `alia plugin-updates update --all` | Start every compatible update. Never includes out-of-range ones. |
| `alia plugin-updates update <id> --out-of-range` | Remove and reinstall at the newer release, restoring settings. Waits for the plugin's running VesnALIA update first; gives up, changing nothing, after 10 minutes. |
| `alia plugin-updates ignore <id>` | Hide the plugin's pending versions until a newer one appears. |

`check` exits 1 when the check fails, printing the last good results with a
`Last check failed …` line; `--json` includes `lastFailure`. When every
plugin's own check failed (e.g. no network), each plugin's error follows that
line (`lastFailure.failures`). Plugins VesnALIA couldn't check are listed under
`Couldn't check for updates` (`updateCheckFailures` in `--json`); that alone
doesn't fail `check`. Their updates from the last check stay listed, marked
`(stale: last confirmed …)` (`stale.confirmedAt` in `--json`): tell the user
they may be out of date.

A release VesnALIA refused to install for its engines (e.g. `engines.aliaPluginSdk`)
is listed under `Blocked by engine ranges` with VesnALIA's reason from then on, until
VesnALIA or the plugin changes version or a newer release appears.

## Rules

- Updates for disabled plugins are listed as `<id> (disabled)` and skipped by
  `update --all`. Mention that the plugin is off; the user may prefer to
  remove it (`alia plugin remove`) rather than update it.
- Updates run third-party code. Only run `update` when the user asked for
  that plugin to be updated.
- `--out-of-range` reinstalls the plugin: settings are restored, but its
  storage and schedules may reset. Confirm with the user first and show the
  compare link from `list`.
- Only `alia plugin-updates update` waits for a pending `--out-of-range`
  update. Don't update that plugin with VesnALIA's own plugin commands until it's
  done; nothing holds those back mid-reinstall.
- Plugins with secret settings, and this plugin itself, can't be moved out of
  range automatically. The command prints the manual steps instead; show them
  to the user rather than running them.
