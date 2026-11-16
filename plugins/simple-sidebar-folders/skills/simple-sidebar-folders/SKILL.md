---
name: simple-sidebar-folders
description: Put BB sidebar projects into folders with `bb sidebar-folders`. Use when the user asks to group, file, sort, or tidy sidebar projects, to create, rename, reorder, or delete a sidebar folder, or asks which folder a project is in.
---

# Simple sidebar folders

The sidebar shows folders above projects: folder, then project, then its
threads. Folders only group projects. They do not change a project's files,
working directory, or threads.

Start with `bb sidebar-folders list`. It prints every folder with its id and member
projects, then the unfiled projects. Folder ids are short random strings, so
take them from this output.

```sh
bb sidebar-folders list [--json]
bb sidebar-folders create <name>
bb sidebar-folders rename <folder-id> <name>
bb sidebar-folders delete <folder-id>             # its projects become unfiled
bb sidebar-folders move <folder-id> up|down       # order of folders in the sidebar
bb sidebar-folders assign <project-id> <folder-id|none>
```

A project is in one folder at most. `assign` moves it out of its old folder.
Get project ids from `bb sidebar-folders list` or `bb project list`.

In the sidebar, the user files a project by dragging it onto a folder, and
unfiles it by dragging it above the first folder. Folding a folder is a
per-client choice the user makes in the sidebar. No command changes it.
