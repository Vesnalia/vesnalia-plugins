# bb-plugin-model-favicons

Custom icons for BB's providers — give custom ACP agents a real logo instead of the
generic Toolbox mark.

## What BB can and cannot do

BB draws **one icon per provider, never per model**. The model schema
(`availableModelSchema` in `@bb/domain`) has no icon field, so every model row in a
picker inherits its provider's logo. A per-model favicon is therefore not expressible
in BB's public API — the finest granularity a plugin can reach is one mark per
**provider id**.

What that fixes in practice: BB's own `provider-acp` plugin ships a logo for its 41
registry agents and for `cursor`, `opencode`, `grok` and `hermes-agent`. Every other
agent — the ones added with `bb acp add` or the ACP plugin's `customAgents` setting —
falls back to the generic **Toolbox** glyph. Two custom agents look identical
everywhere in the UI. This plugin draws the right mark for them.

## How it works

- `app.tsx` registers one inline React mark per provider id with
  `app.slots.experimental_providerIcon({ providerKind: "agent", providerId, icon })`.
  A registered mark takes precedence over the provider's own `logoUrl`, and the
  provider's `strings.iconTint` still applies, so the mark follows the BB theme.
- `lib/marks.tsx` holds the marks as inline SVG. They are monochrome `currentColor`
  artwork — the official ACP registry marks, inlined so the plugin needs no logo
  endpoint and no network fetch.
- `lib/icon-store.tsx` keeps the live override map in module scope. BB collects
  registrations once and rejects a second registration for the same
  `(kind, provider id)`, so the registered component reads the current choice at
  render time instead of being bound to one mark. An override applies without a
  reload.
- `server.ts` owns the persisted map in `bb.storage.kv`, serves the
  `bb model-favicons` CLI, and publishes an `icons-changed` realtime signal so every
  open window refreshes.
- `skills/model-favicons/SKILL.md` tells agents how to set a mark.

## Use

```bash
# Which provider id? Read it from the provider list — never guess it.
bb provider list --json

# Set the mark for a custom ACP agent.
bb model-favicons set acp-zcode glm
bb model-favicons set acp-kimi-code kimi

# Inspect and undo.
bb model-favicons list
bb model-favicons reset acp-zcode
```

Add `--json` to any command when the output drives code.

### Marks

| Mark | Agent |
| --- | --- |
| `glm` | Z.ai / GLM |
| `kimi` | Kimi |
| `minimax-code` | MiniMax Code |
| `opencode` | OpenCode |
| `qwen-code` | Qwen Code |
| `claude` | Claude |
| `codex` | Codex |
| `gemini` | Gemini |
| `agent` | A neutral agent mark, for a custom agent with no vendor mark |

### Mark sources

The marks are inline SVG, so they need no download at runtime. Most come from the
`registry-*.svg` assets BB's own `provider-acp` plugin ships for the ACP registry
agents. The `kimi` mark is the official KIMI "K only" symbol from Moonshot AI's
brand guide — <https://github.com/MoonshotAI/Branding-Guide> — so it matches the
vendor's own artwork rather than the generic swirl BB bundles for the `kimi`
registry agent.

BB renders a provider icon as a single-colour mask, so every mark is drawn in
`currentColor` and follows the theme in light and dark. A two-colour brand mark
loses its second colour; the `kimi` mark keeps Kimi's signature corner by
folding it into the K's own shape.

### Defaults

Without an override the plugin draws the vendor mark for the agents BB leaves on the
Toolbox glyph: `acp-zcode` (GLM), `acp-kimi-code` (Kimi), `acp-minimax-code`,
`acp-opencode`, and the registry-id variants `acp-glm-acp-agent`, `acp-kimi`,
`acp-qwen-code`, `acp-claude-acp`, `acp-codex-acp`, `acp-gemini`. Add more by setting
an override.

## UI components

`components/ui/` is vendored source you own (the shadcn model): edit the files
freely — they never update out from under you. Add more from the BB component
registry (the full shadcn set, version-matched to your BB install via the pinned ref
in `components.json`):

```
npx shadcn add @bb/select @bb/table
```

Run `npm install` once before `bb plugin build` — the vendored components' npm deps
bundle into your dist. React, and BB-shimmed packages like the radix portal
primitives and `sonner` (`import { toast } from "sonner"` reaches BB's own toaster),
are provided by the BB app at runtime and never bundled. Every shimmed package is
declared in `devDependencies` at the host's version so those imports typecheck; keep
them there (never in `dependencies`, which would bundle a second copy), and
`bb plugin types` repins declared packages alongside the SDK; unused packages may be
removed. Ship `dist/` (npm tarball or committed for git installs) so people
installing your plugin never need npm.

## Manifest

`package.json` is the plugin manifest. Notable fields:

- `bb.server` — backend entry (required).
- `bb.app` — frontend entry. Delete it, `app.tsx`, `components/`, `hooks/`, and
  `lib/` for a headless plugin.
- `bb.skills` — skill roots; omitted here, so BB reads `skills/`. Each directory
  with a `SKILL.md` is one skill, named after the directory.
- `bb.name` and `bb.description` — required human-facing identity.
- `bb.branding` — required; declare `icon` as a BB icon name or a plugin-relative
  compact SVG, or declare `logo.light` (with optional `logo.dark`). Logo assets must
  be relative `.svg`, `.png`, or `.webp` files.
- `engines.bb` — supported bb app version range.
- `engines.bbPluginSdk` — the lowest plugin SDK you need (scaffold: `>=0.6.132`). BB
  reads this as a floor, not a ceiling: a later SDK in the same major still loads
  your plugin.
- `dependencies` — every package your source imports that BB does not provide.
  `bb plugin build` inlines them into `dist/`, and git installs resolve this list
  alone, so a build-required package here rather than in `devDependencies` is what
  keeps your plugin installable. `devDependencies` is for types and tooling only (BB
  shims React, the portal primitives, and `@get-bb/plugin-sdk` at runtime — never
  bundle them).

Run `bb plugin build` before publishing git/npm installs. It writes
`dist/server.js` + `server.meta.json` and `app.js` / `app.css` / `app.meta.json`.
Each `*.meta.json` stamps SDK major/version, `artifactFormatVersion`, `pluginId`,
`pluginVersion`, and `builtWith` so managed installs can verify the artifacts.
`app.meta.json` also lists `runtimeSlots`, the shimmed host modules the bundle
imports.

## Store listing

Two texts describe the plugin in the store. `bb.description` in package.json is the
one-sentence hook on every browse card and the lead paragraph on the detail page;
keep it under about 140 characters. `PLUGIN_OVERVIEW.md` is the same claim at length,
shown in an Overview section under that paragraph. Rewrite the scaffold's copy for
your plugin, and update it whenever `bb.description` changes, so the two never
disagree.

The submission to the public BB Community marketplace requires the file. Keep it
under 4000 characters (aim for 700 to 1800) and use headings, paragraphs, emphasis,
code, blockquotes, lists, thematic breaks, and absolute https links only — raw HTML,
images, tables, footnotes, and task lists are rejected. Do not open with a `#` title
or repeat `bb.description` verbatim; the page shows both directly above.

## Install

From this directory (`bb plugin new` already ran the install; a fresh clone needs it):

```
npm install
bb plugin install .
```

After editing sources, reload:

```
bb plugin reload model-favicons
```

Or let `bb plugin dev` rebuild and reload on every save.

## Types & API reference

The plugin API ships as the npm package `@get-bb/plugin-sdk`, pinned to an exact
version in `devDependencies` (`0.6.132` — the SDK of the BB that scaffolded this
plugin). After `npm install`, the full surface is on disk at:

```
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts      # backend
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts  # frontend
```

Your editor and `tsc` resolve `@get-bb/plugin-sdk` there through ordinary node
resolution — no path mapping. These are readable declarations: open them for an
exact signature.

The SDK surface grows with every BB release, so the pin has to track the BB you
actually run:

```
bb plugin types          # sync this plugin's SDK surface to the running BB
bb plugin types --check  # CI: fail when it does not match
```

Ask BB to write plugins for you: the `bb-plugin-authoring` skill documents the whole
surface with examples.

Confused by the API, or need something the types don't explain? Clone the BB repo
and read the source: <https://github.com/get-bb/bb>.
