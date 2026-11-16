# Simple Sidebar Folders

Adds one level above projects in the VesnALIA sidebar:

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

VesnALIA's own project and thread rows do not change. The plugin does not replace
the thread list. It adds folder headers into VesnALIA's list and sorts the projects
under them. A thread-list plugin that renders VesnALIA's list, for example VesnALIA
Office, continues to work.

## Use

- **Drag a project onto a folder to file it**, using VesnALIA's own drag: grab the
  project by its name, the same way you reorder projects. A line marks the
  band it will land in. Drop it on a folder header or among that folder's
  projects, or above the first folder to unfile it. Escape cancels. On a
  touch screen, press and hold the project name first, as VesnALIA requires for
  its own drag. A quick swipe scrolls and files nothing.
- Opening a thread whose project is in a folded folder opens that folder.
- **New folder** sits at the end of the list. Click it, type a name, press
  Enter. Escape adds nothing.
- Hover over a folder and click **⋯** to rename, move, or delete it.
- Projects that are in no folder stay on top, in VesnALIA's order.

Agents use the `alia sidebar-folders` command:

```sh
alia sidebar-folders list
alia sidebar-folders create Work
alia sidebar-folders assign <project-id> <folder-id>
```

## Storage

- Folders and their projects: plugin storage on the VesnALIA server. All clients
  show the same folders.
- Which folders are folded: `localStorage`, per client. A work laptop can fold
  Personal while a home machine folds Work.

## Limits

- The plugin finds VesnALIA's project blocks by the `data-sidebar-project-id`
  attribute. If a VesnALIA update changes this markup, the folders do not show and
  VesnALIA's plain list shows instead.
- Only VesnALIA's "by project" sidebar layout is supported.
- Inside a folder, the projects keep VesnALIA's own order. The drag is VesnALIA's own, so
  it reorders projects as well as filing them.
- Keyboard next/previous thread follows VesnALIA's own order, not the order in
  folders.
- Filing is pointer-only. There is no keyboard equivalent; use
  `alia sidebar-folders assign` instead.

## Develop

```sh
npm install --include=dev
alia plugin build
alia plugin install .
alia plugin reload simple-sidebar-folders
```
