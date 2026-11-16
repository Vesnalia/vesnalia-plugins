# Focus Sidebar for VesnALIA

Keep only the threads you are working on right now in the [VesnALIA](https://getbb.app) sidebar.

Focus Sidebar replaces VesnALIA's thread list with three tabs:

- **Focus** shows the threads with activity in the last few hours (8 by default; pick 2, 4, 6, 8, 12 or 24). A thread that is running, waiting for your answer, has a queued message, or is pinned always stays in Focus, however old it is.
- **Periodic** holds the threads that VesnALIA's automations run on a schedule, so a job that ticks every few minutes doesn't fill Focus. That covers threads an automation spawns and threads an automation re-prompts on every tick (its target thread, such as a watcher that keeps one conversation going). A periodic thread that waits for your answer, or that you pinned, shows in Focus instead.
- **Archive** shows everything older, grouped by day (Today, Yesterday, the weekday, then the date), newest first. Turn on **Closed** to list the threads you closed too.

Above the tabs is a **search box**. It matches thread titles, project names and branches instantly, then adds matches from message text across open and closed threads, with the matching words highlighted.

Every row has a **close button** (✕ on hover; always visible on touch screens), and the thread header gets a **Close** button. Closing uses VesnALIA's own archive, with its Undo toast, and a closed thread can be reopened from Archive → Closed. Right-click or long-press a row for VesnALIA's full thread menu.

Nothing is archived automatically. Threads move between Focus and Archive by their last activity only, so worktrees and terminals are never touched until you close a thread yourself.

## Install

In VesnALIA, open **Plugins**, search for **Focus Sidebar** and install it. Or from a terminal:

```sh
alia plugin install git:https://github.com/grishaster80/bb-plugin-focus-sidebar.git
```

VesnALIA switches the sidebar to Focus Sidebar automatically. To go back to VesnALIA's own list, pick it under **Settings → Appearance → Sidebar**, or disable the plugin.

## Settings

The focus window and the Closed switch are in the list header. They are stored on the VesnALIA server, so every device that connects to it (desktop, laptop, phone) sees the same setting. The same settings from a terminal:

```sh
alia focus-sidebar show
alia focus-sidebar hours 6        # keep the last 6 hours in Focus
alia focus-sidebar closed on      # list closed threads in Archive
alia focus-sidebar automations on # mix periodic threads into Focus and hide the Periodic tab
```

## Develop

```sh
npm install
npm test             # list logic: focus window, day groups, search matching
npm run typecheck
alia plugin build      # writes dist/
alia plugin install .  # or `alia plugin dev` to rebuild on save
```

`lib/focus.ts` holds the list logic with no host imports. `app.tsx` is the sidebar UI and the header button, and `server.ts` stores the settings, registers the `alia focus-sidebar` command, and asks the automations plugin which threads its automations re-prompt.

## License

MIT
