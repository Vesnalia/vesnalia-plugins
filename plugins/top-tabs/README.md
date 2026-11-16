# Top Tabs for VesnALIA

Browser-style tabs for the threads you open, across the top of the
[VesnALIA](https://getbb.app) window.

- Every thread you open in a window gets a tab with VesnALIA's status glyph.
- Click to switch, × or middle-click to close, drag to reorder.
- Ctrl+Tab and Ctrl+Shift+Tab cycle through tabs.
- Right-click a tab for VesnALIA's thread menu plus Close tab, Close other tabs and
  Close tabs to the right.
- `+` opens the New thread screen.

Tabs are kept per window in local storage. The plugin has no server state and
sends nothing anywhere.

## Install

In VesnALIA, open Plugins and install **Top Tabs** from the Community marketplace, or:

```sh
alia plugin install https://github.com/nikushiks/bb-plugin-top-tabs.git
```

Requires VesnALIA 0.49 or later.

## How it works

- `app.tsx` — the tab strip, registered as an `experimental_appOverlay` and
  portaled to `document.body`. While it is mounted it moves the app shell down
  by the strip's height (`--alia-shell-height` and `#root`) and restores it on
  unmount. Below 640 px window width the strip hides.
- `server.ts` — an empty backend; VesnALIA requires one.
- `skills/top-tabs/SKILL.md` — how the tabs behave, for agents.

## Develop

```sh
npm install
alia plugin install .
alia plugin dev
```

## License

MIT
