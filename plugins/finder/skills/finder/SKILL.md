---
name: finder
description: Browse and read the files of a thread's workspace with the `alia finder` CLI. Use when the agent needs to locate a file, list a workspace tree, print a file relative to the workspace root, or find out which machine and directory a workspace lives on.
---

# Finder

The Finder plugin exposes the workspace behind the current thread through
`alia finder`. It resolves the same root the Finder page in the sidebar browses: the
thread's environment directory when it has one, otherwise the project's checkout.
Files may live on another machine, so `alia finder root` is the authority on where
they are — never assume the current working directory is the workspace root.

## Commands

| Command | Effect |
| --- | --- |
| `alia finder root` | Print the resolved workspace root and the machine that holds it. |
| `alia finder tree [--all] [--limit <n>]` | List the workspace tree, directories suffixed with `/`. `--all` includes dotfiles. |
| `alia finder read <path>` | Print one file. The path is relative to the workspace root. Output is truncated at 512 KB. |

## Procedure

1. Run `alia finder root` first. If it reports a machine other than this one, the
   files are not on the local disk and every path you hand to a shell tool will
   miss.
2. Locate the file with `alia finder tree`, or with your own file search when the
   workspace is large. Treat the listing as a hint: it excludes the dependency
   directories the plugin is configured to skip, and it is capped.
3. Read with `alia finder read <path>` using the exact relative path the listing
   printed. Prefer your normal file-reading tool when the file is on this
   machine; use `alia finder read` when it is not.

## Rules

- Paths are workspace-relative. A leading `/` or a `..` segment is refused.
- A file larger than 512 KB is printed truncated, with a trailing note naming
  the full size; read it in pieces with your own tools when you need all of it.
- The command needs a thread or project context; it fails with
  "No thread or project in context" when run outside one.
- Editing is not exposed through this CLI. Write files with your normal tools,
  then reload the Files page or press refresh in the tree to see the change.
