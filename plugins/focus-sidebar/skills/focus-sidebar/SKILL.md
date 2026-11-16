---
name: focus-sidebar
description: Change the Focus Sidebar thread list's focus window (how many hours of activity keep a thread in the Focus tab), whether closed threads show in its Archive tab, or whether automation threads may enter Focus, with `alia focus-sidebar`.
---

# Focus Sidebar

The Focus Sidebar plugin replaces VesnALIA's sidebar thread list with three tabs:

- **Focus**: threads with activity inside the focus window (default 8 hours),
  plus any thread that is running, waiting for user input, has queued work, or
  is pinned. Periodic threads are left out unless pinned or waiting for user
  input.
- **Periodic**: threads VesnALIA's automations run on a schedule, both the ones an
  automation spawns and the ones it re-prompts each tick (its target thread).
  With the automations setting on they are mixed into Focus and Archive like
  any other thread, and the tab is hidden.
- **Archive**: every other thread, grouped by day, newest first. With the
  Closed setting on, it also lists archived ("closed") threads.

The list has a search box (titles, projects, branches, then message text) and
a close button on each row and in the thread header. Close is VesnALIA's own thread
archive; it is not automatic.

## Commands

```sh
alia focus-sidebar show [--json]             # current settings
alia focus-sidebar hours <1-168> [--json]    # set the focus window in hours
alia focus-sidebar closed <on|off> [--json]  # list closed threads in Archive
alia focus-sidebar automations <on|off> [--json]  # on: mix periodic threads into Focus; off: Periodic tab
```

Settings are stored on the VesnALIA server and apply to every connected window and
device at once.

To archive (close) or reopen a thread from a shell, use VesnALIA's own commands:
`alia thread archive <id>` and `alia thread unarchive <id>`. To search threads,
use `alia thread search <query>`.
