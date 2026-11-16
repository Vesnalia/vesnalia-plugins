# Terminals (terminals)

Shells on any machine connected to VesnALIA, as tabs on one sidebar page — no project, thread or checkout
needed. Each terminal opens in that machine's home folder, as a new window in a terminal app does.

The **Terminals** page starts empty. **+** at the end of the tab strip opens a terminal: with one
machine connected it opens there straight away; with several, it lists them and you pick one. The
machine running the VesnALIA server is listed first.

- **Tabs** look and work like the tabs in VesnALIA's own panels. They are named after their machine,
  numbered in the order they were opened when a machine has more than one ("Mac mini 1",
  "Mac mini 2"). Close one with the **×** that shows on the tab under the pointer, a middle click, or
  its right-click menu, which also has **Close other tabs** and **Close tabs to the right**; closing a
  tab ends its shell. When the tabs do not fit, arrows at either end scroll them, as does the mouse
  wheel over the strip.
- **Drag a tab** to move it. The order is saved with the tabs, so every window shows it and it
  survives a reload. A tab keeps its number wherever it goes ("Mac mini 2" may sit before
  "Mac mini 1").
- **Rename a tab** by double-clicking its title, choosing **Rename** from its right-click menu, or
  pressing F2 on it, then type in place: Enter (or clicking elsewhere) saves, Escape keeps the old
  name, and an empty name brings back the default title. Names are saved with the tabs, so every
  window shows them and they survive a reload; a renamed tab's tooltip still names its machine, and
  `alia terminal list` shows the same title.
- **Leave the page and come back** and everything is where it was: every tab, the one you were on,
  and each terminal's scrollback at the line you had scrolled to. Whatever was running kept running,
  and kept printing, while you were elsewhere in VesnALIA.
- **Reload or reopen the app** and every tab reattaches to its shell, with the last half megabyte of
  its output replayed.
- **The same tabs everywhere.** The tab list belongs to your VesnALIA, not to a window: the desktop app and
  VesnALIA in a browser through getbb.app show the same tabs and type into the same shells. Which tab is
  shown is each window's own. A shell has one size: the window you are using (showing, resizing,
  returning to or typing in) sets it, and the others draw the shell at that size.
- **A machine that goes offline** marks its tabs "(offline)" and says so above the terminal; when it
  reconnects, the shell carries on where it was.
- **A shell that ends** (you typed `exit`, or its machine restarted) keeps its output on screen with
  the exit code and a **Close tab** button, also after a reload, for as long as its machine keeps that
  output (30 minutes). The next time the plugin loads, tabs whose shell has ended
  are dropped.

- **Select text** and an **Add to chat** button floats by the pointer, as in VesnALIA's own terminal. A
  tab belongs to no chat, so it asks which one: an open thread (searchable by title or project, the
  most recent first) or **New thread** in a project. The project starts on the one whose checkout or
  worktree holds the shell's current directory, when the shell reports it (many do, with the OSC 7
  sequence on each prompt), else on the one you picked last time in this browser, else on your most
  recent thread's. VesnALIA then opens that chat and the selection lands at the end of its message box as a
  fenced block headed with the tab and machine it came from. Nothing is sent: you read it over and
  send it yourself. Should the chat not open within 15 seconds, the block goes to the clipboard
  instead.
- **Copy on select** follows VesnALIA's own setting, Settings → General → Terminals → **Copy on select** (on unless
  you turned it off): finishing a selection copies it and shows "Selection copied", exactly as VesnALIA's
  terminal does. Turning it on or off in Settings counts at once. Only a selection you make with the
  mouse is copied, never one a program or new output makes.

The colours and font follow VesnALIA's theme, as VesnALIA's own terminal does.

## What you need

- VesnALIA 0.48 or later.
- At least one machine connected to VesnALIA. A terminal runs that machine's own shell (`$SHELL`, else zsh,
  bash or sh; PowerShell on Windows), as the user VesnALIA runs as there.

## Install

```bash
alia plugin install 'git:github.com/gpambrozio/bb-plugins@>=0.1.0' --plugin terminals --tag-prefix terminals/
```

From a clone, to try a branch before it is released:

```bash
cd terminals
npm ci && alia plugin build
alia plugin install "path:$PWD" --yes
```

The page is **Terminals** in the sidebar.

## How it works

Each tab is one of VesnALIA's own terminal sessions (the ones `alia terminal` manages), started in the chosen
machine's home folder. The shell runs under that machine's host daemon and VesnALIA buffers its output, so
it does not depend on the page, the window or the app being open. The plugin's server half only
remembers which sessions are tabs, in which order. The page draws each one with
[xterm.js](https://xtermjs.org), the terminal emulator VesnALIA's own terminal uses, and streams it over VesnALIA's
terminal connection — the one VesnALIA's terminal panel uses — on the page's own origin. No port is opened
and nothing new listens anywhere.

Nothing is stored but the list of tabs (machine, session id and the name you gave it). No output, keystroke or
credential is written to the plugin's storage or its log.

## What happens when

| Event | Shells | Tabs |
| --- | --- | --- |
| You switch to another VesnALIA page | keep running | kept, with scrollback and position |
| You reload or close and reopen the app | keep running | reattach, last 512 KB replayed |
| A machine goes offline | wait for it | marked offline, resume when it reconnects |
| The VesnALIA server restarts | VesnALIA reattaches each one whose machine's daemon kept running | kept; ended ones dropped |
| A machine's VesnALIA daemon restarts (reboot, VesnALIA quit there) | end | shown as ended, dropped at the next load |
| You close a tab | end | removed everywhere |
| The plugin is reloaded | keep running | kept; ended ones dropped |

Removing the plugin does not end its shells; close the tabs first, or end them with `alia terminal list
--machine <machine>` and `alia terminal close <id>`.

## Develop

```bash
npm install --include=dev
npm run typecheck
npm test
alia plugin build
```

See [AGENTS.md](AGENTS.md) for the invariants.
