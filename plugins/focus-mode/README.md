# Focus mode for BB

Read one conversation as plain text: your prompts as quiet quotes and the
agent's prose in a single narrow column. Tool calls, file edits, system notices,
the sidebar, split panes, and the composer are all hidden. Escape brings you
back to the layout and draft you left behind.

## Install

Requires BB 0.47.1 or later with Plugin SDK 0.6.79 or later in the 0.6 series.

```sh
bb plugin install git:https://github.com/Ayushlm10/bb-plugin-focus-mode.git@^0.2.0
```

## Use

- Click **Focus mode** in the thread header.
- The command palette also has **Focus mode: read current chat**.
- Press **Escape** or click **Exit focus** to return.

To add a shortcut, find **Focus mode: read current chat** in **Settings →
Keyboard** and assign a binding. No shortcut is bound by default, so the
plugin does not compete with other plugins' default shortcuts.

## Behavior and limits

- Only words are shown: your own messages and the assistant's prose, including
  its progress notes inside a turn. Commands, tool output, file changes,
  system notices, and messages from other agents are left out.
- The reader updates every two seconds while open and stays pinned to the
  newest message unless you scroll up. **Show earlier messages** loads older
  history. A small amber dot in the top bar pulses while the agent works.
- **Exit focus** appears when you hover the top bar or reach it with Tab.
- The selected conversation opens without a composer. In a split layout, the
  header button selects its own pane's thread; the keyboard command uses BB's
  focused thread.
- The original conversation remains mounted behind the overlay. The plugin
  does not change sidebar preferences, pane arrangement, or draft text.
- This is a separate transcript view, so its starting scroll position can
  differ from the original chat. It is not operating-system full screen.
- Focus mode does not pause an agent or change its permissions. Exit focus
  mode when you need the normal composer and execution controls.
- Leaving the conversation or unloading the plugin dismisses the overlay.
- Colours follow BB's active theme; text uses the system font at a larger
  reading size. No plugin settings or accounts are required.

The overlay and thread-header integration use experimental BB SDK surfaces.
BB can change those APIs; this release was built against BB 0.47.1 and Plugin
SDK 0.6.79. The current interactive check is on macOS; Windows and Linux have
not been interactively verified.

## Privacy and permissions

BB plugins are full-trust code. This plugin registers no backend endpoints,
agent tools, services, or storage. Its server entry is a no-op. It reads the
thread's timeline and status through the public SDK (`threads.timeline`,
`threads.get`) with your signed-in session and renders messages with BB's
`Markdown` component. It makes no writes. The plugin adds no
third-party service or chat-data export.

## Develop and verify

Use a Node.js version supported by BB's CLI (22.19+, 24, or 26).

```sh
npm install --include=dev --ignore-scripts --package-lock=false
npm run typecheck
npm test
npm run build
```

The SDK harness tests the command and UI wiring, selected thread, text-only
filtering, history paging, the working dot, focus trap, Escape/exit behavior, draft and caret preservation, route changes, and unload
cleanup. It fakes the SDK timeline; it does not prove BB's
live rendering, keyboard dispatcher, or streaming behavior.

`bb-app` is a development dependency so the build can run without a separate
global BB installation. Git-source installs build through the user's BB CLI
and do not need these development dependencies. Generated `dist/` files and
`node_modules/` are not committed.

## License

MIT.
