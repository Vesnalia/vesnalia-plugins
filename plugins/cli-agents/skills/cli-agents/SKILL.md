---
name: cli-agents
description: Discover native session agents for supported Claude Code, Codex profiles and OpenCode VesnALIA providers, or inspect a chat's selected agent.
---

Use `alia cli-agents list PROVIDER HOST_ID PROJECT_ID` to list native session roles on the selected machine. Supported provider IDs are `claude-code` and `acp-opencode`.

Use `alia cli-agents thread THREAD_ID` to inspect an existing chat's agent binding. A null answer means the plugin did not select an agent for that chat.

When explicitly asked to start a chat under an agent, `alia cli-agents select PROVIDER HOST_ID PROJECT_ID AGENT_ID` returns a marker to include in the new thread's initial prompt. Use the same project, host, provider and checkout in `alia thread spawn`. Select does not start a chat or alter existing conversations. Respect the user's authorization for any new agent session.

The graphical Agent picker carries this selection as a mention. Do not replace native selection with an instruction to pretend to be the agent. Do not edit global CLI settings to switch one chat's role. Unsupported providers must remain unsupported until an adapter is implemented and verified.

Codex profiles apply only developer_instructions (maximum 4096 characters) through VesnALIA. They do not activate the entire native config; VesnALIA keeps model and permission controls. Profile files are CODEX_HOME/NAME.config.toml.
