---
name: agent-reload
description: Restart a thread's agent session so it picks up MCP servers, settings, or instruction file changes made after the thread started.
---

# Reload an agent session

`bb agent-reload [thread-id]` marks a thread's agent session for restart. The
thread id defaults to the calling thread. Users can do the same with the reload
button in the thread header.

- The restart happens before the thread's next turn, not immediately. A thread
  reloading itself keeps its current session until the turn ends.
- The conversation is kept; only the agent process is rebuilt, so it rereads
  MCP servers, settings, instruction files, skills, and plugins.
- Supported: Claude Code, Pi, and ACP agents. Custom ACP agents must be listed
  in the plugin's `extraProviderIds` setting. Codex is not supported.
- Refusals exit 1 with code `unsupported_provider`, `thread_not_found`, or
  `thread_deleted`.
