# VesnALIA Plugin Dynamic File Tree

An MVP VesnALIA plugin for browsing the active thread's Environment or Worktree in
the right thread sidebar.

The plugin shows the active thread's project tree, Git status, line diffs, file
size/mtime decorations, and VesnALIA's built-in preview for text, Markdown, and image
files. Agent reads and writes are highlighted live; changed and deleted files
receive temporary status markers. The panel follows the active thread instead
of using a global working directory.

The gear menu controls diff counts, size/mtime columns, full paths, Nerd-Font
icons, activity-driven auto-collapse, and the colors for reads, writes, Git
states, and diff counts. Preferences are stored through the plugin's
namespaced VesnALIA key-value storage; tree expansion itself is session state and is
intentionally not persisted. The fixed tab uses VesnALIA's `FolderTree` icon; the
panel header uses `FolderTree`, `GitBranch`, `RefreshCw`, and `Settings2`.

The user interface follows the host document or browser locale by default.
English and German are supported; unsupported or unavailable locales fall back
to English. The gear menu also provides an explicit language preference for
choosing automatic detection, English, or German.

Activity is collected from provider file events and, for shell-backed providers
such as Codex, common command executions (`sed`, `rg`, `cat`, and
`apply_patch`) as a fallback. This keeps the tree useful even when the provider
does not emit a native `fileRead` event.

## Development

From this directory:

```bash
npm install
alia plugin types --check
alia plugin build
```

Install the local plugin while developing:

```bash
alia plugin install . --yes
alia plugin dev .
```

The plugin uses the current VesnALIA SDK declarations from
`node_modules/@vesnalia/plugin-sdk/bundled-types/`. Run `alia plugin types` after
upgrading VesnALIA so the package tracks the host SDK.

## Reference and attribution

The interaction concept is inspired by
[`data-goblin/claude-code-filetree`](https://github.com/data-goblin/claude-code-filetree).
No upstream code or assets are copied into this plugin; see
`THIRD_PARTY_NOTICES.md` for the credit note.
