# VesnALIA Agent Toolbox

Exposes VesnALIA SDK surfaces to agents as **provider-independent agent tools** via
`alia.agents.registerTool` + `alia.agents.contributeInstructions`. The tools are
injected into the sessions of **any** provider (opencode, Prime Agent's ACP
provider, etc.), so an agent can act inside VesnALIA: threads, interactions,
projects, workspace files, and terminals.

The transport between VesnALIA and a provider is untouched — this plugin only adds
VesnALIA surfaces as tools. Disable or remove it and agents return to stock
behaviour.

## Tools

- **Threads** (`aliatools_threads_list` / `aliatools_thread_get` / `aliatools_thread_outline` / `aliatools_thread_send` / `aliatools_thread_spawn` / `aliatools_thread_wait` / `aliatools_thread_interactions_list` / `aliatools_thread_interaction_respond` / `aliatools_thread_retry` / `aliatools_thread_stop` / `aliatools_thread_archive` / `aliatools_thread_clear_context` / `aliatools_thread_compact` / `aliatools_thread_search`)
  — inspect, message, create, wait for, retry, stop, archive, and read VesnALIA
  threads to coordinate, delegate, or hand off work between agents.
  `aliatools_thread_send` accepts a future `sendAt` to schedule the message.
  `aliatools_thread_get` and `aliatools_thread_interactions_list` surface what a
  thread waits for: permission approvals, user questions, plugin prompts.
- **Projects & workspace** (`aliatools_projects_list` / `aliatools_workspace_list` / `aliatools_workspace_read` / `aliatools_workspace_write` / `aliatools_workspace_mkdir`)
  — orient across projects and read/write workspace files (confined to the
  thread's workspace root).
- **Terminals** (`aliatools_terminals_list` / `aliatools_terminal_create` / `aliatools_terminal_output` / `aliatools_terminal_input` / `aliatools_terminal_close`)
  — create, watch (read output), drive (type commands), and close VesnALIA terminal
  sessions the user can watch live in the VesnALIA UI.

> Shared memory is intentionally **not** included: the built-in Memory plugin
> already provides durable `alia_memory_*` agent tools (plus a CLI and UI). This
> toolbox stays focused on what is otherwise missing.

## Settings

Each tool group can be toggled with `alia plugin config alia-agent-toolbox`:

- `enableThreads` (default `true`)
- `enableWorkspace` (default `true`)
- `enableTerminals` (default `true`)
- `enableInteractionRespond` (default `false`) — answering another thread's
  pending interactions lets an agent approve or deny another agent's
  permission requests, so it is off by default

Toggles apply to new tool calls without reloading the plugin.

## CLI

```bash
alia alia-agent-toolbox status   # tool groups + enabled state (+ --json)
```

## Design notes

- Names use a `aliatools_` prefix to avoid colliding with other plugins' agent
  tools (e.g. the built-in Memory plugin's `alia_memory_*`).
- Workspace tools resolve the current thread's host and workspace root at
  call time and pass `rootPath` to confine reads/writes to the project.
- Agent-tool output is truncated to a bounded length before it reaches the
  model context.
- Errors are caught and returned as text so the agent sees them instead of the
  call failing.

## Development

```bash
npm install
npm test              # smoke test against the SDK fake host
alia plugin build .
alia plugin install . --yes
```
