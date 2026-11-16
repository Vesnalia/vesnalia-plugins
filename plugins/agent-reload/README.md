# Agent Reload

A [VesnALIA](https://getbb.app) plugin that restarts one thread's agent session
without restarting VesnALIA and without losing the conversation.

An agent reads its MCP servers, settings, instruction files, skills, and
plugins when its session starts. Connect an MCP server or edit your config
after that, and a running thread never sees the change. Agent Reload rebuilds
that thread's agent process before its next message, and the conversation
continues where it left off.

## Usage

**In the app:** click the reload button (↻) in the thread header. A toast
confirms the reload, and the agent restarts when you send the next message.
The button only appears on threads whose agent can be reloaded.

**From a shell or an agent:**

```sh
alia agent-reload              # the thread the command runs in
alia agent-reload thr_abc123   # any other thread
```

Agents in other threads learn the command from the bundled `agent-reload`
skill, so an agent can reload itself after you ask it to add an MCP server. The
restart then happens once its current turn ends.

## Supported agents

| Agent | Supported |
| --- | --- |
| Claude Code | Yes |
| Pi | Yes |
| ACP agents: OpenCode, OMP, Grok, Hermes, Cursor | Yes |
| Custom ACP agents | Yes, after adding them to the setting below |
| Codex | No |

Add custom ACP agents by provider ID, comma-separated. The change applies
immediately:

```sh
alia plugin config agent-reload set extraProviderIds acp-my-agent
```

Codex is not supported because VesnALIA's Codex bridge does not rebuild a session
when the thread's environment changes.

## How it works

VesnALIA rebuilds a thread's agent session, resuming the same conversation, when the
environment it passes to that agent changes. Agent Reload contributes one
per-thread variable, `AGENT_RELOAD_NONCE`, through the plugin SDK's provider
environment API. A reload stores a new value for that thread, so the next turn
sees a changed environment and VesnALIA rebuilds the session.

Threads you never reload get no variable and are unaffected. The plugin stores
one timestamp per reloaded thread and deletes it when the thread is deleted. It
makes no network requests.

## Install

From the VesnALIA plugin store, or from a checkout:

```sh
npm install
alia plugin install .
```

## Development

```sh
npm install
npx tsc -p .
alia plugin build
alia plugin dev      # rebuild and reload on save
```

Requires VesnALIA 0.46 or later.

## License

MIT
