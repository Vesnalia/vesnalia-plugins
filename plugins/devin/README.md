# VesnALIA Devin provider plugin

This plugin adds Devin as a VesnALIA provider by launching the local Devin CLI in
ACP mode (`devin acp`). VesnALIA's generic ACP bridge handles the session protocol,
streaming events, tools, and model discovery.

## Requirements

Install the Devin CLI on every host that should offer the provider, then
authenticate it:

```sh
devin auth login
```

The plugin does not store or forward Devin credentials; the CLI owns local
authentication.

## Install locally

From this directory:

```sh
alia plugin install .
alia plugin reload devin
```

Select **Devin** in a new VesnALIA thread. If the provider is unavailable, verify
that `devin` is on the VesnALIA host's `PATH` and run `devin auth status`.

## Development

```sh
npm install
npm run typecheck
npm test
alia plugin build
```
