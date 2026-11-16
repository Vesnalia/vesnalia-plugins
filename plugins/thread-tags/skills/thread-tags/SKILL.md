---
name: thread-tags
description: Read or set the tag on a VesnALIA thread (the colored emoji/text badge left of the thread title in the sidebar) with the `alia thread-tags` CLI. Use when the user asks to tag, label, mark, or untag a thread, or to create, list, or delete thread tags.
---

# Thread tags

The Thread Tags plugin keeps one configurable set of tags. A tag is an emoji or
short text (up to 12 characters) on a colored background. Each thread has at
most one tag. The tag shows as a badge left of the thread's title in the VesnALIA
sidebar. Users apply tags from the tag button in a row's hover controls. They
edit the tag set on the plugin's settings page.

## Commands

`--thread <id>` defaults to the thread the command runs in. A `<tag>` is a tag
id or its exact label, and the label match ignores case.

| Command | Effect |
| --- | --- |
| `alia thread-tags list` | List tags as `id  label  color`. |
| `alia thread-tags get [--thread <id>]` | Show a thread's tag. |
| `alia thread-tags set <tag> [--thread <id>]` | Tag a thread. It replaces any existing tag. |
| `alia thread-tags clear [--thread <id>]` | Remove a thread's tag. |
| `alia thread-tags create <label> --color <#rrggbb>` | Create a tag. |
| `alia thread-tags delete <tag>` | Delete a tag and remove it from every thread. |

Add `--json` for machine-readable output.

## Guidance

- Run `list` before `set`, and use an existing tag. Create a tag only when the
  user asks for a new one.
- Do not delete tags unless the user asks. Deleting a tag removes it from every
  thread.
