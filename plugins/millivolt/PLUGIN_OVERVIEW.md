Millivolt is the self-hosted inference proxy that keeps AI traffic visible:
live requests, retained history, tokens, cost, latency and retries in one
place. This plugin installs it, keeps it current, and shows it inside VesnALIA.

## What you get

A **Millivolt page in the sidebar** with three tabs. Overview shows requests,
errors, in-flight calls, cost, tokens, time to first token, throughput,
pause/throttle/debug state and any dropped history, plus where the install
lives and when it was last updated. Requests is the retained log: time, status,
provider and model, client, tokens, time to first token, duration and retries.
Dashboard is the full millivolt dashboard, charts and Settings included.

**Provisioning without homework.** On first load the plugin looks for an
existing millivolt before creating anything: Docker labels name the compose
directory, a loopback probe names the port, and a bounded folder scan catches a
deployment that is on disk but not running. Found one? It adopts that directory
and port, and reads the operator token from its env file. Found nothing? It
writes a compose deployment, generates a long operator credential, pulls the
image and starts it, then reports the directory and port it chose.

**Updates on your schedule.** With auto-update on, each VesnALIA start pulls the
newest millivolt image and recreates the container only when the image actually
changed, and again every six hours while VesnALIA stays open. It skips the pull while
a request is in flight, so a long stream is not cut off for an update, and it
keeps the previous image so a bad update can be reverted with one action
instead of a hand-edited compose file. When a deployment stops answering, one
Auto-fix action re-checks the daemon, the port mapping and the operator token,
repairs what it can, and falls back to the previous image if that fails.

**A command line** for the same work: `alia millivolt status`, `setup`,
`discover`, `update`, `start`, `stop`, `restart`, `url`, `requests`, with
`--json` where a script needs it. A bundled skill tells agents how to read
traffic and control the proxy.

## How it works

A fresh deployment gets its own operator credential — 32 random bytes, kept in
the deployment's env file and in the plugin's own storage — so the dashboard is
protected from the first request without the user inventing a secret. Adopted
deployments keep whatever credential they already use.

The plugin runs `docker compose` with an argument array — never a shell — in the
deployment directory, then talks to millivolt over its operator API. The
operator token stays on the server: it is a secret setting or a value in the
plugin's own storage, and the sidebar never receives it. The Dashboard tab loads
through a second loopback listener that adds the credential to every request and
strips the frame-blocking header, so the store's dashboard works inside VesnALIA
without a browser tab, and without asking for a token.

## Requirements

Docker must be running: Docker Desktop on Windows (the plugin can start it) or
Docker Engine on Linux. The image is about 100 MB, and history lives in a Docker
volume. The listener binds loopback only, so the proxy is reachable from this
machine and not from the network.

## Constraints

- Durable metrics are best-effort: a nonzero dropped count means history lost
  records under load, not that inference failed.
- Millivolt has no user isolation. One operator token protects the dashboard and
  the inference listener; this plugin holds that token for you.
- The in-alia dashboard proxy adds the credential for loopback callers that arrive
  with a loopback referrer, and refuses every other origin.
- Changing millivolt's own `listen` in the dashboard requires the published port
  to match, or the port goes dark. The plugin names that mismatch when it
  happens instead of reporting a bare timeout.
