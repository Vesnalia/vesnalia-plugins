# Project Themes for VesnALIA

A minimal plugin that gives each project a subtle color accent.

Open **Settings → Project Themes → Project colors**, select a project, and customize:

- **Thread rows** — tint the project's rows in the standard thread list.
- **Browser tab** — color the VesnALIA favicon and internal Browser tabs.
- **Background** — subtly tint the workspace and sidebar.

Each project has one shared color and independent toggles for all three elements.
Choose from eight muted presets or use the native color picker. The preview shows
changes before you save. Click **Save** to apply them or **Reset** to restore the
selected project's defaults. All elements are enabled by default; the initial
color is determined by the project ID. Turning an element off keeps your color.

Settings are stored on the VesnALIA server and synchronized across windows. The background
and favicon follow the current project. Rows from different projects retain their
own colors when shown together. Disabling the plugin removes its styles and
restores the original VesnALIA favicons.

## Installation

Run these commands from the monorepo root. Requires VesnALIA 0.45+ and a compatible
Plugin SDK version starting at 0.6.15.

```sh
npm install
npm run build --workspace=alia-plugin-project-themes
alia plugin install path:. --plugin project-themes
```

## Development

```sh
npm run typecheck --workspace=alia-plugin-project-themes
npm test --workspace=alia-plugin-project-themes
npm run build --workspace=alia-plugin-project-themes
npm run dev:project-themes
```

Tests cover project isolation, persistence across reloads, per-project reset,
input validation, and cleanup of styles and favicons. `alia plugin build` generates
`dist/`; include these artifacts when publishing to npm. Local path and Git
installations build the plugin automatically.

## Limitations

External browsers allow favicon customization; the browser controls the tab's
system chrome. Website and terminal content are unaffected. Colors blend with
the current VesnALIA theme to remain subtle in light and dark modes. The background
and internal Browser tabs follow the current route's project; split views share
one background accent.

Thread and browser-tab styling uses VesnALIA's DOM through the official content-script
API. Selectors may need updating if VesnALIA's UI structure changes. Alternative thread
list plugins are supported when they preserve the standard row markers.

Release instructions: [RELEASING.md](https://github.com/lumenikoly/useful-bb-plugins/blob/main/docs/RELEASING.md).

## License

[MIT](LICENSE), copyright © 2026 lumenikoly.
