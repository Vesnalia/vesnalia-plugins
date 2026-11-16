## What you get

OpenCode v2 appears in VesnALIA's provider picker next to your other providers. Start
a thread, choose any model OpenCode has connected, and VesnALIA drives the session
through OpenCode while keeping its usual interface: timeline rows for reads,
searches, commands with live output, and file changes built from OpenCode's own
patches.

- **Threads behave like any VesnALIA thread.** Fork at a checkpoint, rewind and edit
  (files are restored), steer a running turn, stop, rename, and `/compact`.
- **Permission modes carry over.** Accept edits, auto, and full map to
  OpenCode permission rules. A denial goes back to the agent as feedback and the
  turn continues.
- **Pick OpenCode's primary agent** (`build`, `plan`, or your own) in the Agent
  row of VesnALIA's model switcher, and OpenCode's questions use VesnALIA's native question
  UI.
- **VesnALIA's tools and skills work inside OpenCode.** VesnALIA dynamic tools are exposed
  through a local MCP server, VesnALIA's `/` menu lists the skills OpenCode finds for
  the workspace, and shells get the `alia` CLI on `PATH`.
- **Model control.** Reasoning levels map to each model's variants, and the
  settings page can allow or block individual models.

## Requirements

- OpenCode v2 2.0.26 or newer, with `opencode2` on the host's `PATH`. VesnALIA can
  install and update it from the provider settings.
- At least one model provider connected in OpenCode (`opencode2 auth login`).
  OpenCode owns model credentials; VesnALIA never stores them.

## Good to know

- Native OpenCode subagents are off by default, so agents delegate through VesnALIA.
  Turn them on in the plugin settings and they appear as nested delegation rows.
- By default the plugin adds one deny rule to your global OpenCode config so
  VesnALIA threads' tools do not show up in OpenCode's own sessions. You can turn this
  off in settings, which restores the file.
- Not supported, because OpenCode has no API for it: archive, goals, service
  tiers, and the usage dashboard.
