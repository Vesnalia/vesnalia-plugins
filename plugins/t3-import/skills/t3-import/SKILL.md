---
name: t3-import
description: Import T3 Code threads into VesnALIA with `alia t3-import`; use when asked to bring T3 Code projects, threads, or conversations into VesnALIA.
---

# Import T3 Code threads

`alia t3-import` copies T3 Code threads into VesnALIA projects. Imported Claude Code and Codex threads resume their original
session on the next message.

1. Run `alia t3-import preview` (add `--project <name>` or `--thread <id>` to narrow it). It changes nothing.
2. Show the user the preview: the threads, their target VesnALIA projects, and any "history only" warnings. Settled T3
   threads are left out unless `--include-settled` is given.
3. Import only after the user approves: `alia t3-import run --yes` with the same selection options.
4. Report the imported VesnALIA thread IDs and the backup path from the output. `alia t3-import status` lists every import.

Options: `--project`, `--thread`, `--include-settled`, `--archive-settled` (import settled threads archived),
`--empty-projects` (also create VesnALIA projects for T3 projects with no thread to import), `--exclude-archived`, `--limit <n>`,
`--session copy|share` (default `copy`: VesnALIA resumes a copy of each Claude session and T3 stays untouched), `--json`.

The command runs on the VesnALIA server's machine and reads `~/.t3/userdata/state.sqlite` and `~/.claude` there. It writes
VesnALIA's database directly and supports VesnALIA 0.45 only. A rerun skips threads that are already imported.
