# alia-plugin-plan-mode

A VesnALIA plugin that keeps a todo list. It shows every surface a plugin can own:

- `server.ts` — the backend: a todo store in `alia.storage.kv`, RPC methods
  for the page, a `alia plan-mode` CLI command, a setting, and a realtime signal
  that keeps every open page current.
- `app.tsx` — the frontend: an **Example todos** page in the left sidebar
  (`app.slots.navPanel`) built from the vendored components.
- `skills/example-todos/SKILL.md` — a skill that tells agents how to keep the list
  with `alia plan-mode`. VesnALIA imports it into agent threads automatically.
- `PLUGIN_OVERVIEW.md` — the store listing text: a longer version of
  `alia.description` that the plugin detail page shows under it. See
  [Store listing](#store-listing).

Try it: install the plugin, open **Example todos** in the sidebar, then run
`alia plan-mode add "Ship it"` in a terminal. The page updates at once.

## UI components

`components/ui/` is vendored source you own (the shadcn model): edit the
files freely — they never update out from under you. Add more from the VesnALIA
component registry (the full shadcn set, version-matched to your VesnALIA install
via the pinned ref in `components.json`):

```
npx shadcn add @alia-core/select @alia-core/table
```

Run `npm install` once before `alia plugin build` — the vendored components'
npm deps bundle into your dist. React, and ALIA-shimmed packages like the
radix portal primitives and `sonner` (`import { toast } from "sonner"`
reaches VesnALIA's own toaster), are provided by the VesnALIA app at runtime and never
bundled. Every shimmed package is declared in `devDependencies` at the
host's version so those imports typecheck; keep them there (never in
`dependencies`, which would bundle a second copy), and `alia plugin types`
repins them alongside the SDK. Ship `dist/` (npm tarball or committed for
git installs) so people installing your plugin never need npm.

## Manifest

`package.json` is the plugin manifest. Notable fields:

- `alia.server` — backend entry (required).
- `alia.app` — frontend entry. Delete it, `app.tsx`, `components/`,
  `hooks/`, and `lib/` for a headless plugin.
- `alia.skills` — skill roots; omitted here, so VesnALIA reads `skills/`. Each
  directory with a `SKILL.md` is one skill, named after the directory.
- `alia.name` and `alia.description` — required human-facing identity.
- `alia.branding` — required; declare `icon` as a VesnALIA icon name or a
  plugin-relative compact SVG, or declare `logo.light` (with optional
  `logo.dark`). Logo assets must be relative `.svg`, `.png`, or
  `.webp` files.
- `engines.alia` — supported VesnALIA app version range.
- `engines.aliaPluginSdk` — the lowest plugin SDK you need (scaffold:
  `>=0.4.47`). VesnALIA reads this as a floor, not a ceiling: a later
  SDK in the same major still loads your plugin.
- `dependencies` — every package your source imports that VesnALIA does not provide.
  `alia plugin build` inlines them into `dist/`, and git installs resolve this
  list alone, so a build-required package here rather than in
  `devDependencies` is what keeps your plugin installable. `devDependencies`
  is for types and tooling only (VesnALIA shims React, the portal primitives, and
  `@vesnalia/plugin-sdk` at runtime — never bundle them).

Run `alia plugin build` before publishing git/npm installs. It writes
`dist/server.js` + `server.meta.json` and `app.js` / `app.css` /
`app.meta.json`. Each `*.meta.json` stamps SDK major/version,
`artifactFormatVersion`, `pluginId`, `pluginVersion`, and
`builtWith` so managed installs can verify the artifacts.

## Store listing

Two texts describe the plugin in the store. `alia.description` in package.json
is the one-sentence hook on every browse card and the lead paragraph on the
detail page; keep it under about 140 characters. `PLUGIN_OVERVIEW.md` is the
same claim at length, shown in an Overview section under that paragraph.
Rewrite the scaffold's copy for your plugin, and update it whenever
`alia.description` changes, so the two never disagree.

The submission to the public VesnALIA Community marketplace requires the file. Keep
it under 4000 characters (aim for 700 to 1800) and use headings, paragraphs,
emphasis, code, blockquotes, lists, thematic breaks, and absolute https links
only — raw HTML, images, tables, footnotes, and task lists are rejected. Do
not open with a `#` title or repeat `alia.description` verbatim; the page
shows both directly above.

## Install

From this directory (`alia plugin new` already ran the install; a fresh clone
needs it):

```
npm install
alia plugin install .
```

After editing sources, reload:

```
alia plugin reload plan-mode
```

Or let `alia plugin dev` rebuild and reload on every save.

## Configure

```
alia plugin config plan-mode
alia plugin config plan-mode set showDone false
alia plugin reload plan-mode
```

## Types & API reference

The plugin API ships as the npm package `@vesnalia/plugin-sdk`, pinned to an
exact version in `devDependencies` (`0.4.47` — the SDK of the VesnALIA
that scaffolded this plugin). After `npm install`, the full surface is on disk
at:

```
node_modules/@vesnalia/plugin-sdk/bundled-types/alia-plugin-sdk.d.ts      # backend
node_modules/@vesnalia/plugin-sdk/bundled-types/alia-plugin-sdk-app.d.ts  # frontend
```

Your editor and `tsc` resolve `@vesnalia/plugin-sdk` there through ordinary node
resolution — no path mapping. These are readable declarations: open them for an
exact signature.

The SDK surface grows with every VesnALIA release, so the pin has to track the VesnALIA you
actually run:

```
alia plugin types          # sync this plugin's SDK surface to the running ALIA
alia plugin types --check  # CI: fail when it does not match
```

Ask VesnALIA to write plugins for you: the `alia-plugin-authoring` skill documents
the whole surface with examples.

Confused by the API, or need something the types don't explain? Clone the VesnALIA
repo and read the source: <https://github.com/get-bb/bb>.
