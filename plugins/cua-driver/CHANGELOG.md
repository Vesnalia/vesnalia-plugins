# Changelog

## 0.1.0 (unreleased)

- First release: 30 `cua_*` agent tools, `cua-computer-use` skill, per-provider
  routing (`prefer-native`, `cua-everywhere`, `off` plus overrides), driver
  readiness per machine, `alia cua` CLI, multi-machine execution through the VesnALIA
  host daemon and one persistent `cua-driver mcp` session per machine.
- Opt-in installer and macOS permission request from the settings page and
  the CLI (`alia cua install --yes`, `alia cua grant`); never runs without an
  explicit confirmation.
- Settings use separate cards for routing, provider overrides, machines, and
  Cua attribution. Secondary lists and commands are collapsible, and row
  details sit behind a hover `?` tooltip so every row stays on one line. The
  tool list is available from `alia cua tools`.
- The installer runs in a reopenable progress dialog with phase estimates,
  status animation, retry states, and expandable terminal output.
- Machine setup is now an expandable checklist with install, service, and
  macOS permission state, including direct-capture guidance. Tool calls preflight
  readiness and link permission failures directly back to the settings panel.
- Resuming an idle thread now starts a fresh Cua session label instead of
  reusing the ended label from the previous turn.
- The user-facing plugin name is **Computer Use**; Cua Driver and Cua AI remain
  credited and linked in the listing, settings, README, and notice.
