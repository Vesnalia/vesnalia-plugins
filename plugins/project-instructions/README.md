# Project Instructions

Give every VesnALIA project its own standing instructions, and have VesnALIA add them to
the system prompt of each thread in that project.

VesnALIA ships a built-in custom-instructions plugin, but it is global: one block of
text for every project you have. This plugin makes the text per project.

## Why you might want it

Some facts are true of one project and no other, and you end up retyping them
into every new thread:

- A monorepo where only one subdirectory is yours, so paths and commands are
  relative to that subdirectory.
- A repository with a house style, a preferred package manager, or a test
  command that is not obvious from the tree.
- A codebase where some directories are off limits.

The obvious fix is a committed `AGENTS.md`, and you should prefer that when you
can. This plugin is for when you cannot: a repository you do not own, a shared
repository where VesnALIA config is unwelcome, or a rule that is yours rather than
your team's. Nothing is written to your working tree.

## Install

```
alia plugin install <source>
```

Then open Settings, find Project Instructions, pick a project, and type.

## Use it from the app

Settings has a Project Instructions section. It lists your projects, marks the
ones that already have instructions with a dot, and gives you an editor.

Saving is explicit. Instructions change how agents behave, so a stray keystroke
should not ship. Unsaved text survives switching to another project and back,
and any project holding unsaved text is marked in the picker.

Emptying the editor and saving removes the instructions for that project.

## Use it from the CLI

```
alia project-instructions get [--project <id>]
alia project-instructions set <text...> [--project <id>]
alia project-instructions clear [--project <id>]
alia project-instructions list
```

`--project` defaults to the project of the calling thread, so an agent working
inside a project can read its own instructions with no arguments.

Both surfaces write through the same code path, so they cannot drift. A CLI
write refreshes any open settings page.

## What to know before you rely on it

**Side chats do not get these instructions.** VesnALIA never gives plugin
instructions to a side chat. Only ordinary threads receive them. If a rule has
to hold in a side chat too, it belongs in a committed `AGENTS.md`.

**A change applies when a thread next starts a provider session.** Editing the
text does not reach into a conversation that is already running.

**The limit is 4096 characters.** VesnALIA truncates a longer contribution without
saying so, so this plugin refuses the write instead. The editor shows a live
count and blocks Save past the limit; the CLI exits non-zero.

**Storage lives in VesnALIA, not in your repository.** The text is held in VesnALIA's
per-plugin key-value storage, keyed by project id. It is not encrypted, so keep
secrets out of it.

## Develop

```
npm install
alia plugin build
alia plugin reload project-instructions
```

`npx tsc --noEmit` type checks the plugin.

`server.ts` is the backend: storage, the instruction contribution, the RPC
contract, and the CLI command. `app.tsx` is the settings section. The
`components/`, `lib/`, and `hooks/` directories are vendored from VesnALIA's own
shadcn registry and are yours to edit.

One detail worth knowing before you change `server.ts`: VesnALIA calls
`contributeInstructions` synchronously on the thread-start path, but key-value
storage is asynchronous. So the stored rows are mirrored into a `Map` at load,
and every write updates storage and mirror together, one write at a time.

## License

MIT
