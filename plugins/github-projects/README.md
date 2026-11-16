# alia-plugin-github-projects

Create and import GitHub repositories directly from VesnALIA's native project picker and CLI.

## Features

- **Native Picker Integration**: Injects dedicated "New project on GitHub" and "Import from GitHub" options directly into VesnALIA's project dropdown.
- **One-Line Project Creation**: Quickly create private GitHub repositories with auto-cloning and project registration.
- **Account Repository Import**: Browse and import existing repositories from connected GitHub accounts, automatically filtering out already cloned or registered projects.
- **CLI & Agent Commands**: Manage projects via the `alia gh-project` CLI and agent skill.

## Commands

```bash
# Create a new repository on GitHub and register it in ALIA
alia gh-project create <name> [--public] [--description <desc>] [--dir <path>]

# Import an existing repository from your connected account
alia gh-project import <owner/repo> [--dir <path>]

# List repositories available for import (excluding already cloned)
alia gh-project available

# List all registered ALIA projects with their Git remotes
alia gh-project list
```

## Requirements

- GitHub CLI (`gh`) installed and authenticated on the machine running VesnALIA.
