---
name: terminal-toggle
description: Explain or troubleshoot Terminal Toggle commands, keyboard binding, and private-host compatibility.
---

Read the plugin's README for behavior and its tested alia/SDK versions and runtime compatibility checks.

The frontend command is `plugin:terminal-toggle/toggle`; its palette title is
`Toggle terminal`. It hides the secondary panel only from actual terminal
input focus and otherwise returns to the last focused terminal of the thread.
The plugin has no shell-execution CLI or backend API.

Inspect effective bindings with `alia settings keyboard list`. Use VesnALIA's keyboard
settings to rebind the command. A configured binding alone does not prove that
it works inside xterm; verify terminal and composer focus in the real client.

Identity depends on private React/alia metadata. If host resolution fails after
an update, review the adapter against the installed release rather than
substituting selected-tab history. Disabling the plugin preserves native shells.

For compatibility notifications, retain the `TT_*` code and the running VesnALIA
version when diagnosing. The app version is unrestricted; missing host
capabilities stop the attempt. The exact SDK dev dependency is for reproducible
builds, while its runtime engine is a range. Structural checks do not prove
unchanged semantics in a future host; rerun live focus checks after updates.
