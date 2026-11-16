# alia-plugin-beads

A [VesnALIA](https://getbb.app) plugin that integrates
[beads](https://beads.gascity.com) — the dependency-aware, Dolt-backed issue
tracker for AI coding agents (`bd` CLI) — into VesnALIA threads.

## What it adds

- **`beads` agent tool** — runs any `bd` command in the thread's environment
  checkout through the plugin's full-trust `alia.host` worker, so beads works
  on the machine the checkout lives on.
- **`alia beads` CLI** — `alia beads -- <bd-args...>` passthrough and
  `alia beads check` to verify the `bd` binary is reachable.
- **`beads` skill** — standing instructions injected into agent threads.

## Setup

1. Install the `bd` CLI on the VesnALIA host machine:
   `brew tap steveyegge/beads && brew install bd`
   (alternatives: install script or `go install` — see
   [Installation](https://beads.gascity.com/getting-started/installation)).
2. `alia plugin install .` from this directory.
3. `alia beads check` — should print `bd <version>`.
4. If `bd` is not on PATH, set its path with `alia plugin config beads`.

In a repo without beads yet, run `alia beads -- init --skip-agents
--non-interactive` (or ask the agent: `beads({ args: ["init", "--skip-agents",
"--non-interactive"] })`). Plain `bd init` also installs editor integrations
(Claude/Codex/Cursor) in the repo and user config.

## Structure

- `server.ts` — backend entry: agent tool, CLI command, settings.
- `host.ts` — `alia.host` worker that spawns `bd` (bounded output, timeouts).
- `skills/beads/SKILL.md` — agent instructions.

## Development

```
npx tsc --noEmit   # typecheck
alia plugin build    # build server + host bundles
alia plugin reload beads
```
