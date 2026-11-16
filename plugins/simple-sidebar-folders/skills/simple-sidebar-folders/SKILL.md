---
name: simple-sidebar-folders
description: Put VesnALIA sidebar projects into folders with `alia sidebar-folders`. Use when the user asks to group, file, sort, or tidy sidebar projects, to create, rename, reorder, or delete a sidebar folder, or asks which folder a project is in.
---

# Simple sidebar folders

The sidebar shows folders above projects: folder, then project, then its
threads. Folders only group projects. They do not change a project's files,
working directory, or threads.

Start with `alia sidebar-folders list`. It prints every folder with its id and member
projects, then the unfiled projects. Folder ids are short random strings, so
take them from this output.

```sh
alia sidebar-folders list [--json]
alia sidebar-folders create <name>
alia sidebar-folders rename <folder-id> <name>
alia sidebar-folders delete <folder-id>             # its projects become unfiled
alia sidebar-folders move <folder-id> up|down       # order of folders in the sidebar
alia sidebar-folders assign <project-id> <folder-id|none>
```

A project is in one folder at most. `assign` moves it out of its old folder.
Get project ids from `alia sidebar-folders list` or `alia project list`.

In the sidebar, the user files a project by dragging it onto a folder, and
unfiles it by dragging it above the first folder. Folding a folder is a
per-client choice the user makes in the sidebar. No command changes it.
