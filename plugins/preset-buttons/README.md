# alia-plugin-preset-buttons

Four one-click presets in the New thread composer's bottom action row, between
the provider/model button and the Prompt Enhancer plugin's icon. Each button
applies a provider / model / reasoning preset to the composer, so a new thread
starts on the harness you meant to use.

![The preset strip in the New thread composer](screenshots/composer-strip.png)

*Fast, Balanced, Deep, and Code sit beside the provider/model trigger and apply
a saved combination in one click.*

## Settings

The plugin detail page has an interactive button editor. Choose a built-in set
as a starting point, select each provider/model/reasoning combination from
VesnALIA's live catalogue, rename or reorder buttons, and add or remove buttons.
Each button's icon uses a browse-and-search picker over the plugin's curated
HugeIcons pool. Saving writes and activates the custom set immediately.

![Preset set, custom JSON, and starting sets](screenshots/settings.png)

*Configuration: the active set, the built-in starting sets, and the JSON escape
for CLI and advanced use.*

![The button editor](screenshots/button-editor.png)

*The interactive button editor. Every combination is picked from VesnALIA's live
provider and model catalogue; order, label, and icon are editable in place.*

![The icon picker](screenshots/icon-picker.png)

*The icon picker: search, or browse the curated pool grouped by meaning.*

The declarative settings remain available for CLI and advanced use:

| Setting | Meaning |
|---|---|
| `Preset set` | Which set the four buttons use. A built-in set, or the custom entry. |
| `Custom preset set (JSON)` | A JSON array of 1-8 presets, used when the custom entry is selected. |

A preset needs `label`, `providerId`, and `model`; `icon`, `reasoningLevel`,
`serviceTier`, `permissionMode`, and `id` are optional. Missing ids are derived
from the label.

## Layout

The strip sits between the provider/model trigger and the Prompt Enhancer
plugin's icon when that plugin is installed (otherwise it just sits after the
trigger). It never shrinks and never wraps — a `margin-left: auto` pins it
flush against the right edge of that row, so it holds a stable screen
position and stays on one line regardless of how long the provider/model
label gets. The model trigger is the one built to give way under real
constraint: it already truncates its own label rather than push on anything
next to it. On a window narrow enough that even a fully truncated model
trigger and the fixed-width strip cannot both fit, the strip overflows the
row rather than reflow — a known trade-off of never wrapping, not something
this plugin tries to paper over.

## Files

- `server.ts` — owns configuration: the `presetSet` dropdown and the
  `customPresets` setting, RPCs for reading, switching, and saving presets, a
  realtime signal so a settings write reaches open composers, and the
  `alia preset-buttons` CLI.
- `lib/presets.ts` — the preset catalogue and schemas. Built-in sets are plain
  data; adding one is a data edit.
- `lib/icons.tsx` — the OSS icon catalogue. A curated pool of MIT-licensed
  HugeIcons registered into VesnALIA's icon registry, plus the searchable pool the
  picker browses.
- `components/PresetStrip.tsx` — the button row. Mounted as a
  `new-thread`-scoped composer banner, which is what supplies the `useComposer()`
  context that applying a preset requires; it portals its UI into the bottom
  action row.
- `components/IconPicker.tsx` — the browse-and-search overlay used to choose a
  button icon in the settings editor.
- `components/PresetSettings.tsx` — the interactive settings editor. It uses
  VesnALIA's live provider/model picker and manages button labels, icons, order,
  additions, and removals without requiring JSON edits.
- `skills/preset-buttons/SKILL.md` — how an agent inspects and switches sets.

## Why it is built this way

Two constraints do not agree:

- **Position.** The buttons belong in the bottom action row, between the
  provider/model trigger and the Prompt Enhancer icon, which is host DOM in
  the composer. No plugin slot renders there.
- **Capability.** Applying a preset needs `useComposer().experimental_setSelection`,
  which only exists for a component the host mounts inside a composer.

A content script has the DOM but no composer context; a composer banner has the
context but renders above the editor. So the banner supplies the context and
portals its buttons into the action row. `PresetStrip.tsx` documents this in
full, including why every DOM lookup is scoped to `[data-app-composer]`
instead of `document` (more than one composer can be mounted at once — see
the Quick Thread plugin) and why the portal host is `shrink-0` + `ml-auto`
rather than a shrinkable flex item.

## CLI

```
alia preset-buttons list [--json]        # the presets the buttons apply now
alia preset-buttons sets [--json]        # every selectable set
alia preset-buttons use <set-id|label>   # switch the active set
```

## Development

```sh
npx tsc --noEmit
alia plugin build .
alia plugin reload preset-buttons
```

A frontend change needs the build before the reload; a `server.ts` change needs
only the reload.
