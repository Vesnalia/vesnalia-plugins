---
name: pinch-zoom
description: How the Pinch Zoom bb plugin changes app, composer and terminal text size, its settings, and how to troubleshoot it.
---

# Pinch Zoom

The Pinch Zoom plugin changes text size in the bb app with pinch gestures. It
has no CLI command; gestures and sizes run in each app window.

- Pinch anywhere except a terminal: changes the text size (75%–200%).
- Pinch over a terminal: fine-tunes that device's terminal size on top of the
  configured ratio. Terminals keep following later text-size changes.
- Desktop: trackpad pinch, or Ctrl + mouse wheel.
- Pinches inside dialogs (image lightbox, diagram viewer) are left to bb.

## Settings (shared by every device)

Change them in Settings → Pinch Zoom or with `bb plugin config pinch-zoom set <key> <value>`:

- `scope`: `content` (default) scales only the chat timeline, composer and
  terminals, using CSS `zoom`, and leaves the sidebar and headers at normal
  size; `app` scales the whole app through the root font size.
- `composerScale` (default 1, range 0.5–2): composer text size relative to the chat
  text size. The plugin measures both, so the composer matches chat even where bb
  sizes them differently (15px chat vs 16px composer on phones). On iOS the
  composer never goes below 16px, because Safari zooms the page when a smaller
  field is focused.
- `terminalScale` (default 1, range 0.5–2): terminal size relative to the text
  size. The terminal font is 12px × text size × this value × the device fine-tune,
  rounded to whole pixels and clamped to 8–32px.

Settings apply live; no reload is needed.

## Per-device state

The text size and the terminal fine-tune live in localStorage
(`bb-plugin-pinch-zoom:v1`). The Current sizes section in Settings shows them
with A−/A+ and Reset buttons.

## Constraints

bb has no API for terminal font size, so the plugin locates each xterm instance
through React internals. "Chat, composer and terminal only" relies on bb's
`[data-timeline-row-list="top-level"]` and `form[data-promptbox]` elements. A bb
update that changes those can stop the affected part from scaling; disabling the
plugin restores bb's defaults.
