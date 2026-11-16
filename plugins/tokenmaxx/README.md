# alia-plugin-tokenmaxx

A [VesnALIA](https://getbb.app) plugin for [tokenmaxx](https://github.com/RubricLab/tokenmaxx): see every
Codex and Claude Code account you are signed into, watch their rate-limit pressure fill up, and
switch between them without leaving VesnALIA.

## Requirements

- macOS, where tokenmaxx runs
- `tokenmaxx` installed and its daemon reachable: `bun add -g tokenmaxx`
- VesnALIA 0.39 or newer

## Install

```sh
alia plugin install git:https://github.com/pedroapfilho/bb-plugin-tokenmaxx.git@^0.1.3
```

Then open **tokenmaxx** in the VesnALIA sidebar. The sidebar row also carries how full your pool is:
every enabled account, across both providers, counted once at its own fullest rate-limit window.
You can read the pressure without opening the panel.

## What it gives you

**Accounts.** One card per provider with an account list ordered by headroom. Each account shows its
plan, health, when its limits renew, when usage was last measured, and a bar per rate-limit window
with its own reset countdown.
From here you can make an account active, sign one out, spend a Codex reset credit, hide a window
you do not care about, and turn auto-rotation on with its threshold, hold, and hysteresis.

**Analytics.** Token throughput and cost at API list prices across 1 hour to 31 days, with a
throughput chart, an input/output/cache cost split, and per-provider and per-model tables.

**Setup.** Daemon status with start and stop, the proxy address, sign-in for both providers (OAuth
or an API key) running the real login in a VesnALIA terminal you can type into, routing install and
uninstall for `codex`, `claude`, and `pi`, plus the full `tokenmaxx doctor` report.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `binaryPath` | auto | Path to the `tokenmaxx` binary when it is not on the server's `PATH` |
| `home` | `~/.tokenmaxx` | `TOKENMAXX_HOME` override |
| `refreshSeconds` | `5` | How often the dashboard polls the daemon |

Edit them in Extensions, or with `alia plugin config tokenmaxx set <key> <value>`, then run
`alia plugin reload tokenmaxx`.

## How it works

Reads and account actions go over tokenmaxx's own JSON-RPC unix socket at
`~/.tokenmaxx/runtime/manager.sock`, so the dashboard costs no extra process per refresh and can
show the same analytics the tokenmaxx TUI does. A background service polls that socket and publishes
a realtime signal only when something meaningful changes, so open clients update without hammering
it.

Four things need the CLI instead, because the socket cannot do them: `doctor`, routing install and
uninstall, daemon start and stop, and login. Login needs a real pty, so the plugin runs it in a VesnALIA
terminal and streams that terminal into the panel.

## Development

```sh
npm install
alia plugin install .      # register this directory in place
alia plugin dev            # rebuild and reload on every save
```

`npx tsc --noEmit` typechecks both entries.

## Notes

This is an independent plugin. It is not affiliated with Rubric Labs, OpenAI, or Anthropic, and it
grants no account any limit it did not already have: it only picks which of your own accounts serves
a request.

## License

MIT
