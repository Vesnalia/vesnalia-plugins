Create and import GitHub repositories directly from VesnALIA's native project picker and command line.

## What you get

- **New project on GitHub** entry directly in VesnALIA's native project picker dropdown. It opens a focused, one-line prompt for the repository name and creates a private GitHub repository automatically.
- **Import from GitHub** entry directly in the project picker dropdown. It lists all repositories from your connected GitHub account that have not yet been cloned or added to VesnALIA, with instant search and one-click import.
- Automatic local cloning into your projects directory and registration with VesnALIA's project database and Orca workspace fleet.
- A `alia gh-project` CLI command for creating, importing, and listing GitHub projects from your terminal.
- An agent skill (`gh-project`) allowing AI coding agents to discover and create GitHub projects autonomously.

## How it works

The plugin connects with the GitHub CLI (`gh`) on the host to authenticate and manage repositories. When you create or import a project, it provisions the repository on GitHub, clones the files locally, and registers the folder with `alia.sdk.projects.create` so VesnALIA immediately recognizes it as an active project.

## Commands

- `alia gh-project create <name> [--public] [--description <desc>] [--dir <path>]` — Create a new GitHub repository and register it in VesnALIA.
- `alia gh-project import <owner/repo> [--dir <path>]` — Clone an existing GitHub repository and add it to VesnALIA.
- `alia gh-project available` — List uncloned GitHub repositories ready to import.
- `alia gh-project list` — List all registered VesnALIA projects and their repository remotes.

## Requirements

Requires the GitHub CLI (`gh`) to be installed and authenticated on the machine where VesnALIA runs.
