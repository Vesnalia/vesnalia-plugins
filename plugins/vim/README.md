# Vim for VesnALIA

Vim-style editing modes for [VesnALIA](https://getbb.app) text editors.

This plugin adds familiar Vim motions, operators, text objects, visual
selections, search, and modal cursors to VesnALIA's existing editors without
replacing them. The chat composer remains VesnALIA's native editor, so features such
as attachments, image paste, provider controls, voice input, and submission
continue to belong to VesnALIA.

## Highlights

- Vim editing in VesnALIA's chat composer and other multiline text editors.
- Insert, Normal, Visual, and Visual Line modes.
- Native typing and clipboard behavior in Insert mode.
- Motions, counts, operators, text objects, character search, and document
  search.
- A block cursor outside Insert mode.
- A compact mode indicator positioned beside VesnALIA's voice-input control.
- Automatic exclusion of terminals, search fields, command palettes, and
  plugin surfaces that opt out.
- Focus and mode preservation when VesnALIA temporarily rebuilds an editor or loses
  application focus.
- Clean activation and disposal through VesnALIA's content-script lifecycle.

> [!NOTE]
> This is a practical Vim emulation layer for browser-based editors, not a full
> Vim implementation. See [Current limitations](#current-limitations).

## Requirements

- VesnALIA 0.41 or newer.
- VesnALIA Plugin SDK 0.4.34 or newer.

## Installation

### From the VesnALIA extension directory

Once this plugin is listed in VesnALIA's extension directory, install it from VesnALIA's
plugin settings and reload the app if prompted.

### From a Git repository

VesnALIA can install a plugin directly from a public Git repository:

```sh
alia plugin install https://github.com/jad/bb-plugin-vim
```

A bare repository URL tracks its default branch. To pin a branch, tag, or
commit, use VesnALIA's explicit Git form:

```sh
alia plugin install git:https://github.com/jad/bb-plugin-vim.git@main
```

VesnALIA installs third-party plugins with full trust. Review the source and confirm
the repository URL before installing it.

### From a local checkout

```sh
git clone https://github.com/jad/bb-plugin-vim.git
cd alia-plugin-vim
npm install
alia plugin install .
```

Path and Git installs build the frontend bundle automatically. For local
changes, use the development loop described below.

## Quick start

1. Focus VesnALIA's chat composer or another supported multiline editor.
2. The editor starts in **Insert mode**, so type normally.
3. Press `Escape` to enter **Normal mode**.
4. Use Vim motions and commands.
5. Press `i`, `a`, `I`, `A`, `o`, or `O` to return to Insert mode.

The mode indicator uses one letter:

| Indicator | Mode | Behavior |
| --- | --- | --- |
| `I` | Insert | Native typing and caret behavior |
| `N` | Normal | Motions, operators, and commands |
| `V` | Visual | Character-wise selection |
| `L` | Visual Line | Line-wise selection |

Normal and visual modes display a block cursor. Insert mode keeps the editor's
native caret.

## Keybindings

Counts work with motions and supported commands. For example, `3w`, `2dd`, and
`4j` repeat the corresponding action.

### Modes and insertion

| Keys | Action |
| --- | --- |
| `Escape` | Return to Normal mode or cancel a pending command/search |
| `i` | Insert before the cursor |
| `a` | Insert after the cursor |
| `I` | Insert at the first non-blank character |
| `A` | Insert at the end of the line |
| `o` | Open a line below and enter Insert mode |
| `O` | Open a line above and enter Insert mode |
| `v` | Enter Visual mode |
| `V` | Enter Visual Line mode |

### Motions

| Keys | Action |
| --- | --- |
| `h`, `j`, `k`, `l` | Move left, down, up, or right |
| `w`, `b`, `e` | Move by word |
| `W`, `B`, `E` | Move by whitespace-delimited WORD |
| `0` | Start of line |
| `^` | First non-blank character |
| `$` | End of line |
| `gg` | Start of document |
| `G` | End of document |
| `ge`, `gE` | End of previous word or WORD |
| `{`, `}` | Previous or next paragraph |
| `f{char}`, `F{char}` | Find a character forward or backward |
| `t{char}`, `T{char}` | Move until a character forward or backward |
| `;`, `,` | Repeat the last character search forward or backward |
| `Ctrl+D`, `Ctrl+U` | Move half a page down or up |

### Operators and editing

| Keys | Action |
| --- | --- |
| `d{motion}` | Delete through a motion |
| `c{motion}` | Change through a motion |
| `y{motion}` | Yank through a motion |
| `dd`, `cc`, `yy` | Delete, change, or yank a line |
| `x`, `X` | Delete the character under or before the cursor |
| `D` | Delete to the end of the line |
| `C` | Change to the end of the line |
| `Y` | Yank a line |
| `s` | Substitute the character under the cursor |
| `r{char}` | Replace the character under the cursor |
| `p`, `P` | Paste after or before the cursor |
| `u` | Undo |
| `Ctrl+R` | Redo |

Operators can be combined with counts, motions, and supported text objects.
Examples include `dw`, `d$`, `ciw`, `2dd`, `yap`, and `ci"`.

### Text objects

Both inner (`i`) and around (`a`) variants are supported where applicable:

- Words and WORDs: `iw`, `aw`, `iW`, `aW`
- Paragraphs: `ip`, `ap`
- Entire editor content: `ie`, `ae`
- Braces, parentheses, brackets, and angle brackets
- Single quotes, double quotes, and backticks
- Character-pair delimiters such as `|`, `*`, `/`, and `\`

### Search

| Keys | Action |
| --- | --- |
| `/query` | Search forward |
| `?query` | Search backward |
| `n`, `N` | Repeat the last search forward or backward |
| `*`, `#` | Search for the word under the cursor forward or backward |

Press `Enter` to run a search and `Escape` to cancel it.

## Native VesnALIA behavior

The plugin deliberately yields to VesnALIA for host-owned behavior:

- `Cmd+V` on macOS and `Ctrl+V` elsewhere use VesnALIA's native paste handling in
  Insert mode. This supports text, files, and clipboard images.
- `Shift+Enter` passes through to VesnALIA for native newline behavior.
- Modified Enter shortcuts pass through to VesnALIA.
- Switching to another application and returning does not intentionally change
  Vim mode.
- Terminals never receive Vim interception from this plugin.

## Editor targeting

The plugin enables Vim automatically for:

- `<textarea>` elements
- `contenteditable` editors
- Single-line inputs explicitly opted in by their owner

Single-line inputs are native by default because they are commonly search,
navigation, title, filter, or settings controls rather than text editors.

### Excluded surfaces

Terminal descendants are excluded when an ancestor matches any of:

```css
.xterm
[data-terminal]
[role="terminal"]
```

Plugin authors can exclude an editor—or an entire plugin surface—by adding
`data-alia-vim-ignore` to the editor or any ancestor:

```html
<div data-alia-vim-ignore>
  <textarea>Vim will not activate here.</textarea>
</div>
```

This cooperative opt-out avoids hard-coding knowledge of individual VesnALIA
extensions.

### Opting in a single-line input

If a single-line input genuinely behaves like an editor, add
`data-alia-vim-editor` to it or an ancestor:

```html
<div data-alia-vim-editor>
  <input type="text" />
</div>
```

`data-alia-vim-ignore` takes precedence over opt-in behavior.

## Configuration

Open VesnALIA's settings, select **Vim**, and configure:

### Show Vim mode indicator

Controls whether the floating mode indicator is visible:

- `I` — Insert
- `N` — Normal
- `V` — Visual
- `L` — Visual Line

Disabling the indicator does not disable Vim behavior or the block cursor.
The setting is persisted by VesnALIA and is applied to active editors after it is
changed.

## How it works

The plugin has two small VesnALIA entry points:

- [`server.ts`](./server.ts) declares persisted plugin settings and exposes the
  non-secret display preference to the frontend.
- [`app.tsx`](./app.tsx) registers a trusted VesnALIA content script.

The content script installs the vendored Vim runtime from
[`vendor/input-vim/`](./vendor/input-vim/). That runtime:

1. Detects supported editors on focus.
2. Tracks the active Vim mode and pending command state.
3. Intercepts only the key events owned by the current mode.
4. Delegates edits to textarea/input or contenteditable handlers.
5. Draws the mode badge and non-Insert block cursor in an isolated shadow root.
6. Removes its listeners, attributes, cursor, and overlay when VesnALIA unloads or
   reloads the plugin.

The existing VesnALIA editor remains in place throughout; this plugin is an event and
selection layer, not a replacement editor.

## Repository layout

```text
.
├── app.tsx                     # ALIA frontend registration and setting sync
├── server.ts                  # ALIA backend entry and setting declaration
├── app.test.ts                # Browser/editor integration regression test
├── vendor/input-vim/          # Adapted Vim emulation runtime
│   ├── handlers/              # Text input and contenteditable operations
│   ├── shared/                # Shared motion and text utilities
│   ├── event-interceptor.js   # Keyboard/native-event integration
│   ├── focus-manager.js       # Editor activation and focus preservation
│   ├── key-parser.js          # Counts, motions, operators, and modes
│   └── overlay.js             # Mode indicator and block cursor overlay
├── THIRD_PARTY_NOTICES.md     # Upstream attribution and license text
├── package.json               # ALIA plugin manifest
└── tsconfig.json
```

## Development

Install dependencies:

```sh
npm install
```

Install the working directory into VesnALIA:

```sh
alia plugin install .
```

Run VesnALIA's rebuild-and-reload development loop:

```sh
alia plugin dev
```

Or run individual checks manually:

```sh
npm test
alia plugin types --check
alia plugin build
alia plugin reload vim
```

The build emits the distributable frontend and backend artifacts under
`dist/`.

### Tests

The current integration test runs in jsdom with Vitest and covers:

- textarea and contenteditable activation
- Insert-first behavior and mode transitions
- mode-indicator placement and visibility
- terminal and explicit opt-out exclusions
- explicit single-line input opt-in
- native `Shift+Enter` and paste passthrough
- focus and mode preservation across application blur
- cleanup after plugin disposal

Run it with:

```sh
npm test
```

## Contributing

Issues and pull requests are welcome. For behavior changes:

1. Reproduce the issue in VesnALIA's native chat composer when applicable.
2. Keep ALIA-native behavior in Insert mode unless Vim must own the key.
3. Do not enable Vim inside terminals or surfaces marked
   `data-alia-vim-ignore`.
4. Add the smallest regression test that would fail without the fix.
5. Run the test, SDK type check, and plugin build before opening a pull
   request.

Please keep the implementation focused. This plugin should adapt VesnALIA's editors,
not replace them or duplicate host-owned composer features.

## Current limitations

- This is a Vim-inspired editing layer, not Vim, Neovim, or a complete Vim
  compatibility implementation.
- Vim configuration files, plugins, mappings, macros, registers, and Ex
  commands are not generally supported.
- Browser editor behavior differs from a terminal buffer, especially around
  wrapped visual lines, rich contenteditable DOM, undo history, and framework
  rerenders.
- Some editors may consume keyboard events before document-level handlers can
  observe them. The plugin includes an Escape fallback for known cases, but a
  third-party editor can still require cooperation or an explicit opt-out.
- Clipboard behavior outside Insert mode depends on browser clipboard
  permissions.

If you find an incompatibility, include the editor type, mode, key sequence,
expected behavior, actual behavior, browser/ALIA version, and whether the editor
is owned by VesnALIA or another plugin.

## Security and trust

VesnALIA content scripts execute as trusted, same-origin application code. This is
necessary to integrate with existing editor DOM, selections, and keyboard
events. Install only reviewed versions from a repository you trust.

This plugin does not need an API key and does not intentionally transmit editor
content. Its backend is limited to plugin settings.

## Attribution

The Vim emulation layer under [`vendor/input-vim/`](./vendor/input-vim/) is
adapted from [Input Vim](https://github.com/matheuskieling/vim-input) at commit
`f0d6eb31d5b5d488c5d0a8ec9b674e1fa2d5fb8f`.

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for the upstream MIT
license notice.

## License

Before publishing this repository, add a top-level `LICENSE` file declaring the
license for this project's original code. The adapted Input Vim code remains
subject to the MIT terms reproduced in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
