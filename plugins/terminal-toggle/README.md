# Terminal Toggle

Toggle the last focused native VesnALIA terminal with **Ctrl+backtick**. Press again while terminal input has focus to hide the whole right panel and return to the primary composer.

Terminal Toggle uses VesnALIA's ordinary terminal tabs and shell processes. It adds one command, **Terminal Toggle → Toggle terminal**, to the quick palette and Settings → Keyboard.

## Behavior

| Current state                                                             | Action                                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Input focus is in any native terminal                                     | Hide the whole secondary panel and focus this chat pane's primary composer.             |
| Focus is elsewhere, including the composer, a file, or terminal search    | Reveal and focus this thread's last focused terminal.                                   |
| Remembered terminal is closed, inaccessible in this chat pane, or unknown | Select the first terminal in VesnALIA's current panel-tab order.                              |
| No terminal tabs exist                                                    | Create one ordinary shell in this thread's environment, reveal it, and focus its input. |
| Creation or opening is still pending                                      | Ignore additional invocations; no queued toggles or duplicate shells.                   |
| Modal, embedded-browser input, or unsupported context                     | Leave the interface alone.                                                              |

Mouse clicks, native commands, and programmatic terminal focus all update the remembered terminal. Selecting a terminal tab while typing in the composer does **not** count as terminal input focus. History is in memory per thread and client window; plugin reload, disable, or app restart clears it.

The command stays in the active chat pane. A remembered terminal in another pane is used only if it is available in the current pane's tab list. Secondary panel splits use VesnALIA's flat panel-tab order for fallback, rather than a separate DOM-derived order.

Hiding preserves tabs, shell processes, output, and working directories. File/diff tabs remain open; the plugin does not restore a previously selected file. A completed terminal session follows VesnALIA's normal behavior; the plugin does not silently restart it.

## Install locally

With VesnALIA installed and its `alia` command on PATH:

```sh
npm ci --include=dev
npm run build
alia plugin install . --yes
```

The plugin is registered in place. Use `alia plugin dev .` while editing, or build and run `alia plugin reload terminal-toggle` after changes.

To disable or remove it:

```sh
alia plugin disable terminal-toggle
alia plugin remove terminal-toggle
```

Neither action closes existing native terminals. Removal of a local path installation leaves the project files in place.

## Keyboard

The default uses physical **Control**, including on macOS, and the physical **Backquote** key left of `1`. Command is not substituted for Control. Ctrl+Shift+backtick is a different chord.

Change the binding in **Settings → Keyboard → Terminal Toggle → Toggle terminal**. The plugin reads VesnALIA's effective binding and dispatches the same registered command before xterm can consume its chord. A conflicting or disabled default stays unbound; existing user overrides are retained. The physical Backquote adjustment applies only while the effective binding is the default Ctrl+backtick. Other bindings use VesnALIA's matcher.

For example:

```sh
alia settings keyboard set 'plugin:terminal-toggle/toggle' 'Ctrl+Shift+Y'
alia settings keyboard reset 'plugin:terminal-toggle/toggle'
```

## Compatibility and limitations

This experimental implementation has been tested with **VesnALIA 0.48.1 / Plugin SDK 0.6.104**. It does not restrict the VesnALIA application version; the Plugin SDK engine accepts `>=0.6.104 <1`. The SDK dev dependency remains exact to reproduce builds. It depends on private React Fiber and VesnALIA component metadata to identify actual terminal focus and the correct chat surface. It reads IDs and whitelisted structural fields; it does not read terminal output, input values, composer drafts, or React state. It does not patch VesnALIA bundles or install a terminal emulator. Host structure mismatches cause the command to decline or report an error rather than guess a terminal.

An update to VesnALIA may require revising this adapter. Runtime capability checks replace an application-version allowlist. Missing or malformed private contracts stop the attempt and show a diagnostic notification. The command remains reachable in editable thread contexts even if private discovery fails. The audited VesnALIA source revision is `e003e9510cbfd3bb6c26a28630b46ffb1c242a44`.

Open threads with a mounted primary composer are implemented. New thread, Settings, and Marketplace do not expose this command. A thread without a resolvable primary composer reports an explanatory error when invoked. Composer focus uses VesnALIA's host focus operation; caret/selection restoration is not guaranteed. Drafts, attachments and mentions are never rewritten.

Creation uses the native SDK. If the user changes chat surface before creation completes, the shell is retained in its original thread without opening it in the new surface. Host creation failures and an eight-second terminal-focus timeout show a notification; no fallback shell is started elsewhere.

Real VesnALIA frontend/native-shell checks passed through local browser automation on the installed host. Native macOS desktop keyboard delivery and an actual OS Russian-layout switch remain unverified. See [verification details](docs/verification.md) for the exact evidence and remaining checks.

### Compatibility errors

Notifications identify the failed capability: `TT_REACT` (committed React tree), `TT_COMMANDS` (keyboard dispatcher), `TT_SURFACE` (chat pane/composer), `TT_FOCUS` (terminal input ownership), `TT_TABS` / `TT_PANEL` (panel contracts), `TT_SHORTCUT` (bindings), `TT_SESSION` (native terminal response), or `TT_SDK` (required SDK methods). `TT_OPERATION` contains an unexpected host failure without dumping host objects or user data.

On detection, the plugin stops the attempt and invalidates uncertain focus history/pending work. It never guesses terminal identity, starts a fallback shell in another context, or closes existing shells. Automatic duplicate diagnostics are suppressed per frontend generation; explicitly invoking the command shows the error again. Updates that preserve object shapes but change their meaning cannot be ruled out by structural checks alone; live regression checks are still required after significant VesnALIA changes.

## Develop

```sh
npm ci --include=dev
npm run typecheck
npm test
npm run build
npm pack
```

The build emits `dist/app.js`, `dist/app.css`, `dist/server.js`, and SDK metadata. These generated artifacts are included in the package. The server entry has no services, settings, storage, or network handlers. React, the SDK, and the host toaster are supplied by VesnALIA.

The tests cover decision branches, creation races, command suppression/rebinding, and identity resolution against a real React tree, including committed-branch changes with reused DOM nodes. They complement the native-shell checks; they do not prove desktop focus behavior.

Local research notes under `docs/research/` and scratch evidence are excluded from git and package contents.

## License

MIT. See [LICENSE](LICENSE).
