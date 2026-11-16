# alia-plugin-t3-import

A [VesnALIA](https://getbb.app) plugin that imports [T3 Code](https://t3.codes) threads into VesnALIA. Imported threads keep their
conversation, tool calls, and dates, and a follow-up message in VesnALIA continues the conversation with the agent's full
context, for both Claude Code and Codex threads.

```
alia t3-import preview                 # read-only: what would be imported
alia t3-import run --yes               # import it
alia t3-import status                  # what has been imported
```

## What it does

For each selected T3 thread, the plugin:

1. Finds or creates the VesnALIA project whose folder is the T3 project's workspace root.
2. For Claude Code threads, copies the Claude session transcript
   (`~/.claude/projects/<folder>/<session>.jsonl`, plus subagent transcripts) under a new session ID. VesnALIA resumes the
   copy, so continuing the thread in VesnALIA never changes what T3 Code resumes. `--session share` resumes T3's session
   itself instead. Codex threads always share the Codex thread, which Codex resumes by ID.
3. Converts T3's messages, reasoning, tool calls, plans, and compactions into VesnALIA thread events and writes them, with
   a project-checkout environment for the folder, to VesnALIA's database in one transaction per thread.

Nothing is written until `run --yes`. Each run backs up `alia.db` first (the last three backups are kept under
`<alia data dir>/plugins/t3-import/backups/`). A ledger in plugin storage records every imported thread, so running
the import again skips threads that are already in VesnALIA.

## Selecting threads

| Option | Effect |
| --- | --- |
| `--project <name or path>` | Only these T3 projects (title, folder name, or absolute path). Repeat or comma-separate. |
| `--thread <id>` | Only these T3 thread IDs. A selected thread is imported even when settled or archived. |
| `--include-settled` | Also import threads marked settled in T3, as open VesnALIA threads (left out by default). |
| `--archive-settled` | Also import settled threads, archived in VesnALIA at the time T3 settled them. |
| `--empty-projects` | Also create VesnALIA projects for selected T3 projects that have no thread to import. |
| `--exclude-archived` | Leave out threads archived in T3 (they are imported as archived by default). |
| `--limit <n>` | Import at most `n` threads; useful for a first test. |
| `--session copy\|share` | How Claude Code sessions are resumed (default `copy`). |
| `--json` | Machine-readable output. |

A thread is imported as history only, and its next message starts a new session, when T3 recorded no session or the
Claude transcript no longer exists. The preview lists these with a warning.

## Requirements and limits

- VesnALIA 0.45, and T3 Code, Claude Code, and VesnALIA on the same machine (the VesnALIA server's machine).
- The plugin writes VesnALIA's database directly, because VesnALIA has no API that creates a thread with existing history. It
  checks the tables and columns it writes before every run and refuses to run against a schema it does not know.
  `engines.alia` pins it to VesnALIA 0.45; check a new VesnALIA release with `scripts/check-events.mjs` before widening it.
- Images attached to T3 messages are noted by name in the message text; the image files are not copied.
- Threads appear after the VesnALIA app reloads its thread list.

Settings (`alia plugin config t3-import`): `t3DataDir` (default `~/.t3/userdata`) and `claudeHome` (default `~/.claude`).

## Development

```
npm install
npm run typecheck
npm test
alia plugin build
alia plugin install .
```

The tests build T3 and VesnALIA databases from `test/fixtures/*-schema.sql`, which are the table definitions of T3 Code and
VesnALIA 0.45. `scripts/check-events.mjs <alia.db>` parses imported events with the installed VesnALIA server's own event parser;
run it against a copy of `alia.db` after an import rehearsal or a VesnALIA update.

## Install

```
alia plugin install git:https://github.com/iipanda/bb-plugin-t3-import.git
```

## License

MIT
