# OMP agents

Name an OMP (oh-my-pi) subagent in a VesnALIA thread instead of describing it.

![The OMP agents page listing each subagent by scope](screenshots/omp-agents/agents-page.png)

![Typing @ in the composer and picking an OMP agent](screenshots/omp-agents/mention-menu.png)

## What you get

- **`@` mentions.** Type `@` in the composer and pick a row under **OMP
  agents**. The pill resolves at send time into agent-visible context that
  names the subagent, its specialization, its tools and model, and the `task`
  call that delegates to it. The user's own message stays unchanged.
- **An OMP agents page** in the sidebar, listing every agent the current
  thread or project can see, grouped by scope with tools, model, and definition
  path.
- **`alia omp-agents list`** for the same list from a shell or an agent.

## Where agents come from

Discovery follows OMP's own precedence — a name defined higher up shadows the
same name below it:

| Scope | Location |
| --- | --- |
| Project | nearest `.omp/agents/*.md`, walking up from the workspace |
| User | `$PI_CODING_AGENT_DIR/agents`, then `~/.omp/agent/agents` (or the active `OMP_PROFILE`'s directory) |
| Extra | absolute directories configured in the plugin's settings |

Reads go through VesnALIA's own file API on the machine running VesnALIA, so symlinked agent
directories (the usual `~/.omp/agent/agents -> ../agents` layout) resolve to
their real path. A definition without `name`/`description`, or with a name
outside `[A-Za-z0-9_-]+`, is skipped.

OMP's own bundled agents (`scout`, `reviewer`, `security-reviewer`, `task`,
`sonic`) are embedded in the omp package and have no file on disk, so they are
not listed. Run `omp agents unpack` to materialize them into
`~/.omp/agent/agents`, which is a user-scope root this plugin already reads.

## Only OMP surfaces offer the mentions

These subagents are spawned by the `task` tool inside OMP, so the `@` menu is
offered only where that is true. On a Claude, Codex, or Pi thread the composer
shows no OMP rows, and the OMP agents page says which provider the surface uses
instead.

The gate reads the provider the surface would run on — a thread's own provider,
or your configured default provider on a surface with no thread yet. Pi is a
different tool from OMP (its own `pi` binary and `.pi/agent` roots), so it is
excluded. If you register omp under another ACP id, add it to **Providers that
run OMP**.

The New thread screen is the one place the menu cannot be gated: the composer's
mention request carries no provider, so the plugin has no way to know which
provider the picker shows. A send is caught instead, at the `message.dispatch`
checkpoint — a message carrying an OMP mention into a thread whose provider
cannot spawn it is **rejected** with a message naming the provider, rather than
delivered as an instruction the model cannot follow. Sending a user's explicit
Send-now on a queued row bypasses that checkpoint by design, so the mention text
itself also states that the subagent is OMP-only and must not be faked.

## Settings

- **Extra agent directories** — absolute paths on the VesnALIA machine, one per line,
  searched after the project and user scopes.
- **Mention results** — how many agents the `@` menu lists at once (default 40).
- **Providers that run OMP** — comma-separated provider ids whose threads get the
  `@` menu (default `acp-omp`). A value naming no provider id at all is rejected
  when you save it. A value naming a provider this server does not currently
  have is accepted — the OMP agents page then says so and lists the ids that
  exist, so a typo cannot silently empty the menu without explanation.

## Tests

`npm test` runs the plugin's vitest suite: the dispatch guard's decisions
(refuse an OMP mention on a provider that cannot spawn it, leave every other
send alone) and what the OMP agents page tells the user in each provider state.

## Delegating

OMP loads these definitions, not VesnALIA. A thread on a non-OMP provider can read a
definition file and follow it, but only an OMP-backed thread can spawn the agent:

```
task({ agent: "<name>", task: "<request>", solutionSpace: "<how open the problem is>" })
```

See `skills/omp-agents/SKILL.md` for the agent-facing contract.
