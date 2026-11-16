---
name: hats
description: Switch the VesnALIA sidebar between named sets of projects ("hats"), or create, rename, re-icon, delete, and fill hats, with the `alia hats` CLI.
---

# Hats

A hat is a name, an icon, and a set of projects. A project can be in any
number of hats. Switching to a hat hides every project that another hat
claims and the current hat does not; a project in no hat always shows. The
sidebar footer button switches to the next hat in order, and the plugin's
settings page edits hats and their projects.

| Command | Effect |
| --- | --- |
| `alia hats status [--json]` | Show hats, their projects, and the current hat (`*`). |
| `alia hats wear <hat\|none>` | Switch to a hat; `none` shows every project. |
| `alia hats next` | Switch to the next hat in order. |
| `alia hats create <name> [icon]` | Create a hat (icon defaults to `star`). |
| `alia hats rename <hat> <new name>` | Rename a hat. |
| `alia hats icon <hat> <icon>` | Change a hat's icon; `alia hats icons` lists them. |
| `alia hats delete <hat>` | Delete a hat. |
| `alia hats add <hat> <project>` | Add a project to a hat. |
| `alia hats remove <hat> <project>` | Remove a project from a hat. |

Hats and projects match by id, exact name, or a unique part of a name. Quote
names with spaces.

Each change rewrites every `project:` entry in the thread list's
`hiddenGroups` preference; hidden sections and machines are kept.
