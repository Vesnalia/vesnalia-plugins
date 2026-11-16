# Design

## Context

Greenfield repo; only OpenSpec files exist. See proposal.md for motivation. VesnALIA 0.46.1 ships `@vesnalia/plugin-sdk` 0.6.49. Findings from VesnALIA's bundled plugin docs and the app bundle:
- `app.composer.experimental_registerCommand({ id, title, defaultShortcut, run })` registers a command whose `run({ composer })` gets the composer holding the caret. VesnALIA routes the shortcut, lists the command in the palette and Settings → Keyboard, and disables it while a terminal, browser tab or modal has focus.
- VesnALIA's shortcut matcher compares lowercased `event.key` plus modifiers; it falls back to `event.code` only when Option is held. A `defaultShortcut` therefore follows the active layout.
- VesnALIA's Edit menu has only the `paste` role, no Paste and Match Style, so ⇧⌘V never fires a native paste event.
- `navigator.clipboard.readText()` works in VesnALIA Desktop's main window on a key press without a prompt.

## Goals / Non-Goals

**Goals:** a single command that inserts clipboard text only, minimal code, resilient to editor changes.

**Non-Goals:** other text fields, rich-text or HTML paste, a settings UI, a backend.

## Decisions

1. **Composer command with `composer.insert` (chosen).** Insertion goes through VesnALIA's own editor API, so it replaces selections and avoids synthetic events and `execCommand`. Alternatives: a content-script `paste` interception (rejected: no native paste fires for ⇧⌘V and a flag would leak into the next ⌘V); a content-script `keydown` listener (kept only as the layout fallback, see 3).
2. **Read with `navigator.clipboard.readText()`.** It returns text only, so images are never seen. VesnALIA's docs forbid it for writes, but no read API exists and a key press gives it focus. On rejection or empty text, show a toast and insert nothing.
3. **Layout fallback decided by a check, not by listing layouts.** The owner checks on the Russian layout whether macOS reports `key` "v" or "м" for ⇧⌘V. If "v", keep the command as is. If "м", replace the shortcut path with a content-script `keydown` listener matching `event.code === "KeyV"` with ⌘⇧, and call the same insert path. Per-layout extra shortcuts were rejected because they only cover listed layouts.
4. **Pin `engines`** to `alia >=0.46` and `aliaPluginSdk >=0.6.49` because the API is `experimental_`.
5. **The `alia.app` entry, one pure module and one test.** The scaffold is trimmed to those; the server entry stays only if the manifest requires one (`alia.server` is a required field in the manifest schema), reduced to a no-op.

## Risks / Trade-offs

- [`experimental_` API changes] → pin engines, re-check on VesnALIA upgrades.
- [⇧⌘V already bound in VesnALIA, leaving the plugin unbound] → check Settings → Keyboard after first install; listed in the manual checklist.
- [`composer.insert` line-break or selection behavior unverified] → confirm in apply with a multi-line paste and a paste over a selection; both are in the checklist.
- [Fallback A loses palette and rebinding support] → used only if the layout check fails.
- [`readText` fails outside a key press, such as from the palette] → toast, no insert.
