# Diff Tree for VesnALIA

Review Git changes by folder, compare commits, and bring selected code into your VesnALIA chat.

Diff Tree adds a thread panel to [VesnALIA](https://getbb.app) with a searchable file tree beside an interactive diff. Keep track of changes across large directories, inspect the last commit or a group of commits, and quote the lines you want to discuss with your agent.

![Diff Tree showing a directory tree, unified diff, and selected lines ready to add to chat](docs/screenshots/overview.png)

## What you get

- **A directory tree for changes.** Collapse folders, search current and previous paths, and see file statuses and aggregate additions/deletions.
- **Worktree browsing.** Toggle the Worktree button to browse current files, including unchanged files, and read their source beside the tree. Changed files retain their comparison badges and can switch between Diff and File.
- **Four comparison scopes.** Review all branch changes, the working copy, a range from a chosen commit through HEAD, or one selected commit.
- **Searchable comparison branches.** Use VesnALIA's branch picker with an automatic default based on the recorded creation branch when available.
- **Image comparisons.** Preview Before/After versions of PNG, JPEG, GIF, WebP, BMP, ICO, AVIF and SVG files, with dimensions, transparency backgrounds and Fit / 100% zoom. SVG files also offer a text diff.
- **Unified and split diffs.** Syntax highlighting follows VesnALIA's code theme. Expand unchanged lines upwards or downwards in configurable steps (30 lines by default), or reveal an entire gap.
- **Code in your chat draft.** Click a line number, Shift-click to extend, or drag across line numbers; then choose **Add to chat**. Quotes include the path, line coordinates, and comparison revision.
- **File mentions.** Use the button beside the filename or Cmd/Ctrl+click a tree file. Both append a workspace mention without sending the message.
- **File type icons.** [Seti UI](https://github.com/jesseweed/seti-ui) supplies 148 SVG icons with rules for 287 extensions and special filenames, bundled for offline use.

## Requirements

- VesnALIA **0.46.1+** with Plugin SDK **0.6.49+**.
- A Git workspace associated with the current VesnALIA thread.
- Git on the workspace's host for commit history and committed comparisons.

There are no API keys, external services, or separate accounts to configure. The UI is in English. Remote workspaces use the environment's enrolled VesnALIA host.

## Install

For a local checkout:

```sh
npm ci --ignore-scripts
alia plugin build .
alia plugin install .
```

VesnALIA asks you to approve the local source. Open **Diff Tree** with the branch icon in a thread header, or choose **+ → Diff Tree** in its right panel.

Install the tagged release from [SergeyGavrilov/alia-diff-tree](https://github.com/SergeyGavrilov/bb-diff-tree):

```sh
alia plugin install 'git:https://github.com/SergeyGavrilov/bb-diff-tree.git@^0.1.0'
```

Git installs build the plugin through VesnALIA; Node and npm are only needed when developing it yourself.

## Review changes

| Scope | What it shows |
| --- | --- |
| **All changes** | The branch and working copy relative to the selected comparison branch. Before the first commit, shows staged, unstaged, and untracked files. |
| **Uncommitted** | Staged, unstaged, and untracked changes together. |
| **Recent commits** | One combined diff from a chosen starting commit through HEAD, including the chosen commit and excluding working-copy changes. The **From** picker lists up to 200 first-parent commits by SHA, subject, and author. Choose HEAD for the last commit or its predecessor for the last two. |
| **Single commit** | The chosen commit against its first parent. The picker lists up to 200 recent first-parent commits by SHA, subject, and author. |

Recent-commit ranges include their starting commit and stay anchored to its SHA as new commits arrive. Older saved Last N choices are migrated once. If the selected start leaves the current branch history, choose another commit from the picker.

**Base** applies immediately. The Auto badge explains where its default came from; a manual choice can be reset. Automatic selection prefers the creation branch recorded by VesnALIA, then the configured comparison, then the repository default. Git does not reliably retain a parent branch's name, so branches created outside VesnALIA may require manual selection.

The sidebar resizes horizontally in wide panels and moves above the diff in narrow panels. Search temporarily expands matching folders. Refresh manually or return to the app to update changes; selection, search, and collapsed folders survive refresh.

Comparison scope, starting commit, selected single commit, manual base branch, Worktree mode, Unified/Split override, and Diff/File preview are remembered separately for each thread. The selected file, path search, and folder expansion are also remembered independently for Changes and Full tree. Choices are stored in this browser's local storage and survive switching chats, reopening the panel, and restarting VesnALIA; they do not sync between devices. Only UI choices and relative paths are stored, not file contents. A fresh file navigation from chat still switches to All changes, reveals the requested file, and clears the relevant path filters. Returning to the thread does not replay an older navigation. If local storage is unavailable, choices remain available for the current app session.

### Image previews

Selecting a supported image shows **Before** and **After** beside each other (stacked in narrow panels). Added or deleted files show the available version and mark the absent side. Transparent areas use a checkerboard; dimensions and file sizes appear after loading. Choose **Fit** or **100%** for intrinsic-size scrolling. Animated formats use the browser's normal image playback. SVG files have an **Image / Text diff** switch; SVG previews are loaded as images, never inserted into the page as markup.

All changes and Uncommitted compare the pinned base or HEAD with the working copy. Recent commits and Single commit read both images from their pinned Git revisions, including the previous path of renamed files. File mode and the full Worktree tree preview the current working-copy image, even during historical comparisons. Non-image binary files retain the binary notice.

Previews are limited to **2 MiB per side** and supported browser decoders. Oversized, malformed or unavailable sides show a notice while the other side remains visible. The existing Open file action is available for working-copy files. No image processing service, new dependency or repository write is used.

### Shortcuts and chat

| Action | Gesture |
| --- | --- |
| Select a file | Click its tree row |
| Add a file mention to the draft | Cmd/Ctrl+click its tree row, or the chat button beside the filename |
| Select a diff line | Click its line number |
| Extend the selection | Shift-click another line number, or drag across line numbers |
| Dismiss a line selection | Escape or click outside the diff |
| Navigate tree rows | ↑ / ↓, Home / End |
| Expand or collapse a folder | → / ←, or click the folder |

Chat actions append to the existing draft and focus the composer. They never submit it. Historical diff quotes identify the selected revisions; **Open working-copy file** opens the current workspace file.

### Browse the worktree

Available since v0.1.2. Use **Worktree** beside Refresh to switch from changed paths to the current thread's worktree. Its badge shows **Diff** for changed paths or **Full tree** for the whole worktree. Click it again to return to the changes list. Folders start collapsed in this mode, search reveals matching paths, and both modes keep their own folder expansion state.

Unchanged files open in the source viewer with VesnALIA's syntax highlighting and line numbers. The preview keeps a complete row model while scrolling; files over 10,000 lines use plain text with line numbers. Changed files keep their comparison badges and default to the selected diff; choose **File** to read the complete working-copy content, or **Diff** to return. The File preview always reads the live working copy, including when comparing historical commits. The header's file mention and Cmd/Ctrl+click in the tree also work for unchanged files. A chat target outside the diff offers **View in worktree**.

The list uses the environment's host and honors Git ignore rules, with VesnALIA's dependency/cache exclusions. Tracked and non-ignored untracked files, including hidden files, are included; symlinks and `.git` internals are excluded. Deleted paths remain in Changes and are absent from the live tree. VesnALIA returns at most 10,000 paths per query; a partial-list notice prompts you to search for files outside that result. Source previews are loaded on selection and limited to 512 KiB; binary, empty, oversized, and unreadable files show an appropriate notice. The Open file button remains available.

## Settings

Available since v0.1.1 under **Settings → Diff Tree** (also on the installed plugin's detail page). VesnALIA saves the preferences and applies them without a plugin reload.

- **File links in chat:** keep **VesnALIA default**, **Show a Diff Tree button beside links**, or **Open in Diff Tree** on ordinary clicks. VesnALIA default is the initial setting.
- **Show file type icons:** enabled by default; disabling it hides file icons in both the tree and filename header.
- **Smooth diff transitions:** enabled by default. Replace visible loading text with a quiet skeleton and fade the ready diff in over 160 ms, without delaying data display. Disable to restore loading text and immediate transitions. The system's reduced-motion preference disables the animations.
- **Default diff layout:** Unified or Split. The toolbar still allows a temporary override in an open viewer.
- **Code font size:** 10–24 px, default 12.
- **Unchanged lines per expansion:** 1–200, default 30. Expand all remains available.
- **Refresh when returning to VesnALIA:** enabled by default. Manual refresh is always available.

Chat routing applies to live workspace `file:` links and the **Open** buttons in GenUI's **Changes** cards (including file lists inside **Commits**). In button mode, an additional Diff Tree icon appears beside the existing open button; in direct mode, the existing open button opens Diff Tree. Clicking the filename keeps expanding the card's inline diff. Routing selects the file in the thread's Diff Tree panel, clears the path filter, expands its parent folders, and switches to All changes while keeping the chosen comparison branch. Successive links reuse the same panel tab. A file absent from the comparison gets an explicit notice and an **Open file in VesnALIA** link.

Modified clicks, context menus, web links, files outside the workspace, and links in plugin/file previews retain VesnALIA behavior. If the panel cannot open, the original link remains usable. Line suffixes identify the file; navigation does not currently jump to a particular line.

VesnALIA 0.46.1 has no public file-link interception slot. The optional routing uses a cleanup-safe content script over rendered chat anchors, GenUI's accessible file-row controls, and pane containers, with SDK navigation from the owning thread header. It does not read private React state. These DOM adapters may need adjustment when VesnALIA or GenUI changes its markup; the default setting leaves links untouched.

## Limits and data access

Diff Tree is a separate panel. It does not replace VesnALIA's built-in Changes panel and does not stage, revert, or write commits.

Workspace metadata and branch/working-copy diffs use the public VesnALIA SDK. Committed comparisons run bounded, read-only Git commands on the environment's host through typed RPC. The server resolves the host and workspace from the environment ID; the frontend cannot supply an arbitrary host path. Commands run without a shell, optional Git locks, external diff drivers, text converters, or network Git operations.

Historical patches and context are pinned to object IDs. Full versions must match the patch before unchanged lines can expand; refresh if the working copy changes during loading. Context is limited to **512 KiB per version**. Binary files, large files, unavailable context, and truncated results show notices while supported patches remain readable.

Commit history and starting-commit ranges are limited to 200 first-parent entries, a committed file list to 10,000 files, and Git command output to 4 MiB. Line quotes contain at most 500 diff rows. Preferences are stored by VesnALIA; chat navigation targets are kept only for the current app session. The plugin adds no telemetry, background polling, or external icon requests.

## Development

Use Node **22.19+** or **24+**, npm, and the VesnALIA CLI. The SDK and Pierre declarations are pinned to the versions supplied by the supported VesnALIA runtime.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm run check:release
alia plugin reload diff-tree
```

For a live build loop, use `alia plugin dev .` after installing the path plugin. Run `alia plugin types --check .` to compare SDK declarations with your running VesnALIA.

```text
src/
  app/        React panel, components, hooks, and theme-aware styles
  core/       Tree construction, comparison defaults, diff context, and quoting
  host/       Read-only Git history and committed snapshot operations
  server/     Environment resolution and frontend-to-host RPC routing
  shared/     RPC contracts and plugin settings
tests/       Panel interactions, core behavior, real Git fixtures, and helpers
assets/      Plugin branding
skills/      Instructions exposed to ALIA agents
scripts/     Release package validation and marketplace preparation
release/     Listing metadata and draft release/PR text
docs/        Contribution, release, and screenshot guidance
```

The tests exercise the real Pierre renderer and its selection/expansion interactions under jsdom; only browser APIs unavailable in jsdom are stubbed. Git tests use temporary repositories. Run the installed plugin in VesnALIA to check layout, themes, and host integration before release.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/RELEASING.md](docs/RELEASING.md) for checks and publishing steps.

## License

[MIT](LICENSE). Third-party icon attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
