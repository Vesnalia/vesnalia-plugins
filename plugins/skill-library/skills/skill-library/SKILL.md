---
name: skill-library
description: Use when the user wants to browse, edit, create, save, delete, or install agent skills, or mentions the Skill Library sidebar plugin.
---

# Skill Library

Skill Library is a VesnALIA plugin with a rail nav panel that works with skills VesnALIA
already discovers on this machine.

## When to use

- The user asks to view, edit, create, or delete a skill.
- The user asks to install a skill from the skills.sh registry.
- The user asks where a skill lives on disk.

## What the built-in Skills surface covers

VesnALIA's built-in **Skills** rail item browses and installs skills. Use Skill
Library when create + markdown edit/save of laptop skills in one place is the
goal.

## Capabilities

- **List**: every skill VesnALIA discovers (provider-user, plugin, runtime, alia-user
  scopes). Non-manageable skills are read-only and marked with a lock.
- **Edit/Save**: editable `SKILL.md` per manageable skill, with revision-based
  conflict detection; Cmd/Ctrl+S saves.
- **Create**: writes `<dataDir>/skills/<name>/SKILL.md` (VesnALIA user skills).
- **Delete**: only manageable skills.
- **Registry**: search skills.sh and install into VesnALIA user skills.
- **Publish**: there is no publish API. To publish to skills.sh, put the skill
  folder in a GitHub repo that skills.sh indexes; use "Copy path" to find the
  folder.

## CLI

- `alia skill-library list [--json]` — list discovered skills.
- `alia skill-library create <name> --description <text> [--json]` — create a VesnALIA
  user skill under the VesnALIA data dir.
