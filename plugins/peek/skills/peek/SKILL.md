---
name: peek
description: Inspect what a VesnALIA plugin would change before installing it. Use when the user asks whether to install a plugin, what a plugin does, what UI or settings it adds, or asks to compare plugins in the store.
---

# Peek

Peek reports a store plugin's impact without installing it: which parts of the
VesnALIA interface it would change, which settings it would add, and which
capabilities it would take. It resolves the entry to its exact release, reads
that release's files as text, and never installs, enables, or executes plugin
code.

## Commands

```sh
alia peek list [--json]                  # store entries you can preview
alia peek show <entry> [--json] [--refresh]   # the impact report for one entry
alia peek show <entry> --marketplace <name>
```

Use `--json` when you need to compare several plugins or extract one field;
the JSON is the same report the UI renders.

## Reading a report

Every fact carries a confidence:

- `declared` — read from the plugin's own `package.json` manifest. Trust it.
- `detected` — found by scanning the plugin's entry sources or built bundle for
  SDK call sites. Strong signal, but a plugin can register a surface in a way
  the scan misses. Never present a detected fact as exhaustive.

The `Notes` section lists what the analysis could not determine. Repeat those
limits to the user instead of implying full coverage.

Items marked wide access — a full-trust host daemon, a content script, a
provider or machine registration, running commands, reading the filesystem —
are worth naming explicitly when the user is deciding whether to install.

## Limits

- Git-hosted plugins are only readable when they live on GitHub.
- A GitHub token in Peek's settings is optional. It only affects the fallback
  used when a repository archive is unavailable or larger than 24 MB.
- Reports are cached per resolved release; pass `--refresh` to re-read one.
- A report is never abandoned because a request failed. What could not be read
  appears in `Notes`, so treat an empty section as "not found" only when the
  notes are empty too.
