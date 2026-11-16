# Arc Switcher for VesnALIA

An Arc-style keyboard switcher for the seven most recently opened VesnALIA chats.
Each chat gets a stable emoji marker, so it remains recognizable as the MRU
order changes without requiring you to read every title.

The same emoji also appears next to each thread's title in the sidebar and in
the chat header, so a conversation is recognizable by its marker everywhere —
not just inside the switcher.

When the project-emoji plugin is installed, each switcher row also shows the
thread's project emoji and name in its detail line, and newly assigned thread
markers skip emojis currently used by projects (already-stored markers are
kept). Without that plugin everything degrades to the old behavior.

## Use

Hold **Command**, tap **D** to cycle, and release **Command** to open the
selected chat. Press **Escape** to cancel. You can also click any visible item.
The small number on each emoji badge is a direct **1–7** shortcut.

The switcher intentionally replaces the browser's bookmark shortcut while VesnALIA
is focused.

## Install

```sh
npm install
alia plugin build
alia plugin install .
```
