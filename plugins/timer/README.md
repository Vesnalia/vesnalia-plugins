# alia-plugin-timer — Floating Timer for VesnALIA IDE

Run floating focus timers, custom sprints, and pomodoro blocks anywhere in VesnALIA.

## Capabilities

- **App-wide Overlay (`slots.experimental_appOverlay`)**: Floating overlay accessible across all VesnALIA windows, projects, and threads.
- **Two Display Modes**:
  - **Compact Pill**: Subtle floating pill displaying active countdown (e.g. `⏱️ Review 24:12`) and pulsing alert on completion.
  - **Expanded Card**: Full management window with large digital timers, progress bars, +1m/+5m quick-adjust buttons, pause, reset, and delete.
- **Drag & Drop**: Freely reposition both the pill and the expanded window. Position is persisted in `localStorage`.
- **Parallel Multi-Timers**: Run multiple independent timers at once with custom labels.
- **Quick Presets**: Instant start presets for `1m`, `5m`, `10m`, `15m`, `25m` (pomodoro), `45m`, and `60m`, plus custom duration input.
- **Audio Chime (Web Audio API)**: Self-contained harmonic chime on timer completion with instant mute toggle.
- **Thread Header Action (`slots.experimental_threadHeaderAction`)**: Live timer display in thread header for 1-click toggling.
- **Sidebar Nav Panel (`slots.navPanel`)**: Full-page dashboard at `/plugins/timer/timers`.
- **CLI & Agent Skill (`alia timer`)**: Complete CLI tool and skill for agents and terminals.

## CLI Usage

```bash
# List all timers
alia timer list

# Start a 25-minute timer with a label
alia timer add 25 "Pomodoro: PR review"

# Start a 5-minute break
alia timer add 5 "Tea break"

# Pause / Resume
alia timer pause <id>
alia timer start <id>

# Reset to initial duration
alia timer reset <id>

# Delete timer
alia timer remove <id>

# Clear completed
alia timer clear
```

## Architecture & Code Quality

- `src/domain/timer.ts`: Pure deterministic time calculation (`targetEndAt`), progress math, and formatting. Immune to background tab throttling or system sleep.
- `src/services/timer-service.ts`: Service layer managing SQLite KV storage (`alia.storage.kv`) and realtime broadcasts (`alia.realtime`).
- `server.ts`: Backend RPC contracts (`defineRpcContract`) and CLI registration (`alia.cli.register`).
- `app.tsx`: Frontend registration for App-wide overlay, Thread Header Action, and Nav Panel.
- Adheres to architecture rules AP-010 through AP-032.

## Testing & Build

```bash
npm test         # Run unit and contract tests via node:test
alia plugin build  # Build server and app bundles into dist/
```
