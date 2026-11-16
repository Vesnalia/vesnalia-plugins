# alia-plugin-git-panel

A VesnALIA plugin that adds a **Git worktree** tab to the thread panel. It shows the
Git state of the workspace behind the current thread and runs the everyday
commands against it: stage, unstage, commit, pull, push, fetch, sync, branch
switch/create/rename, stash and pop.

The panel is a status bar tinted by the worktree's state offering the single
next action, a branch pill with a Local/Remote picker, Changes/Staged tabs with
dense file rows, and a tools row (pull, push, fetch, more).

Git itself runs on the host that owns the workspace, through the plugin's host
entry — plain `git` subprocesses with `GIT_TERMINAL_PROMPT=0`, in the
environment's directory. The commit message is written by VesnALIA's own commit
feature (`alia.sdk.environments.commit`); everything else is git.

## Screenshots

The panel beside a thread, with incoming commits to pull:

![Git worktree panel in a VesnALIA thread](assets/screenshots/git-panel-1.png)

The branch picker, with rename, new branch and search:

![Branch picker](assets/screenshots/git-panel-2.png)

## Install

```
alia plugin install https://github.com/diip3sh/bb-plugin-git-panel
```

For local development, from a clone of this repo:

```
npm install
alia plugin install path:.
```

After editing sources, rebuild and reload:

```
alia plugin build .
alia plugin reload git-panel
```

Or let `alia plugin dev` rebuild and reload on every save.

## Source layout

- `contract.ts` — the host RPC contract (zod): `status`, `stage`, `unstage`,
  `switchBranch`, `createBranch`, `renameBranch`, `pull`, `push`, `fetch`,
  `sync`, `undoCommit`, `stash`, `stashPop`. Every input carries the `cwd` of
  the worktree; mutating calls answer with a human-readable `message`.
- `host.ts` — the host entry, and the only place that spawns `git`. It builds
  the panel's state (`branch`, `branches`, `files`, ahead/behind, stash count,
  last commit) from `git branch --show-current`, `for-each-ref`,
  `status --porcelain=v1 -z`, `diff --numstat -z` (worktree and `--cached`),
  `rev-list --left-right --count`, `stash list` and `log -1`. It also holds the
  safety rules: a dirty worktree blocks a branch switch, `pull` is `--ff-only`
  and refuses a diverged branch, `push` refuses while behind, `sync` aborts its
  rebase on conflict, `undoCommit` is a soft reset refused on a pushed or first
  commit, and a stash that will not apply cleanly is kept.
- `server.ts` — the backend. Resolves thread → environment → worktree path
  (erroring if the thread has no workspace or the workspace is not a Git repo),
  forwards each RPC to the right host, and returns fresh status after every
  mutation. `commit` calls `alia.sdk.environments.commit`, so VesnALIA writes the
  message. No CLI command is registered.
- `app.tsx` — the frontend, registered as
  `app.slots.threadPanelAction({ id: "git", title: "Git worktree" })`. Status
  bar with the one next action, branch picker, Changes/Staged tabs, file rows,
  tools row and the More menu. It fetches once in the background after the first
  load so ahead/behind counts are current.
- `lib/git-status.ts` — the pure parts shared by host, app and tests: VS Code
  status letters and tones (`statusOf`), path → folder/name (`fileParts`),
  `git diff --numstat -z` parsing (`parseNumstat`), and the status bar's
  summary and next action (`summaryOf`).
- `app.css` — panel styles, host theme variables only.
- `skills/git-worktree/SKILL.md` — a skill describing the panel to agents
  working in a VesnALIA thread. VesnALIA imports it into agent threads automatically.
- `PLUGIN_OVERVIEW.md` — the marketplace listing body, shown under
  `alia.description` on the plugin detail page.

## Build

```
npm install
alia plugin build .
alia plugin reload git-panel
```

`npm run build` runs `tsc --noEmit` first. `alia plugin build` writes
`dist/server.js` + `server.meta.json` and `app.js` / `app.css` /
`app.meta.json`. Ship `dist/` (npm tarball or committed for git installs) so
people installing the plugin never need npm.

## Tests

`git-status.test.ts` covers the pure helpers in `lib/git-status.ts` — status
letters, path splitting, numstat parsing (including renames and binaries), and
the summary's next-action priority order. No test framework, no build step:

```
node --experimental-strip-types --test git-status.test.ts
```

## UI components

`components/ui/` is vendored source you own (the shadcn model): edit the
files freely — they never update out from under you. Add more from the VesnALIA
component registry (the full shadcn set, version-matched to your VesnALIA install
via the pinned ref in `components.json`):

```
npx shadcn add @alia-core/select @alia-core/table
```

Run `npm install` once before `alia plugin build` — the vendored components'
npm deps bundle into your dist. React, and ALIA-shimmed packages like the
radix portal primitives and `sonner` (`import { toast } from "sonner"`
reaches VesnALIA's own toaster), are provided by the VesnALIA app at runtime and never
bundled. Every shimmed package is declared in `devDependencies` at the
host's version so those imports typecheck; keep them there (never in
`dependencies`, which would bundle a second copy), and `alia plugin types`
repins them alongside the SDK.

## Types & API reference

The plugin API ships as the npm package `@vesnalia/plugin-sdk`, pinned to an
exact version in `devDependencies`. After `npm install`, the full surface is on
disk at:

```
node_modules/@vesnalia/plugin-sdk/bundled-types/alia-plugin-sdk.d.ts      # backend
node_modules/@vesnalia/plugin-sdk/bundled-types/alia-plugin-sdk-app.d.ts  # frontend
```

Keep the pin tracking the VesnALIA you actually run:

```
alia plugin types          # sync this plugin's SDK surface to the running ALIA
alia plugin types --check  # CI: fail when it does not match
```
