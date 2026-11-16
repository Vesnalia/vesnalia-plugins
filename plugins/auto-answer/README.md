# Auto Answer

A BB plugin that stops you clicking **Next, Next, Next** through an agent's
questions.

When an agent asks for a decision, BB shows a question widget in place of the
composer — one tab per question, a list of options, and a "Next" / "Submit
answer" button. Auto Answer starts a countdown the moment you pick an option and
then presses that button for you: the next tab opens, and on the last tab the
answer is submitted. One question? Then picking the option *is* the whole
answer.

- Picking another option, or the same option again, restarts the countdown.
- The block appears directly under the option you picked, **Stop** first, so
  cancelling never means crossing the screen — or reaching for the mouse at all:
  **space** stops it (as does `Escape`), and the button says so. Space is
  claimed only while a countdown runs, never while you are typing in a field.
  It is a pause, not a switch: the next option you pick starts a fresh
  countdown.
- The countdown cancels itself if applying the answer would be wrong — nothing
  selected, "Other…" open with its free-text box, or you pressed Back / Cancel /
  a tab / the button yourself.

Default delay is **4 seconds**, configurable in Settings → Auto Answer or with
`bb plugin config auto-answer`.

## Install

```sh
npm install --include=dev
bb plugin install .
```

## Settings

| Setting        | Type    | Default | Meaning                                      |
| -------------- | ------- | ------- | -------------------------------------------- |
| `enabled`      | boolean | `true`  | Turn the countdown off entirely.              |
| `delaySeconds` | number  | `4`     | Seconds to wait after the last option picked. |

## Command

```sh
bb auto-answer status [--json]
```

## How it works

`app.tsx` registers one `experimental_appOverlay`. It observes `aria-pressed`
changes on the widget's option buttons (which covers mouse and keyboard
selection alike), portals the timer into a container it moves in beneath the selected option, and
on expiry clicks the widget's own primary button. Expiry is driven by a timer so
the delay stays wall-clock even in a hidden window, while the bar is painted
from an animation-frame loop straight onto the node — so it sweeps smoothly
without re-rendering React sixty times a second. BB keeps ownership of the
question state throughout — a fired countdown is exactly the click you would
have made.

Because it drives BB's rendered widget rather than a public slot API, it reads
the widget structure: option buttons are the `aria-pressed` buttons inside the
options `fieldset`, and the primary button is the "Next" / "Submit answer"
button outside it. Both are re-checked on every tick, and the countdown simply
disappears if it stops finding them — so a BB release that reshapes the widget
degrades to today's manual clicking rather than misfiring.
