# Codex Migrate for VesnALIA

Imports local Codex projects and chat history into VesnALIA 0.44. Open **Codex migration** in the VesnALIA sidebar to preview and select folders. The **All** checkbox starts selected. A folder listed in several Codex projects has linked checkboxes and is imported only once. The All row and each folder show a progress bar and counts for the latest run: chats added in that run, partially imported because an attachment was unavailable, already in VesnALIA, and empty records skipped. The finished result remains visible when the page is reopened. The page also polls saved status every five seconds while open.

## Requirements

- VesnALIA 0.44 and the local Codex data on the same machine as the VesnALIA server. The plugin reads `CODEX_HOME/state_5.sqlite` when `CODEX_HOME` is set, otherwise `~/.codex/state_5.sqlite`.
- A separately installed Codex CLI that supports `codex app-server`. Make `codex` available to the VesnALIA server on `PATH`, or set `CODEX_CLI` to its absolute executable path in the VesnALIA server environment.
- Git on the VesnALIA server machine, used to identify repository roots and for the optional `git init` flow.

The bundled VesnALIA Codex provider is not required; this plugin reads Codex data directly. These tools are system prerequisites, not npm package dependencies. The plugin reports a missing Codex CLI when it first needs `codex app-server`.

## Install

Install the released plugin from GitHub:

```sh
alia plugin install git:https://github.com/aotd1/bb-plugin-codex-migrate.git@^0.3.13
```

To build and install a local checkout instead:

```sh
npm install
alia plugin build
alia plugin install .
```

## Use

```sh
alia codex-migrate scan
alia codex-migrate scan --project my-project --json
alia codex-migrate scan --folder /path/to/repository --json
alia codex-migrate apply --project my-project --existing-only
alia codex-migrate apply --project another-project
alia codex-migrate apply --folder /path/to/repository
alia codex-migrate apply --project standalone-folder --init-git
alia codex-migrate status --json
alia codex-migrate repair --alia-project proj_example --json
```

`scan` without a selector lists projects. CLI `apply` requires `--project`, `--folder`, or an explicit `--all`; it never imports every project by default. Normal `apply` skips IDs already in VesnALIA; `--existing-only` verifies their message counts and archive state without adding chats. `--limit N` caps new chats in one run; rerun the same command to continue. Existing Codex source IDs are matched through VesnALIA's `thread/identity` events, so reruns do not duplicate them. `status` shows the active run, its last update, and the last completed report. If VesnALIA restarts during a run, the status becomes `interrupted`; repeat the same selection to continue.

Imported chat titles use Codex's chat name when present, falling back to its first-message title, and are shortened to 80 characters by default. In **Settings → Installed plugins → Codex Migrate**, set **Imported chat titles** to `original` to preserve the full title, or change **Maximum title length** (30–200). Shortening runs locally and does not send chat content to an AI service. The full source title stays in search. Changing the setting affects new imports; `alia codex-migrate repair --alia-project ID` applies it to existing chats when needed and replaces old first-message titles with Codex names. Repair also removes invalid `error: null` fields written by older importer versions, which prevented some timelines from loading. It creates a SQLite backup before changing VesnALIA and does not import new chats. The repair command accepts explicit `--project`, `--folder`, `--alia-project`, or `--all` selection. It preserves manually renamed titles.

## Projects with several directories

Each selected Codex folder is resolved to its Git repository. A folder inside a repository routes to the parent repository's VesnALIA project; a nested independent repository or submodule routes to its own VesnALIA project. Chats from a Git worktree route to the main repository's VesnALIA project. A multi-folder Codex project is treated as several folder selections. Repeated folder paths share one selection state and are imported once. The importer reuses a VesnALIA project with the same repository path or creates one when needed.

A folder outside every Git repository shows a warning and a checked **Initialize Git and import this folder** checkbox in the preview. Clearing it skips that folder. The CLI requires `--init-git` to import standalone non-Git folders; this runs `git init` without creating a commit or remote. Missing folders and chats already imported into a different VesnALIA project block the affected import. Existing chats are never silently moved from a VesnALIA subfolder project to the parent repository project.

Before the first VesnALIA write, the importer creates a backup under VesnALIA's `plugins/codex-migrate/backups/`. Imported chats preserve their Codex archive state. Codex itself is not archived, unarchived, or deleted. An archived Codex session may need to be unarchived in Codex before continuing its VesnALIA copy.

## Compatibility

This first release uses a version-gated VesnALIA 0.44 SQLite adapter because VesnALIA's public Plugin SDK cannot yet import historical thread events. It checks the required schema and writes each thread in one transaction. Install it only on the declared VesnALIA version range. A future VesnALIA import API should replace `alia-store.ts`.

The plugin imports text, timeline items, and available image and file attachments. If an old temporary image path is gone, it looks for the exact path and image bytes in the same Codex rollout, then in rollouts from the same source folder. If the bytes are no longer available, the rest of the chat is imported, the attachment becomes an `[Attachment unavailable: PATH]` text marker, and the report counts the chat as `partially imported`. A Codex `thread/read` call that hangs is stopped after 60 seconds; the importer uses Codex's local history projection only when it covers the complete source rollout. When paginated history rejects `thread/read`, the importer reconstructs the chat from the complete local rollout. A missing rollout is counted as empty only when Codex metadata and the local history index both confirm that the record has no content. The sidebar may need a refresh after imported threads are written because this adapter cannot emit VesnALIA's internal thread notifier.
