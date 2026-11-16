# Musing: Is a CLI command useful here?

*2026-09-25 · split from the combined done/CLI/trackers musing · origin: a feature comparison against Deck, Autobahn, Agent Board, Taskboard, and Backlog.MD*

## The verdict, and why it changed

Probably not — at first. The pattern elsewhere (Deck, Taskboard, Autobahn)
exposes a CLI because the plugin has state to read or mutate that
agents/automation need: Taskboard's `alia taskboard move` operates on external
trackers; Deck's tools write notes and tags agents consume.

Thread Board is a **view over VesnALIA's threads**, and VesnALIA's own CLI already covers
everything meaningful: `alia thread list/show/pin/archive/tell`. A
`alia thread-board` command would be a thin re-spelling of `alia thread`, with
one extra hop and nothing of its own.

Then plugin-owned state entered the direction (Done + sweep), and the verdict
updated: a small `alia thread-board` surface (`done list`, `sweep`, `config`)
comes back into scope with it — same rule as `alia thread-list` and
`alia branch-janitor`: **the CLI exists to manage plugin-owned state, not to
re-spell VesnALIA thread commands.**

## Standing rule

- No CLI for read actions over alia-native state; `alia thread` already covers
  those.
- If Done lands as a thread-tag rather than a plugin table (see the Done
  state musing), part of the rationale shrinks: `alia thread-tags threads
  done` already answers the sweep's query, and `done list` would duplicate
  it. What would remain ours: `sweep` (needs the archived-threshold logic
  and the override valve) and `config` (thresholds, defaults). The CLI
  surface should be sized after the Done-as-tag decision, not before.
- Caveat for `sweep` as a CLI command: the board's arm-then-confirm
  interaction is deliberate operator friction. A CLI sweep that skips the
  arm step should say what it will archive and require an explicit
  confirmation flag, not just run.

## Open question

Does the sweep CLI target the same explicit-list semantics as the board
(freeze a list, confirm, fire), or is a CLI sweep inherently one-shot
("archive everything currently eligible")? The board's freeze exists to
prevent mid-arm surprises; a CLI invocation has no arm phase to freeze, so
its confirmation surface needs its own answer.