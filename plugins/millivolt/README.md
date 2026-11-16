# alia-plugin-millivolt

A VesnALIA plugin that installs, runs, updates and exposes
[millivolt](https://github.com/LLM-4-People/millivolt) — the self-hosted
inference proxy that records what your agents send, what comes back, and what it
cost.

Open **Millivolt** in the VesnALIA sidebar and you get millivolt's own dashboard
in-process, plus two native views over its metrics API, without a browser tab and
without pasting an operator token.

## What it does

- **Installs millivolt when it is missing.** Writes a compose deployment into a
  directory it owns, generates a 32-byte operator credential, pulls the image,
  starts the container, verifies `/healthz`.
- **Adopts millivolt when it already exists.** Discovery reads Docker compose
  labels (authoritative directory and port), probes loopback ports for the
  operator challenge, and falls back to a bounded folder scan. The operator token
  is read from the deployment's own `.env`.
- **Keeps it running with VesnALIA.** The supervisor starts millivolt on load, checks
  health every 20 seconds, restarts up to three times, and leaves a manual Stop
  stopped across reloads.
- **Keeps it current.** On each VesnALIA start, and every six hours while VesnALIA is open,
  it pulls the newest `ghcr.io/llm-4-people/millivolt:main` image, recreates the
  container only when the image id changed, and skips the update while requests
  are in flight.
- **Serves the dashboard in VesnALIA.** millivolt sends `frame-ancestors 'none'`, so a
  second loopback listener proxies it, adding the operator credential per request
  and stripping the frame-blocking header.

## Layout

| Path | Purpose |
| --- | --- |
| `server.ts` | Backend: settings, persisted install state, supervisor, RPC, CLI, dashboard proxy |
| `app.tsx` | Sidebar page: setup, Overview, Requests, Dashboard |
| `lib/millivolt/docker.ts` | Bounded Docker CLI helpers (argv only, no shell) |
| `lib/millivolt/provision.ts` | Compose template, discovery, install, pull/update |
| `skills/millivolt/SKILL.md` | How agents read traffic and control the proxy |
| `PLUGIN_OVERVIEW.md` | Store listing text |

## Install

```sh
alia plugin install https://github.com/hv-V6/bb-plugin-millivolt.git
```

Development loop:

```sh
npm install
alia plugin build      # dist/server.js + dist/app.js
alia plugin dev        # rebuild and reload on save
```

## Settings

Settings are overrides; blank means "use what the plugin recorded".

- **Compose directory** — blank: the recorded install, else discovered, else
  `~/millivolt`.
- **Host port** — `0`: the recorded port, else the discovered one, else 8471.
- **In-alia dashboard proxy port** — default 8472, loopback only.
- **Operator token** — blank: the recorded token or the one in the deployment's
  `.env`.
- **Start millivolt with VesnALIA**, **Pull updates when VesnALIA starts**, **Launch Docker
  Desktop when the daemon is down**, **Docker Desktop executable**.

## Commands

```sh
alia millivolt status [--json]
alia millivolt setup [--dir PATH] [--port N]        # install
alia millivolt setup --adopt --dir PATH --port N    # adopt an existing deployment
alia millivolt discover [--json]
alia millivolt update [--json]
alia millivolt start | stop | restart
alia millivolt url
alia millivolt requests [count] [--json]
```

## How discovery decides

1. **Docker labels.** Containers whose name or image mentions millivolt are
   inspected for `com.docker.compose.project.working_dir` and the published host
   port. This is authoritative and preferred.
2. **Loopback probe.** `/healthz` plus a `401` carrying
   `WWW-Authenticate: Bearer realm="millivolt-operator"`. The plugin's own
   dashboard proxy port is excluded.
3. **Bounded folder scan.** Only when nothing is running: depth 3 over the home
   directory and drive roots, 2.5 second budget, 400 directories max, skipping
   `node_modules`, `AppData`, `Windows`, `Program Files`, and similar. A compose
   file that mentions millivolt is a candidate.

Adopting records the directory, port, container name and token in the plugin's
storage; it never rewrites somebody else's compose file. Installing writes
`compose.yaml`, `.env` and a `.millivolt-managed` marker, and refuses to
overwrite a compose file it did not create.

## The operator token

A fresh install generates one: 32 random bytes as hex, written to `.env` as
`MILLIVOLT_OPERATOR_TOKEN` and passed into the container through compose. The
plugin keeps the same value so its own API calls and the dashboard proxy pass
the operator gate.

Precedence is **secret setting → the deployment's `.env` → the plugin's record**.
To rotate, edit `.env` (or set the setting), then reload the plugin: compose
recreates the container with the new environment and the plugin follows. With a
token set in Settings, `.env` edits are ignored by design.

An adopted deployment keeps whatever credential it already has; if its `.env`
has none, the plugin records none and the sidebar suggests setting one.

## Auto-fix

`alia millivolt repair` — the **Auto-fix** button in the sidebar header — runs the
diagnosis that covers the failures seen in practice, in order:

1. Start Docker if the daemon is down.
2. Drop a rollback pin whose image was deleted (it makes every `compose up` fail).
3. Compare the container's `listen` in `/config/proxy.yaml` with the port Docker
   publishes. When they disagree the container can report healthy while the host
   port goes nowhere; repair rewrites `listen` to the published container port
   and restarts. The original file is left as millivolt's own `.invalid` backup
   only if millivolt rejects it — the rewrite itself keeps the rest of the file.
4. `compose up -d`, then wait for `/healthz`.
5. If it still does not answer and a previous image exists, revert to it.
6. Confirm the operator token is accepted, and clear the supervisor's give-up
   state so health checking resumes.

The outcome is reported as `repairReport` in the status line under the header,
and as `Auto-fix: …` in the UI, so a silent success is still an explained one.

## Rollback

An update that breaks millivolt should not require hand-editing compose. The
plugin records the image the container was started from and the image it
replaced; both are kept as `imageId` and `previousImageId` in its state, and a
drift between the running container and the record (an update made outside the
plugin) is captured the same way.

`alia millivolt revert` tags the previous image as
`ghcr.io/llm-4-people/millivolt:alia-rollback`, writes a `rollback.yaml` compose
override that pins it with `pull_policy: never`, and recreates the container
from it. The sidebar shows the pinned id and offers **Resume updates** instead
of Check for updates.

`alia millivolt resume` deletes the override, pulls the published tag again and
recreates the container from it. While a deployment is pinned, automatic
updates are paused; a revert never deletes the image you left behind, so the
two can be flipped back and forth.

If the previous image was pruned, `canRevert` goes false and the plugin says so
rather than pinning a missing tag.

## Security notes

- The operator token lives in a secret setting, the deployment's `.env`, or
  plugin storage. It never reaches the frontend bundle.
- The dashboard proxy binds `127.0.0.1`, rejects a foreign `Host` header, and
  refuses requests whose `Origin`/`Referer` is not loopback. A referrer-less
  request must be a top-level navigation.
- Millivolt's listener is published on loopback only (`127.0.0.1:<port>`), as the
  upstream compose file does.
- The plugin is full-trust code inside the VesnALIA server: it runs `docker` and reads
  the compose directory it is pointed at.

## Licence

MIT.
