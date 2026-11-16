<p align="center">
  <h3 align="center">Nudge for <a href="https://getbb.app/">VesnALIA</a></h3>
  <p align="center">
    Replaces Send on an empty composer with Play, so the agent continues without a user message.
    <br><br>
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" />
    <a href="https://github.com/e-simpson/bb-plugin-nudge"><img src="https://img.shields.io/github/stars/e-simpson/bb-plugin-nudge" alt="GitHub stars"></a>
  </p>
</p>

<img src="./images/screenshot.png" alt="Empty VesnALIA composer with the Nudge play button where Send usually is" />

### Features
- ▶️ Play replaces Send while the composer draft is empty
- 🙈 Hidden continuation on idle threads — no `Continue.` bubble in the timeline
- 🔁 Failed turns retry by reference, like `alia thread retry`
- 🛑 Hidden while the agent is running, so Stop owns the row
- ⌨️ `alia nudge` from a terminal or agent shell

### Install via VesnALIA
1. Open VesnALIA
2. Plugins → search **Nudge** → Install

Or from a terminal:

```bash
alia plugin install git:https://github.com/e-simpson/bb-plugin-nudge.git@semver:^0.1.0
```

### Manual Installation
1. Clone this repository
2. `cd alia-plugin-nudge`
3. `npm install --include=dev`
4. `alia plugin install . --yes`

### Usage
Leave the composer empty and press Play. Typing brings Send back.

From a terminal, inside a VesnALIA thread:

```bash
alia nudge
```

Target another thread, or explain a retry:

```bash
alia nudge thr_abc123
alia nudge thr_abc123 --reason "transient provider overload" --json
```

`--message` is optional and visible. The default idle nudge stays hidden.

### What it does
- **Idle thread:** starts a turn with an agent-only continuation (no user bubble)
- **Errored thread:** retries the failed turn by reference (no new bubble)
- **Busy thread:** refused until the thread settles

No account, API key, or network access.

### License
MIT
