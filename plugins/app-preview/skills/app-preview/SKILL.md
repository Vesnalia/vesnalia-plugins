---
name: app-preview
description: Detect, start, stop, and open the app in the current VesnALIA thread worktree, or list, share, and kill listening ports on this machine. Use when the user wants to preview, run, launch, or test the app from a session, share a port for phone/remote preview, see what is using a port, free a stuck port, or try a branch in the browser.
---

# App preview

This plugin runs the worktree (or branch checkout) attached to the current thread. It detects the framework and start command and launches the app in a VesnALIA terminal. Whether the in-app browser opens is a plugin setting: `manual` (default) or `agent`. Stop closes that browser only in agent mode. Use Open in browser from the Preview panel when the mode is manual.

It also lists listening TCP ports on the VesnALIA server machine (dev servers by default) and can kill a listener by port or PID. Share exposes a port over VesnALIA connect for phone/remote preview. Share and Unshare are on the Preview panel for the running worktree port, and on the Ports list for any listener. Share and kill refuse Docker-published ports and system apps.

Prefer `preview_app` in a thread over guessing `package.json` scripts or `lsof`. Use `alia preview` outside a session, or when the user asked for the CLI.

A live App Preview open-mode line is injected every turn. Follow it.

## Commands

| Command | Effect |
| --- | --- |
| `alia preview detect` | Identify framework, package manager, start command, and port |
| `alia preview start` | Launch in a thread terminal. In agent mode, open the in-app browser when ready |
| `alia preview stop` | Stop that worktree's preview process. In agent mode, close its in-app browser |
| `alia preview restart` | Stop, then start again |
| `alia preview status` | Detection plus running/stopped state and URLs |
| `alia preview ports` | List listening TCP ports (dev servers). `--all` includes system apps |
| `alia preview share <port>` | Expose that port over VesnALIA connect (`https://<handle>--<port>.getbb.app`) |
| `alia preview unshare <port>` | Remove that connect share |
| `alia preview kill <n>` | Kill by port, PID, or range (`3000-3010`). `--force` sends SIGKILL |

Add `--json` when the output drives later steps. From outside a thread, pass `--thread <id>` for detect/start/stop/restart/status. `ports`, `share`, `unshare`, and `kill` do not need a thread.

Optional start flags: `--command "<cmd>"`, `--cwd <dir>` (a detected app directory), `--port <n>`.

The native tool `preview_app` is the worktree actions (`detect`, `start`, `stop`, `restart`, `status`) with optional `port` and `relativeCwd`. It starts the detected launch recipe only. `preview_ports` lists, shares, or kills listeners (`list` / `share` / `unshare` / `kill`, optional `all`, `targets`, `port`, `force`). Share, unshare, and kill wait for the user to confirm in VesnALIA.

## Procedure

1. If several apps might exist and you need to pick one, run `preview_app` with `detect`. Otherwise skip detect. `start` detects on its own.
2. Follow the live open-mode line. In manual mode, start only when the user asked to preview or open the app. In agent mode, start once after you finish UI-visible work on this worktree's app, unless a preview is already running.
3. When starting, call `preview_app` `start` once. Pass `relativeCwd` if several apps were listed. If detection found nothing, ask the user to start from the Preview panel or CLI instead of inventing a command.
4. Give the user the `Open:` URL as a markdown link. That URL is a VesnALIA connect share when pairing is available, so it works from hung.getbb.app. Do not paste a localhost URL as the thing they should click while they are remote.
5. In agent mode the in-app browser opens when the server is ready and stop closes it. In manual mode, give them the Open URL and let them use the Preview panel.
6. Stop the preview when they are done testing, unless they asked to leave it up.
7. For "what is on port 3000" or "kill whatever is on 5173", use `alia preview ports` / `alia preview kill`. Kill only what they asked for. Do not share or kill Docker-published ports or system apps. Stop the container instead.
8. For phone or remote preview of a local HTTP port, use Share on the Preview panel, `alia preview share <port>`, or the Ports panel Share control. That is `alia connect expose`, not a separate `alia tunnel` command. If share fails with ECONNREFUSED on 127.0.0.1, the process is listening on IPv6 loopback only. Restart the preview so it binds 127.0.0.1. Unshare from the Preview panel, the Ports panel, or `alia preview unshare <port>`.

## Rules

- Start and stop through this plugin so the panel, terminal, shared port, and in-app browser stay in sync.
- One preview per worktree. Starting again while it is already running returns the existing process. In agent mode it re-opens the browser if it is missing.
- After start, prefer the plugin's Open URL over guessing localhost. Do not call status after start; start already returns it.
- Pass `--cwd` / `relativeCwd` for the app directory. Do not bake `cd … &&` into `--command`.
- Ports listed are on the machine running the VesnALIA plugin server, not a remote browser.
- Connect share forwards to 127.0.0.1. Start/restart through this plugin so Node frameworks bind that address. Do not tell the user to open localhost from hung.getbb.app.
- Do not share or kill Docker-published ports or system apps through this plugin.
- `preview_app` cannot pass a custom start command. Share, unshare, and kill from `preview_ports` wait for the user to confirm.
