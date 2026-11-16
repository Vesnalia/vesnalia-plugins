---
name: gh-project
description: Create or import GitHub repositories and register them as projects in VesnALIA using the `alia gh-project` CLI.
---

# GitHub Projects CLI

Use `alia gh-project` to create GitHub repositories or import existing ones from connected accounts directly into VesnALIA as native projects.

## Commands

- `alia gh-project create <name> [--public] [--description <desc>] [--dir <path>]`
  Creates a new GitHub repository under the authenticated user (defaults to private), adds a README, clones it locally, registers it with VesnALIA, and links it in Orca.
- `alia gh-project import <owner/repo> [--dir <path>]`
  Clones an existing GitHub repository from connected accounts and registers it directly into VesnALIA.
- `alia gh-project available`
  Lists existing GitHub repositories from connected accounts that have not been cloned or registered into VesnALIA yet.
- `alia gh-project list`
  Lists all projects currently registered in VesnALIA with their local paths and GitHub remote URLs.
