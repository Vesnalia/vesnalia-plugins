---
name: example-todos
description: Read and update the Unified Inbox plugin's example todo list with the `alia unified-inbox` CLI. Use when the user asks to add, complete, reopen, remove, or review todos, or when the steps of a task should be tracked as todos.
---

# Example todos

The Unified Inbox plugin keeps one todo list. The Example todos page in the VesnALIA sidebar and
the `alia unified-inbox` command read and write the same list, so a change from either
side shows in the other at once.

## Commands

| Command | Effect |
| --- | --- |
| `alia unified-inbox list` | Show every todo with its id. `[x]` marks a done todo. |
| `alia unified-inbox add <title>` | Add a todo. Quote a title that has spaces. |
| `alia unified-inbox done <todo-id>` | Mark a todo done. |
| `alia unified-inbox undo <todo-id>` | Mark a todo not done. |
| `alia unified-inbox remove <todo-id>` | Delete a todo. |

Add `--json` to any command when the output drives code.

## Procedure

1. Run `alia unified-inbox list` before you change the list. Use the ids it prints;
   never guess an id.
2. Add todos one at a time with a short title that starts with a verb:
   `alia unified-inbox add "Write the release notes"`.
3. When you finish a todo, mark it done: `alia unified-inbox done <todo-id>`. Do not
   remove a todo to mark it done.
4. Remove a todo only when the user asks for it or when it duplicates
   another todo.
5. End with a short summary of what you added, completed, or removed.

## Rules

- Change the list only through `alia unified-inbox`. Do not edit alia.db or the plugin's
  storage directly.
- A non-zero exit with "No todo with id" means the id is stale: run
  `alia unified-inbox list` again.
