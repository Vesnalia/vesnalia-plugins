---
name: auto-answer
description: How VesnALIA's Auto Answer plugin applies an agent question's answer after a countdown, and how to read or change its settings.
---

# Auto Answer

When an agent asks the user a question, VesnALIA replaces the thread composer with a
question widget: one tab per question, option buttons, and a
"Next" / "Submit answer" button.

Auto Answer watches that widget in the app window. As soon as an option's
selected state changes — by mouse or by keyboard shortcut — it starts a
countdown directly under the option that was picked, and moves it along if you
pick another one. When the countdown ends it presses the widget's own
primary button, so the answer is applied and the next tab opens, or, on the last
tab, the whole answer is submitted. Picking another option, or the same option
again, restarts the countdown from the top.

The block leads with a **Stop** button — within reach of the option you just
clicked, rather than at the bottom of a long list — followed by the remaining
seconds and a progress bar that sweeps at the display's refresh rate. The button
carries its shortcut: **space** stops the countdown, and so does `Escape`. Space
is claimed only while a countdown is running, and never while the caret is in a
text field. Stop cancels the countdown that is running and nothing more —
picking an option afterwards, the same one or another, starts a fresh
countdown.

The countdown also cancels itself whenever applying the answer would no longer
be right:

- the last option of a multi-select was un-ticked, so nothing is selected;
- "Other…" was chosen and the free-text box is open (Auto Answer never submits
  text on the user's behalf);
- the user pressed Back, Cancel, a question tab, or the primary button;
- the widget was submitted or dismissed some other way.

## Settings

Editable in Settings → Auto Answer, or with `alia plugin config auto-answer`:

- `enabled` (boolean, default `true`) — turn the countdown off entirely.
- `delaySeconds` (number, default `4`, range 1–120) — how long to wait after the
  last option the user picked.

## Command

```
alia auto-answer status [--json]
```

Prints the effective settings. There is nothing to start or stop from the CLI;
the countdown only exists while a question widget is on screen.

## Constraints

Auto Answer only ever presses the button the user would have pressed. It never
chooses an option, never types free text, and never resolves a permission
prompt or any other kind of pending interaction.
