# alia-plugin-px0

Review and directly edit a VesnALIA thread's working directory in an embedded
[px0](https://px0.ai) workspace, without leaving the thread.

px0 is a local web server, so VesnALIA can host it in a panel: the plugin starts
`px0` on the thread's workspace directory and renders it in an iframe beside
the conversation. px0's native editor handles small file changes in the
browser. Its coding-harness actions are disabled by default. When that opt-in
is enabled, px0 sends file-and-line-aware agent prompts back to the VesnALIA thread
that opened the panel.

## Design

Three entries, because VesnALIA separates trust levels:

### `host.ts` — process manager

Full-trust Node on the machine that owns the workspace, which is not
necessarily the machine running the VesnALIA server. The only entry allowed to spawn
processes, so px0 lives here. Agent-disabled panels keep one px0 per absolute
directory, so two threads on the same worktree share a process. Panels with
the VesnALIA agent bridge enabled use one process per directory and VesnALIA thread because
px0 does not identify the browser client that submitted an agent prompt.

Three constraints shaped this file:

- **Idle eviction.** VesnALIA stops a host worker after five minutes with no active
  call, watch, or lease — which would kill px0 under an open panel. The entry
  holds an `experimental_retainWorker()` lease while any child is alive and
  disposes it when the last one exits.
- **PATH.** Host code gets the normalized user PATH without VesnALIA's own
  variables, and `~/.local/bin` (where px0 installs) is often missing from it.
  The binary is probed across known install locations, with a settings
  override taking precedence.
- **Embedding.** Every panel uses a loopback adapter because px0 0.1.20
  sends `frame-ancestors 'none'`. The adapter preserves the rest of the CSP
  and permits framing only by local VesnALIA clients and the configured VesnALIA app
  origin. The agent-metadata workaround applies only to agent-enabled panels.
- **Ports.** A free loopback port is reserved via a throwaway listener and
  handed to `-port`, then polled until px0 answers, so callers get a URL that
  is actually serving rather than one that is about to be.

### `server.ts` — resolution and brokering

Resolves a thread to a directory: `threads.get` gives `environmentId`, then
`environments.get` gives the workspace `path` and its `hostId`. It calls the
host entry on that specific host and returns a URL.

For clients that are not on the workspace machine (phone, web), it can wrap the
port with `alia.hosts.declareSharedPorts` plus `ensureSharedPortTunnel` and return
an `https://` share URL, falling back to loopback when the machine is not
enrolled in VesnALIA Connect.

It also owns the `alia px0 agent-run` bridge used by editable px0 sessions. The
bridge sends px0's prompt to the originating thread, waits for that turn to
finish, and returns its output to px0. If the thread is already running, the
bridge refuses the edit instead of steering or silently queueing it.

px0 0.1.20 can execute a custom agent command but omits custom commands from
the UI's detected-harness list, leaving its pinned composer inaccessible. For
editable sessions only, the host places a loopback adapter in front of px0
that adds the pinned `alia` command to px0's two agent-metadata responses. It
also verifies the browser's origin before rebasing agent POSTs onto px0's
internal loopback origin; non-agent traffic streams through unchanged. This
metadata workaround can go away when px0 exposes pinned custom commands in
its UI. The framing adapter is still required while px0 forbids embedding.

### `app.tsx` — the surfaces

An action-available thread `experimental_tab` with `layout: "flush"` rendering the iframe, and an
`experimental_threadHeaderAction` button that opens it.

A `fileOpener` also opens workspace file links from agent messages directly in
px0, including their requested line. It registers common code, document, data,
and image extensions. VesnALIA chooses the default opener per extension; if another
viewer is pinned, choose px0 under Settings → File openers or right-click the
link and choose Open with → px0. The SDK does not support wildcard extensions,
so extensionless files continue to use VesnALIA's preview.

File links start with the right inspector closed. In panels narrower than
900 pixels, the file tree also starts hidden so the editor has room. These
startup defaults do not override panes opened manually afterward. px0's
controls and Cmd/Ctrl+J and Cmd/Ctrl+B can reopen the inspector and file tree.

Files outside the thread's workspace, thread-storage files, and links without
a thread use VesnALIA's preview. Git snapshots and deleted files remain handled by
VesnALIA. The loopback adapter adds a parent-message navigation bridge to px0
0.1.20's browser bundle so subsequent line requests preserve open editor state
and unsaved edits. Messages are accepted only from the embedding VesnALIA parent,
with the same allowed origins as the framing policy.

## Notes

VesnALIA 0.47.1 and px0 0.1.20 or newer are required. The default `readOnly` setting keeps its
historical key but now means "disable VesnALIA agent integration." It launches px0
with `-no-agent`, which still leaves px0's native file editor, file creation,
Git review, and staging controls available. Turning the setting off pins px0's
custom agent command to VesnALIA; px0's built-in coding agents are not used. Enable
it with `alia plugin config px0 set readOnly false`.

Neither mode is a hardened sandbox. px0 is a local server with write access to
the workspace, and its native editor writes files directly.

## Development

```sh
npm ci
npm run check
bun test app.test.tsx file-navigation.test.ts
bun test host.test.ts # integration tests require px0 0.1.20+ on this host
alia plugin install .
alia plugin dev
```

The optional real-browser navigation regression uses an external Playwright
installation: `bun scripts/verify-links.ts /path/to/playwright/index.mjs`.

## Install

Install or update px0 first:

```sh
px0 -update
```

Install the latest compatible tagged release:

```sh
alia plugin install git:https://github.com/KaviiSuri/bb-plugin-px0.git@^0.1.0
```

Use `@main` only to test unreleased changes.

## Releasing

Releases are immutable annotated `vX.Y.Z` tags. Each release commit contains
the matching package manifest, lockfile, and freshly built `dist/` artifacts.
CI runs `npm run check` on pushes and pull requests to `main`.

Cut a local release without publishing it:

```sh
npm run release -- patch
npm run release -- minor
npm run release -- 1.4.2
```

Add `--push` to atomically publish the release commit and tag. The first
release may use the current package version when its tag does not exist:

```sh
npm run release -- 0.1.0 --push
```

The GitHub **Release** workflow offers the same version choices and creates
GitHub release notes after publishing the tag. Never move a published tag;
release a new patch version instead.

```sh
gh workflow run release.yml -f bump=patch
```

## License

MIT
