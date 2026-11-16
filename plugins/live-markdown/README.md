# bb-plugin-live-markdown

Obsidian-style live-preview editing for `.md`, `.mdx`, and `.markdown` files in
BB's side panel. 

The editor buffer is the file's exact text (CodeMirror 6). Markdown syntax —
`#`, `**`, `` ` ``, `[label](url)`, `>`, list markers — is hidden on lines the
cursor is not on and shown dimmed on the line it is on. Nothing is
re-serialized, so saving changes only the characters you typed.

## Tables

GFM tables stay rendered while you edit them. Click a cell and that cell alone
becomes an editable field showing its raw Markdown (`**bold**`, `<br>`,
links); every keystroke rewrites exactly that cell's characters in the file.
A table shows as raw source only when it no longer parses as a table.

- Tab / Shift+Tab: next / previous cell. Tab past the last cell adds a row.
- Enter: same column, next row. Shift+Enter: insert `<br>`. Escape: leave the cell.
- A typed or pasted `|` is written as `\|`, and pasted newlines as `<br>`, so a
  cell edit cannot split the row.
- Ctrl/Cmd+S saves; Ctrl/Cmd+Z undoes through the editor's history.
- Ctrl/Cmd+click a link in a cell to open it.
- To see a whole table's source, use **Source** in the header.

## Use

- Live Markdown becomes the default `.md` / `.mdx` / `.markdown` opener on
  install — see [Default opener](#default-opener). Change it any time under
  Settings → File openers.
- One-off: right-click a file link → Open with → Live Markdown.
- Header: save state (Saved / Unsaved / Saving… / Changed on disk) and a
  **Source** toggle that shows all syntax everywhere.
- Ctrl/Cmd+click a link to open it; a plain click edits.

## Default opener

bb has no manifest or registration option for a default opener. With no
per-extension choice it uses the first matching opener in plugin-id order,
which is usually another plugin. So a content script
(`default-opener.ts`) seeds the choice that Settings → File openers stores
(the browser-local `bb.fileOpenerByExtension` key), with these rules:

- It runs **once per browser**. It pins `md`, `mdx`, and `markdown` to Live
  Markdown only where that extension has no choice yet, then writes the marker
  `bb-plugin:live-markdown:default-opener-seeded:v1` and never touches the
  preference again.
- An existing choice — Built-in preview or another plugin — is never
  overridden. Picking **Automatic** later removes the pin, and the marker keeps
  the script from re-adding it.
- Unreadable preference JSON is left untouched.
- Each browser (desktop window, remote client, phone) has its own preference,
  so each is seeded on its first load with the plugin enabled.
- After uninstalling, the pin points to a missing opener and bb falls back to
  its built-in preview; choose Automatic under Settings → File openers to undo.

## Saving

- Autosave 1 s after you stop typing; Ctrl/Cmd+S saves immediately.
- Every write is compare-and-swap on the sha256 the editor last saw.
- The file is re-read every 3 s while the tab is visible. With no unsaved
  edits, a change on disk (an agent editing the file) is applied in place,
  keeping cursor and scroll. With unsaved edits it shows a banner: **Load disk
  version** discards your edits, **Keep mine** overwrites exactly the version
  you were shown.
- CRLF files are written back with CRLF.
- Files over 4 MB, or not UTF-8, fall back to BB's read-only preview.

## Layout

- `server.ts` — `read` / `write` RPCs over `bb.sdk.files`, resolving workspace,
  host, and thread-storage paths.
- `app.tsx` — the `fileOpener` registration, load/save/conflict state.
- `default-opener.ts` — one-time default-opener seeding (content script).
- `editor/live-preview.ts` — inline decorations (view plugin).
- `editor/tables.ts` — table block widgets (state field) and in-place cell editing.
- `editor/inline-render.ts` — cell Markdown → DOM, no `innerHTML`.
- `editor/theme.ts` — styling from BB theme variables.

## Develop

```sh
npm install
npx tsc --noEmit -p tsconfig.json
bb plugin build .
bb plugin reload live-markdown
```
