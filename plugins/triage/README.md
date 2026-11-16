# Triage for VesnALIA

Keep agent tasks, progress, and work that needs your attention in one board.
Run tasks now or schedule them for later, organize them into configurable stages,
and turn existing VesnALIA sessions into cards. Open each card's linked conversation
to follow the work.

## Screenshots

Track tasks across stages, projects, and machines.

![Triage board with task cards grouped by workflow stage](https://github.com/user-attachments/assets/ccc76352-f56e-4e86-9bab-c9ac229e1c33)

Create a task with VesnALIA's agent controls and choose when it starts.

![New task dialog with agent configuration and start controls](https://github.com/user-attachments/assets/02fe89a8-c63c-4fa3-a91b-cefdd29df095)

Review recent updates and find work that needs your attention.

![Updates panel with recent task activity and attention filters](https://github.com/user-attachments/assets/ecc281cd-2627-4457-b986-9efcde96b989)

## Requirements

- VesnALIA 0.42+ with a compatible Plugin SDK 0.4.47 runtime.
- A configured agent provider. Provider accounts and usage charges still apply.
- VesnALIA and Triage must be running for scheduled work to start. Overdue tasks are
  picked up when the scheduler resumes.

Triage stores cards and update history in VesnALIA's plugin-owned SQLite database.
It does not require a separate Triage account or external task service.
Browser notifications require your permission.

## Install from Git

Install the current main branch with:

```sh
alia plugin install git:https://github.com/MayankBansal12/bb-plugin-triage.git@main
```

This tracks development on `main`.

## Development

```sh
npm ci
alia plugin install .
alia plugin dev
```

The plugin stores its board in VesnALIA's plugin-owned SQLite database. Worker
threads default to hidden sidebar visibility and remain directly
openable from their cards.

## Agent CLI

```sh
alia triage list
alia triage show 42
alia triage run 42
alia triage move 42 "Review" --summary "Implementation is ready"
alia triage stages
```

## Sessions and the sidebar

- Open a session and choose **Move to Triage** in its header. Triage creates a
  card for the existing conversation and hides it from the regular session list.
  Repeating the action reuses the same card; it never starts another agent.
- Linked cards and the session header's **Triage #…** menu show either
  **Show session in sidebar** or **Hide session from sidebar**, based on current visibility.
  Showing a session keeps its Triage card and history.
- In **Settings → Triage**, enable **Show Triage sessions in the sidebar** to show
  all existing linked sessions and future task sessions in the regular session
  list. It defaults to **off**. Changing it applies to all linked sessions;
  individual show/hide actions override it until the next setting change.
- **Triage settings → Show Triage in sidebar** controls the separate, default-off card section.
  When VesnALIA uses the **Triage above threads** sidebar layout, it also provides a
  **Move current session to Triage** control. With another sidebar plugin,
  use the session header action.

Imported sessions receive their assigned Triage agent tool and instructions on
subsequent agent configuration. Importing does not interrupt a running turn.

## Board controls

- **Triage settings** lets you rename stages and reorder them with drag handles
  (or focus a handle and use the up/down arrow keys).
- **Updates** opens on **Recent**, showing newest events first, grouped by day.
  Needs you, Running, and Pending show current task states. Opening a task marks
  its updates read; **Mark all read** clears the remaining unread updates.
- Search the project picker by name. Selecting a project selects its configured
  default machine when available; select **All machines** to widen the view.
  The personal project is labeled **Personal**.

## Compatibility and verification

Requires VesnALIA 0.42+ and a compatible Plugin SDK 0.4.47 runtime. For a reproducible
checkout, run `npm ci`, `npm run typecheck`, `npm test`, and `alia plugin build`.
The GitHub Actions workflow checks types, tests, and production dependencies.

New cards start in To Do. Agent execution moves them to In Progress; agents are
instructed to explicitly report completion or a need for attention. Ending a turn
alone does not mark work complete. Scheduled tasks require VesnALIA and Triage to be
running; overdue work is picked up when the scheduler resumes.

## License

[MIT](LICENSE) © 2026 Mayank Bansal.
