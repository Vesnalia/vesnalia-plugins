# Simple Sidebar Folders

Adds one level above projects in the BB sidebar:

```
▾ WORK
    academy
      thread …
    dealtracker2
▸ PERSONAL  3 •
```

Click a folder to fold or unfold all of its projects. When a folder is folded,
it shows the number of projects in it, plus a dot if one of their threads
needs you.

BB's own project and thread rows do not change. The plugin does not replace
the thread list. It adds folder headers into BB's list and sorts the projects
under them. A thread-list plugin that renders BB's list, for example BB
Office, continues to work.

## Use

- **Drag a project onto a folder to file it**, using BB's own drag: grab the
  project by its name, the same way you reorder projects. A line marks the
  band it will land in. Drop it on a folder header or among that folder's
  projects, or above the first folder to unfile it. Escape cancels. On a
  touch screen, press and hold the project name first, as BB requires for
  its own drag. A quick swipe scrolls and files nothing.
- Opening a thread whose project is in a folded folder opens that folder.
- **New folder** sits at the end of the list. Click it, type a name, press
  Enter. Escape adds nothing.
- Hover over a folder and click **⋯** to rename, move, or delete it.
- Projects that are in no folder stay on top, in BB's order.

Agents use the `bb sidebar-folders` command:

```sh
bb sidebar-folders list
bb sidebar-folders create Work
bb sidebar-folders assign <project-id> <folder-id>
```

## Storage

- Folders and their projects: plugin storage on the BB server. All clients
  show the same folders.
- Which folders are folded: `localStorage`, per client. A work laptop can fold
  Personal while a home machine folds Work.

## Limits

- The plugin finds BB's project blocks by the `data-sidebar-project-id`
  attribute. If a BB update changes this markup, the folders do not show and
  BB's plain list shows instead.
- Only BB's "by project" sidebar layout is supported.
- Inside a folder, the projects keep BB's own order. The drag is BB's own, so
  it reorders projects as well as filing them.
- Keyboard next/previous thread follows BB's own order, not the order in
  folders.
- Filing is pointer-only. There is no keyboard equivalent; use
  `bb sidebar-folders assign` instead.

## Develop

```sh
npm install --include=dev
bb plugin build
bb plugin install .
bb plugin reload simple-sidebar-folders
```
