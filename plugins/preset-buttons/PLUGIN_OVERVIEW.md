Four one-click presets in the composer's bottom action row on the New thread
screen, so a new thread opens with the provider, model, and reasoning level
you meant to use — instead of whatever the last thread happened to leave
behind.

## What you get

- **Four preset buttons** in the composer's bottom action row, between the
  provider/model button and the Prompt Enhancer plugin's icon (when that
  plugin is installed). Each applies one provider / model / reasoning
  combination in a single tap.
- **Interactive configuration.** Choose a built-in starting set, select live
  provider/model/reasoning combinations, and add, remove, rename, or reorder
  1-8 buttons from the plugin settings page. Every button's icon comes from a
  browse-and-search picker over the plugin's curated MIT-licensed HugeIcons
  pool. The custom JSON remains available for CLI and advanced use. Changes
  need no code edit or reload.
- **A `alia preset-buttons` command** to inspect the active presets and switch
  sets from a terminal or an agent.

## What a preset can set

`providerId` and `model` are required. Any of these may be added:

| Field | Values |
|---|---|
| `reasoningLevel` | `none`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, `ultracode` |
| `serviceTier` | `default`, `fast` |
| `permissionMode` | `accept-edits`, `auto`, `full` |

Values are reconciled against the live provider catalogue when a button is
pressed: a model the provider no longer lists lands on that provider's default,
and the plugin says so rather than pretending it succeeded.

## How it works

The buttons are a plugin composer customization scoped to the New thread
composer. Applying a preset uses VesnALIA's own `experimental_setSelection`, so the
result is identical to the user picking the same values by hand — including
every reconciliation the pickers normally apply.

The strip sits right after the provider/model button, and right before the
Prompt Enhancer plugin's icon when that plugin is installed. It's pinned flush
right and never wraps, so it holds a stable position and a single row no
matter how long the provider/model label gets — the model button is the one
that truncates under pressure, not the strip.

## For agents

The bundled skill tells an agent to read the active presets with
`alia preset-buttons list` and switch sets with `alia preset-buttons use`.
