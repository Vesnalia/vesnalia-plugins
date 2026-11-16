---
name: plugin-vault
description: Inspect and manage archived, rejected, or blacklisted VesnALIA plugins with the `alia plugin-vault` CLI. Use before installing, recommending, or diagnosing plugins to avoid known buggy, conflicting, or unwanted plugins.
---

# Plugin Vault

The Plugin Vault plugin keeps track of unwanted, rejected, buggy, and redundant VesnALIA plugins along with reasons and experience notes.

Before suggesting or installing any VesnALIA plugin, agents can query the vault to ensure the user hasn't previously rejected or blacklisted it.

## Commands

| Command | Effect |
| --- | --- |
| `alia plugin-vault list [--json]` | List labeled plugins with their labels and description. |
| `alia plugin-vault labels [--json]` | List available labels, including user-created ones. |
| `alia plugin-vault add <plugin-id> [--label <label>]... [--note <note>] [--disable] [--remove]` | Add labels (merged with existing ones) and set the description; optionally disable or remove the plugin. |
| `alia plugin-vault remove <plugin-id>` | Clear a plugin's labels and description. |

## Procedure

1. Before suggesting or installing a plugin for a user or task, check whether it is archived in the vault: `alia plugin-vault list --json`.
2. If the user mentions a plugin is broken, slow, redundant, or unwanted, offer to archive it:
   `alia plugin-vault add <plugin-id> --label <label> --note "<reason>" --disable`.
3. Never reinstall or suggest a plugin that is currently listed in `alia plugin-vault list` unless the user explicitly asks to reconsider it.
