# alia-plugin-plugin-vault

Archive, label, annotate, and manage unwanted or rejected VesnALIA plugins.

Plugin Vault lets you keep a persistent record of plugins you decided not to use (or uninstalled because they were buggy, slow, conflicting, or redundant) along with your reasons and experience notes. It actively highlights flagged plugins with badges and reason callouts right inside the VesnALIA Plugin Manager so you never accidentally reinstall or forget why you removed them.

## Surfaces

- `server.ts` — backend: SQLite-backed KV storage for vault data, catalog alias resolver, RPC endpoints, and the `alia plugin-vault` CLI command.
- `app.tsx` — frontend:
  - Content script (`app.contentScripts`) that decorates every card on the VesnALIA Plugins page with its labels and description, plus an editor dialog to assign labels, write a description, and create new labels.
  - Label chips in the plugin detail header; "Labels & comment…" in its ⋯ menu opens the same editor.
- `skills/plugin-vault/SKILL.md` — agent skill so coding agents check your vault before recommending or installing plugins.
- `PLUGIN_OVERVIEW.md` — store listing long-form overview.

## Installation

```bash
alia plugin install https://github.com/mtkachenk0/bb-plugin-plugin-vault.git
```

Or from local checkout:

```bash
alia plugin install .
```

## CLI Usage

```bash
# List archived plugins
alia plugin-vault list

# Archive a plugin with label and reason
alia plugin-vault add t3sidebar --label rejected --label clashes --note "Clashed with alia-sidebar"

# Archive and automatically disable
alia plugin-vault add some-plugin --label buggy --note "Memory leak" --disable

# List labels
alia plugin-vault labels

# Clear labels and description
alia plugin-vault remove t3sidebar
```

## Development

```bash
npm install
alia plugin build
alia plugin reload plugin-vault
```
