---
name: focus-mode
description: "Explain the Focus mode plugin's text-only chat reader, shortcut, and exit behavior."
---

# Focus mode

Focus mode adds a header button and the palette command
`Focus mode: read current chat`. No keyboard shortcut is bound by default;
users can assign one in VesnALIA's Keyboard settings. Escape or Exit focus dismisses
the reader.

The reader shows only the user's own messages (as left-ruled quotes) and the
assistant's prose, in a narrow column. Tool calls, file changes, system
notices, and other agents' messages are hidden. It reads the thread through
`threads.timeline` and `threads.get`, refreshes every two seconds, and offers
Show earlier messages for older history. An amber dot in the top bar pulses
while the agent works; Exit focus appears on hover. It does not change layout
preferences or draft text. Active agents keep running.
Exit before using the ordinary composer or execution controls.

This plugin has no CLI command, RPC, agent tool, settings, backend service, or
plugin-owned storage. Do not invent programmatic controls for it. It requires
VesnALIA 0.47.1 and SDK 0.6.79 or compatible later 0.6 SDK versions. Its overlay
integration is experimental.
