# Provider Authentication for VesnALIA

Authenticate or reauthenticate Claude Code on a connected VesnALIA machine from **Settings → Providers**.

The plugin starts Claude Code's standard subscription login flow on the selected machine, opens the Claude consent screen in your browser, and submits the authorization code you paste back into VesnALIA. It supports both a fresh Claude Code installation that has never signed in and an existing installation that needs to reauthenticate.

## Requirements

- VesnALIA 0.39 or newer
- Claude Code installed on the machine you want to authenticate

## Install

Install the latest compatible release from the VesnALIA Community marketplace, or install directly from Git:

```sh
alia plugin install git:https://github.com/wjin17/bb-plugin-provider-authentication.git@semver:^0.1.0
```

Open **Settings → Providers**, select a connected machine, and choose **Authenticate** or **Reauthenticate**.

## Security

The plugin runs `claude auth login --claudeai` through VesnALIA's host worker on the selected machine. The authorization code is sent directly to that process. It is not persisted, logged, or included in realtime events. Authentication credentials remain managed by Claude Code.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```
