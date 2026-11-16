---
name: preset-buttons
description: Inspect and switch the New thread composer's preset buttons, which apply a saved provider/model/reasoning combination in one click. USE WHEN preset buttons, new thread presets, switch preset set, what model does the new thread use, preset-buttons, configure thread defaults.
---

# Preset Buttons

Four buttons in the bottom action row of the New thread screen, between the
provider/model button and the Prompt Enhancer plugin's icon. Each applies one
saved provider / model / reasoning combination to the composer, so a new
thread opens on the intended harness rather than whatever the last thread used.

## Inspecting the active presets

```sh
alia preset-buttons list          # the four currently shown, with their values
alia preset-buttons list --json   # same, machine-readable
```

The output names the active set and, when the configured set could not be
honoured, a warning line saying so.

## Switching sets

```sh
alia preset-buttons sets              # every selectable set, with ids
alia preset-buttons use codex         # by id
alia preset-buttons use "Codex only — the GPT ladder"   # or by label
alia preset-buttons use custom        # the JSON set in this plugin's settings
```

Switching reaches every open composer immediately: the plugin publishes the
change and the button row re-renders in place. No reload is needed.

## Editing the custom set

Open Settings → Preset Buttons for the interactive editor. It uses VesnALIA's live
provider/model catalogue and can change the label and icon, add, remove, and
reorder 1-8 buttons. Each button's icon is chosen with a browse-and-search
picker over the plugin's curated MIT-licensed HugeIcons pool (search by name,
arrow key + Enter to select, or click the glyph). Saving the editor also
activates the custom set, and open composers update immediately.

The same custom set is writable from a terminal for scripting or recovery:

```sh
alia plugin config preset-buttons set customPresets '[{"label":"Nano","providerId":"ollama","model":"qwen2.5:3b","reasoningLevel":"low"},{"label":"Big","providerId":"claude-code","model":"claude-opus-5-5","reasoningLevel":"max"}]'
alia plugin config preset-buttons set presetSet "Custom — defined in this plugin's settings"
```

A preset requires `label`, `providerId`, and `model`. Optional: `icon` (a plugin
icon name, always prefixed `pb-`, e.g. `pb-Zap`), `reasoningLevel`,
`serviceTier`, `permissionMode`, `id`. Missing `id`s are derived from the
label, so authors do not have to invent them. The `pb-` prefix is deliberate:
a bare `Zap`/`Star`/etc. would collide with a VesnALIA built-in of the same name and
silently replace that built-in everywhere (including the top-left sidebar), so
every registered icon carries the prefix.

The `customPresets` setting rejects malformed JSON at write time. If the custom
entry is selected while that setting is empty or invalid, the buttons fall back
to the first built-in set and both the CLI and the UI report the fallback rather
than failing silently.

## Reading the current presets before spawning a thread

`alia preset-buttons list --json` returns each preset's `providerId`, `model`,
and optional `reasoningLevel` / `serviceTier` / `permissionMode` — enough to
pass the same combination to `alia thread spawn` and reproduce what the button
would have done.

## Constraints

- A preset's values are reconciled against the live provider catalogue when
  applied. A model the provider no longer lists lands on that provider's
  default; pressing the button then reports the adjustment.
- A provider the composer does not list is ignored, together with the model and
  reasoning level meant for it.
- `serviceTier` is ignored by providers that declare no tiers.
