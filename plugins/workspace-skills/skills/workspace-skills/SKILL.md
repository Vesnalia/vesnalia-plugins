---
name: workspace-skills
description: Manage and inspect configurable external and project skill roots in VesnALIA. Use when checking active skill paths, rescanning directories, or adding new skill scan locations.
---

# Workspace Skills Plugin

Configure external and workspace skill roots in VesnALIA without hardcoding paths.

## Usage

Use the `alia workspace-skills` CLI to inspect, sync, or configure paths:

- `alia workspace-skills status` — list configured paths, auto-discovery setting, and all discovered skill roots.
- `alia workspace-skills sync` — force an immediate rescan of all configured paths and reload VesnALIA skills.
- `alia workspace-skills add <path>` — add a directory path (relative to `~` or absolute) to the scan list.

## Settings

Settings can be edited via the VesnALIA UI under **Settings → Plugins → Workspace Skills**, or via CLI:

```bash
alia plugin config workspace-skills set scanPaths "Projects/skills,Projects/.agents/skills"
alia plugin config workspace-skills set autoDiscover true
```
