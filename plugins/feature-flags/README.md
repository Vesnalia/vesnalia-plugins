# Feature Flags

See and manage [LaunchDarkly](https://launchdarkly.com) feature flags from a VesnALIA
sidebar page.

One row per flag, one column per environment — a flag is a single entity and
only its on/off state is per-environment. Each cell is a toggle you click to
turn that flag on or off in that environment.

## Features

- **Per-environment toggles** — turn a flag on or off in each environment from
  its column.
- **Search and facets** — filter by name/key/description, and by Maintainer
  (including "Me"), Status (New / Active / Launched / Inactive / Archived),
  Type (Boolean / Multivariate), Lifecycle (Temporary / Permanent), Tag, and
  Created date.
- **Copy key** — one click copies a flag's key.
- **Open in LaunchDarkly** — jump to the flag's page in the web app for the
  fuller controls.
- **Cached with refresh** — the list is cached so the page opens fast; the
  header shows when it last synced and a Refresh button re-pulls from
  LaunchDarkly. Toggles update the cache in place.
- **Link flags to a thread** — a thread side-panel tab and a composer banner
  show the flags linked to a thread, with per-environment state and quick
  links into LaunchDarkly.
- **`alia feature-flags` command** — read and toggle flags from the shell, for
  you and for agents (a bundled skill teaches agents the command). Toggling a
  protected environment needs `--yes`.

## CLI

```sh
alia feature-flags list [--env <env>] [--mine] [--json]
alia feature-flags status <flag-key> [--json]
alia feature-flags on  <flag-key> --env <env> [--yes]
alia feature-flags off <flag-key> --env <env> [--yes]
alia feature-flags open <flag-key>
```

## Setup

1. Create a LaunchDarkly access token with write rights on the project you want
   to manage (a read-only token still lets you see flags).
2. Set it, plus the project you target:

   ```sh
   alia plugin config feature-flags set apiToken <token>
   alia plugin config feature-flags set projectKey <project-key>   # defaults to "default"
   alia plugin reload feature-flags
   ```

   You can also set these in the plugin's settings page in the VesnALIA app. Paste the
   raw token — a stray smart quote or hidden character will be rejected.

## Settings

- `apiToken` (secret) — LaunchDarkly access token.
- `projectKey` — the project to read and manage. Default `default`.
- `baseUrl` — API host. Default `https://app.launchdarkly.com`; change it for a
  federal or self-hosted instance.
- `protectedEnvironments` — comma-separated environment keys that the CLI
  refuses to toggle without `--yes`. Default `production`.

## Notes

- The token is a secret setting: it lives in a `0600` file, never in the plugin
  db and never in the frontend bundle. All LaunchDarkly calls run server-side.
- "Status" is per-environment and matches a flag if any environment has the
  chosen status; "Me" matches flags whose LaunchDarkly maintainer is you.
