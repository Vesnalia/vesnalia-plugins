---
name: timer
description: Manage floating focus timers and pomodoro sessions with the `alia timer` CLI. Use when the user asks to start, check, pause, reset, or list timers, or set a timer for a specific duration or task.
---

# Timers and Focus Sessions

The Floating Timer plugin manages floating timers in VesnALIA IDE with live overlays, audio/visual alerts, and multi-timer support.

## Commands

| Command | Effect |
| --- | --- |
| `alia timer list` | Show all timers with their id, status, remaining time, and title. |
| `alia timer add <minutes> [name]` | Create and start a timer for N minutes with an optional title. |
| `alia timer pause <id>` | Pause a running timer. |
| `alia timer start <id>` | Resume or start a timer. |
| `alia timer reset <id>` | Reset a timer back to its initial full duration. |
| `alia timer reset-all` | Reset all timers back to their initial duration. |
| `alia timer sequence` | Start all timers sequentially in order. |
| `alia timer stop-sequence` | Stop the sequential execution chain. |
| `alia timer remove <id>` | Delete a timer. |
| `alia timer clear` | Clear all completed timers. |

## Examples

```bash
# Start a 25-minute Pomodoro timer
alia timer add 25 "Помидорка: ревью кода"

# Start a 5-minute tea break
alia timer add 5 "Чай"

# List active timers
alia timer list

# Pause a timer
alia timer pause 3a1b4c5d
```

## Rules

- Always check `alia timer list` before modifying timers by ID.
- The UI floating overlay and thread header display active countdowns in real-time.
