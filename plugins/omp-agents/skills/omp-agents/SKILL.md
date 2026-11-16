---
name: omp-agents
description: Use when a task should be delegated to an OMP (oh-my-pi) subagent, when you need to know which OMP agents exist in a workspace, or when listing/inspecting OMP agent definitions with `alia omp-agents`.
---

# OMP agents

The OMP agents plugin surfaces the **OMP task agents** (oh-my-pi subagents) that
are visible to a workspace, so a VesnALIA thread can name one instead of guessing.

## In the composer

Type `@` in the composer and pick a row under **OMP agents**. The pill expands at
send time into agent-visible context naming the agent, its specialization, its
tools and model, its definition file, and the `task` call that delegates to it.
Nothing is injected into the user's visible message.

The menu appears **only on OMP-backed surfaces** — a thread whose provider is
omp, or the composer's default provider when it is omp. On a Claude, Codex, or Pi
thread it stays empty, because those providers cannot spawn an OMP subagent and
the mention would reach the model as unactionable text. Pi is a separate tool
from OMP, despite the similar name.

The New thread screen cannot be gated this way — the composer's mention request
carries no provider. A send from there is checked instead at `message.dispatch`:
carrying an OMP mention into a thread whose provider cannot spawn it is rejected
with an error naming the provider, so nothing reaches the model as a
half-followable instruction. The mention text also says outright that the
subagent is OMP-only and must not be imitated with another provider's `task`
tool.

The list is scoped to the surface: in a thread the project scope is that
thread's workspace; on the New thread screen it is the selected project's
default source. Matching is substring, subsequence, and token-based, so
`jns6`, `jns65`, and `jns 65` all find `jns65-agent`.

## From the shell

```
alia omp-agents list [--cwd <path>] [--json]
```

Prints `name`, `scope`, and description per agent, or the full records plus the
searched directories as JSON. Use it to confirm which agents exist before
delegating, and to find the definition file to read.

## Where agents come from

Discovery mirrors OMP's own precedence; a name defined at a higher scope shadows
the same name below it.

| Scope | Location |
| --- | --- |
| Project | nearest `.omp/agents/*.md` walking up from the workspace |
| User | `$PI_CODING_AGENT_DIR/agents`, then `~/.omp/agent/agents` (or the active `OMP_PROFILE`'s `profiles/<name>/agent/agents`) |
| Extra | absolute directories listed in the plugin's **Extra agent directories** setting |

Every file is read through VesnALIA's own file API on the machine running VesnALIA, so a
symlinked agent directory resolves to its real path. A definition whose
frontmatter lacks `name`/`description`, or whose name is not `[A-Za-z0-9_-]+`, is
skipped — the mention id is `provider:item`, so a colon could not round-trip.

OMP's bundled agents (`scout`, `reviewer`, `security-reviewer`, `task`, `sonic`)
are embedded in the omp package with no file on disk, so they never appear in the
list. They are always spawnable by name regardless; run `omp agents unpack` to
give them definitions on disk, which also makes them mentionable.

## Delegating

OMP loads these definitions, not VesnALIA. A VesnALIA thread on a non-OMP provider can still
read the definition file and follow its instructions, but only a thread running
under OMP can actually spawn the agent:

```
task({ agent: "<name>", task: "<the user's request>", solutionSpace: "<how open the problem is>" })
```

Batch independent items into one `tasks[]` call; keep real dependencies
sequential.

## Settings

- **Extra agent directories** — absolute paths, one per line, searched after the
  project and user scopes. Use this for a checkout that holds your agent
  definitions.
- **Mention results** — how many agents the `@` menu lists at once (default 40).
- **Providers that run OMP** — comma-separated provider ids whose threads get the
  `@` menu (default `acp-omp`). Add an id here if omp is registered as a custom
  ACP agent. An empty value is rejected when you save it; an id this server does
  not currently have is accepted and then reported on the OMP agents page, so a
  typo is visible instead of silently emptying the menu.
