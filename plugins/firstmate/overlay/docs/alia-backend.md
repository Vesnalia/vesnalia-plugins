# VesnALIA runtime backend

VesnALIA is a spawn-capable firstmate backend: a VesnALIA thread is the session endpoint, and a VesnALIA managed worktree is the task copy. The `bin/` toolbelt stays the policy engine (brief, gate, inbox, watch, merge, teardown, afk, bearings, backlog). VesnALIA replaces tmux/herdr/zellij/orca/cmux for that home.

The crewmate is the VesnALIA agent started by `alia thread spawn`, not a TUI harness launched in a pane.

## Setup

Prerequisites: `alia` CLI enrolled on the host, `python3` (JSON parse), and a VesnALIA project id.

Select VesnALIA with local `config/backend` containing `alia`, `FM_BACKEND=alia`, or `alia firstmate init --real` (plugin overlay writes both). Never auto-detected.

Also set `config/alia-project` or `FM_ALIA_PROJECT_ID` to the VesnALIA project that should own spawned threads.

Optional:

- `FM_ALIA_PARENT_THREAD_ID` / `ALIA_THREAD_ID` — parent (captain) thread
- `FM_ALIA_MACHINE` / `ALIA_MACHINE` — host for managed-worktree (plugin `fm` sets this)
- `FM_ALIA_PROVIDER` `FM_ALIA_MODEL` `FM_ALIA_PERMISSION_MODE`
- `FM_ALIA_VISIBLE=0` / `FM_ALIA_HIDDEN=1` — hide child threads from the sidebar (default visible)
- `FM_ALIA_SHARED_ENV=1` — skip managed-worktree (ships should not)

Plugin entry: `alia firstmate fm spawn -- --mode direct-PR -- ship '<task>'` runs `bin/fm-spawn.sh` on the host with `FM_BACKEND=alia`.

## Task shape and metadata

```text
backend=alia
window=alia:<thread-id>
alia_thread_id=<thread-id>
worktree=<absolute managed-worktree path>
harness=alia
```

`window=` is `alia:<thread-id>` (the watcher groups every VesnALIA window under session `alia`). `alia_thread_id=` is the bare thread id. Peek/send/teardown resolve `window=` through `fm_backend_resolve_selector`; the adapter strips a leading `alia:`.

`fm-spawn.sh` does not call Treehouse. Isolation and unlanded-work refusals still apply.

## Operations

| firstmate op | VesnALIA |
| --- | --- |
| create_task | `alia thread spawn --new-environment worktree --prompt <brief>` |
| capture | `alia thread output` |
| send_text_submit | `alia thread tell --mode queue` |
| send_key C-c | `alia thread tell --mode steer` interrupt |
| kill | `alia thread stop` |
| remove_worktree | Dirty tree: print the file list, exit 1, do not stop or archive. Clean: `alia thread stop` + `alia thread archive` (archive failure exits 1; no Treehouse) |
| busy_state | thread status → idle/busy |
| agent_state | missing/alive/dead from `alia thread show` |
| event wait | `alia thread wait --status idle` (first window to finish) |

Composer submit/retry is a no-op: VesnALIA has no TUI composer. Delivery is the tell JSON succeeding.

## Limits

- `remove_worktree` refuses a dirty crew worktree (uncommitted or untracked files on stderr, exit 1) before stop/archive. That failure is what makes `fm-teardown.sh` abort and keep the task record. This op never discards. `--force` / discard is the captain's `forget --force`.
- Event push is supported. `backend=alia` is push-capable: the toolbelt watcher blocks in `alia thread wait --status idle` instead of sleeping the poll interval. A pending interaction is the blocked edge (immediate escalation, deduped). Reaching idle ends the wait so the poll loop runs; it is not a stale wake.
- No `--secondmate` yet (same class as Orca/cmux).
- No Escape key.
- Relay/mail/voice stay firstmate scripts if those planes are enabled; they are not rewritten in the VesnALIA plugin.
- Native `alia firstmate dispatch` uses the plugin SDK (pluginMetadata, Fleet UI) and, when `fmHome` is set, writes the same `state/<id>.meta` ledger `fm-spawn` does. `alia firstmate fm` is how the bash toolbelt drives the same VesnALIA runtime.
