# GitHub Actions for VesnALIA

A [VesnALIA](https://getbb.app) plugin that shows the GitHub Actions runs of your projects and lets you act on them without leaving VesnALIA.

## Features

- **Runs page and thread tab.** A GitHub Actions page in the sidebar, and the same view as a tab beside any thread (new tab → Actions → GitHub Actions). A summary shows running, queued, and failed runs and the success rate; the list filters by Active / Failed / All and by repository.
- **Run workflow.** Start any workflow that has a `workflow_dispatch` trigger, on any branch. Inputs (string, number, boolean, choice, environment) become a form and are validated before the request reaches GitHub.
- **Live job view.** Step progress refreshes every 3 seconds while a job runs. The log appears once GitHub publishes it (GitHub serves a job log only after the job ends), with line numbers, error highlighting, a filter, and copy.
- **Rerun and cancel.** Rerun failed jobs or the whole run; cancel a run in progress.
- **Ask agent.** Opens a VesnALIA thread in the repository's project with the error excerpt of the failed jobs and a brief to find the root cause. "Ask agent with another model…" opens the same prompt in the composer instead.
- **Send to threads.** Post a run report to the VesnALIA threads you choose, and subscribe them to future failures of the repository.
- **CLI and skill.** `alia github-actions` for agents and terminals; the bundled skill teaches agents to use it.

## Requirements

- A GitHub account with access to the repositories. The plugin uses the token of the [GitHub CLI](https://cli.github.com) (`gh auth token`), or a token you set in the plugin settings. Rerun, cancel, and manual runs need write access to Actions.
- VesnALIA projects whose git remote points at GitHub, or repositories listed in the plugin settings.

## Install

From the VesnALIA marketplace, or from source:

```sh
git clone https://github.com/pers0na2dev/bb-github-actions.git
cd alia-github-actions
npm install
alia plugin install .
```

## Settings

`alia plugin config github-actions`, or Settings → Installed plugins → GitHub Actions:

| Setting | Default | |
| --- | --- | --- |
| GitHub token | — | Secret. Falls back to `gh auth token`. |
| Watch the GitHub repositories of VesnALIA projects | on | Uses each project's git remote. |
| Extra repositories | — | `owner/repo`, one per line. |
| Recent runs to load per repository | 20 | 1–100. |
| GitHub polling interval, seconds | 30 | 15 s while a run is active. |
| Project for investigations | — | For repositories without a VesnALIA project. |
| Model for failure investigations | project default | |

## CLI

```text
alia github-actions list [--active|--failed] [--json]
alia github-actions rerun <owner/repo> <run-id> [--all]
alia github-actions cancel <owner/repo> <run-id>
alia github-actions workflows <owner/repo> [--json]
alia github-actions run <owner/repo> <workflow-id|file|name> [--ref <branch>] [name=value ...]
```

## Development

```sh
npm install
npm run typecheck
npm run build      # alia plugin build
alia plugin dev      # rebuild and reload on save
```

## License

MIT
