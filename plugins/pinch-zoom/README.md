# bb-plugin-pinch-zoom

Pinch to change bb's app text size, or pinch over a terminal to change the
terminal's text size.

| Gesture | Where | Changes |
| --- | --- | --- |
| Pinch (touch / trackpad) or Ctrl + wheel | over a terminal | terminal fine-tune, 8–32px |
| same | anywhere else | text, 75–200% (terminals and composer follow) |

Sizes persist per device (localStorage). Settings → Pinch Zoom has A−/A+ and
Reset buttons.

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `scope` | `content` | `content` scales only chat, composer and terminals; `app` scales the whole app |
| `composerScale` | `1` | composer text size relative to the chat text size (0.5–2); never below 16px on iOS |
| `terminalScale` | `1` | terminal size relative to the text size (0.5–2) |

Terminal font = 12px × text size × `terminalScale` × the device fine-tune from
pinching over a terminal, rounded and clamped to 8–32px.

```
bb plugin config pinch-zoom set scope app
bb plugin config pinch-zoom set composerScale 1.2
```

## Layout

- `lib/zoom-core.ts` — pure sizing math and persistence parsing (unit-tested).
- `lib/zoom-store.ts` — per-window store shared by gestures, the settings bridge and the settings section.
- `lib/gestures.ts` — the content script: gesture routing, root font size, indicator.
- `lib/terminal-bridge.ts` — finds bb's xterm instances and refits them.
- `app.tsx` — registers the content script and the settings section.

## Develop

```
npm install --include=dev
npm test
npm run typecheck
bb plugin install .
bb plugin dev
```

## Known constraint

bb hard-codes the terminal font size and exposes no SDK API for it. The plugin
finds each xterm `Terminal` through the React fiber of its container and
triggers bb's own fit/PTY-resize path by nudging the container size for one
frame. "Chat only" scope applies CSS `zoom` to bb's
`[data-timeline-row-list="top-level"]` and `form[data-promptbox]`. A bb update
to those components can break the matching part; whole-app text sizing does not
depend on them.
