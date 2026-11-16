<p align="center">
  <img src="docs/logo.svg" width="112" alt="Skill Manager logo" />
</p>

<h1 align="center">Skill Manager</h1>

<p align="center"><strong>All your agent skills, one place, inside VesnALIA.</strong></p>

<p align="center">
  <a href="https://github.com/sankalpaacharya/bb-skill-manager/releases"><img src="https://img.shields.io/github/v/tag/sankalpaacharya/bb-skill-manager?label=version&color=4f8cff" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT" /></a>
  <a href="https://skills.sh"><img src="https://img.shields.io/badge/registry-skills.sh-2ea44f" alt="skills.sh" /></a>
</p>

<p align="center">
  <img src="docs/skills-page.png" width="900" alt="Skill Manager dashboard" />
</p>

Claude Code, Codex, Pi, OpenCode, Gemini, Cursor, Copilot. Each one keeps its own skills folder, so you end up with the same skill copied everywhere and slowly going out of sync.

Skill Manager fixes that. One hub, every agent linked to it, updates in one click.

## Install

```sh
alia plugin install git:https://github.com/sankalpaacharya/bb-skill-manager.git
```

Then open **Skills** in the sidebar.

## What you get

- One hub for every skill, every agent linked to it
- See which agent has what, and what drifted
- Search skills.sh and install into the agents you pick
- Knows where each skill came from, tells you when there's an update
- Tags, grouping by source, read any skill in place
- Your agents can run all of it with `alia skill-manager`

## CLI

```sh
alia skill-manager status
alia skill-manager search react
alia skill-manager install mattpocock/skills@code-review --all-agents
alia skill-manager check
alia skill-manager update
alia skill-manager sync impeccable --to codex,pi
alia skill-manager doctor
```

Run `alia skill-manager` for the full list. Nothing destructive happens without `--force`.

## Settings

`alia plugin config skill-manager`

| Key | Default |
| --- | --- |
| `hubDir` | `~/.agents/skills` |
| `defaultMode` | `link` |
| `disabledAgents` | |
| `extraAgents` | `[]` |

## Dev

```sh
npm install
npm test
alia plugin install .
```

MIT
