# alia-plugin-firstmate

Run firstmate-style agent crews inside [VesnALIA](https://github.com/get-bb/bb): one captain thread dispatches crewmate child threads, supervises them, and brings back finished work.

The plugin implements the [firstmate](https://github.com/kunchenguid/firstmate) captain/crew protocol on VesnALIA primitives. A VesnALIA thread is the captain. Crews are child VesnALIA threads with their own managed worktrees. Status reports use the upstream protocol (`DONE:` / `BLOCKED:` / `FAILED:`), supervision rides on thread events instead of a tmux watcher, and merges are VesnALIA PR merges or ff-only local lands.

## Install

```sh
alia plugin install git:https://github.com/amrtawfik160/bb-plugin-firstmate
```

Or from a local checkout:

```sh
alia plugin install path:/path/to/alia-plugin-firstmate --yes
```

Requires `alia >= 0.43` and `aliaPluginSdk >= 0.4.87` (see `package.json` engines).

## Quick start

Run `/captain` in any thread to take the deck, then work in plain language or with the CLI:

```sh
alia firstmate dispatch --project <project-id> -- "fix the flaky login test"
alia firstmate watch                      # blocks until crews go idle (no polling)
alia firstmate deliver <crew-id>          # committed + uncommitted diff, PR URL
alia firstmate merge <crew-id> --yes      # merge green PR, or ff-only local land
```

Crews end every task with a status verdict. `deliver` shows what they committed. You decide what lands.

## What you get

| Command | What it does |
| --- | --- |
| `deck` / `session` | Mark the thread as captain, print the fleet digest |
| `dispatch` | Spawn a ship (isolated worktree) or scout (read-only) crew |
| `tell` / `interrupt` / `stop` / `retry` | Steer crews: doorbell, hard stop, re-run |
| `watch` / `bearings` | Wait on crews, or print the 5-section fleet digest |
| `deliver` / `merge` / `promote` | Collect diffs, land work, promote a scout to a ship |
| `queue` | Backlog with dependencies (`--after`) and time gates (`--wait-until`) |
| `decide` | Durable captain decisions surfaced as NEEDS DECISION pings |
| `posture` | Per-project delivery mode: `direct-PR`, `no-mistakes`, `local-only`, plus yolo merge authority |
| `memory` | Captain preferences and dated fleet learnings, reprinted on deck |
| `afk` / `quiet` | Away mode (holds routine pings, keeps failures) and ping batching |
| `secondmate` | Register domain-captain threads; dispatches to that project route there |
| `forget` | Drop a crew record, optionally archiving its thread |

Ships get their own managed worktree by default, so two ships never share a checkout. Scouts are read-only. Crew threads cannot dispatch nested crews. Parent permission is the ceiling for everything a crew can do.

The Fleet panel (sidebar navigation) lists every crew with live status; a thread-header chip and `@crew` mentions tie threads back to their crew.

## Supervision that cannot miss a report

Three layers, all event-driven:

1. **Thread events.** `thread.idle`, `thread.failed`, `turn.failed`, and `interaction.pending` ping the captain the moment a crew finishes, fails, or blocks on input.
2. **Protocol nudge.** When a crew goes idle without a `DONE:` / `BLOCKED:` / `FAILED:` verdict, the plugin doorbells it with the upstream turnend-guard banner and asks for a restated outcome. Bounded: `nudgeMaxPerCrew` (default 3) nudges per task, `nudgeCooldownSeconds` (default 60) apart. Exhausted nudges surface one `NEEDS DECISION`. Manual stops and interrupts are never nudged.
3. **Stuck checker.** A background service alerts when a busy crew's output has not changed for `supervisionStuckMin` minutes (default 30).

## The real firstmate toolbelt

The native tools cover the liaison loop. For the full bash policy engine (brief, gate, inbox, watch, merge, teardown, afk, bearings, backlog), the plugin drives upstream firstmate's `bin/` scripts with VesnALIA as the session backend:

```sh
alia firstmate init --real        # clone upstream firstmate, overlay backends/alia.sh, set config/backend=alia
alia firstmate fm <script> ...    # run any bin/fm-<script>.sh with FM_BACKEND=alia
```

`overlay/bin/backends/alia.sh` adapts firstmate's backend operations to VesnALIA: spawn becomes `alia thread spawn` into a managed worktree, capture becomes `alia thread output`, send becomes `alia thread tell`, kill becomes `alia thread stop`. Native dispatch writes the same `state/<id>.meta` ledger the scripts do, so `fm-peek`, `fm-send`, and the plugin's tools see one fleet.

ALIA-specific behavior in this fork:

- **Event-push watcher.** `backend=alia` reports push-capable. `fm-watch` blocks on `alia thread wait --status idle` instead of sleeping through its poll budget. A pending interaction surfaces as the blocked edge; the first window to finish wins the multi-window wait.
- **Refusal-safe teardown.** `remove_worktree` inspects the crew worktree first and refuses dirty trees with the changed-file list, so `fm-teardown` aborts and keeps records instead of letting a later force-removal eat uncommitted work. Discarding is an explicit `forget --force`.
- **No secondmate endpoint yet.** Domain captains use the native `secondmate register` instead.

## Configuration

`alia plugin config firstmate` (or the plugin settings UI):

| Key | Default | Purpose |
| --- | --- | --- |
| `firstmateRepo` | upstream repo URL | Repo cloned by `init --real` |
| `fmHome` | empty | Firstmate home on the host; set by `init --real` |
| `defaultProvider` | blank | Crew provider id (blank = VesnALIA resolves) |
| `defaultPermissionMode` | blank | Crew permission mode (blank = inherit) |
| `supervisionEnabled` | on | Captain pings on done/fail/stuck |
| `supervisionIntervalMin` | 5 | Stuck-check sweep interval |
| `supervisionStuckMin` | 30 | Minutes without output change before a stuck alert |
| `nudgeEnabled` | on | Doorbell idle crews that missed the status protocol |
| `nudgeMaxPerCrew` | 3 | Nudges per crew task before NEEDS DECISION |
| `nudgeCooldownSeconds` | 60 | Minimum gap between nudges for one crew |

## Skills

The plugin ships catalog skills: `/captain` (take the deck, full contract), `/firstmate` (crew mechanics), `/bearings` (fleet digest), `/afk`, `/quiet`, `/ahoy` (catch-up), `/stow` (close-out knowledge capture).

## Development

```sh
npm test                       # node --test over lib/ and server.test.ts
npx tsc --noEmit               # typecheck
alia plugin build                # compile dist/
alia plugin reload firstmate     # reload the running plugin
```

The overlay patches (`overlay/firstmate-alia-backend.patch`, `overlay/firstmate-alia-teardown.patch`) must keep applying to pristine upstream firstmate; `overlay/install-alia-backend.py` verifies and installs them into a home. When changing dispatchers, run it against a fresh clone before committing.

## Credits

The captain/crew protocol, status grammar, and `bin/` toolbelt come from [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate). This plugin maps that surface onto VesnALIA threads, worktrees, events, and diffs rather than porting the scripts.

## License

[MIT](LICENSE)
