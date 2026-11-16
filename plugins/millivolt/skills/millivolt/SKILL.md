---
name: millivolt
description: Inspect AI traffic and the millivolt proxy (requests, errors, tokens, cost), and install, adopt, or update it from a shell. Use when a request is slow, retries are piling up, token/cost numbers matter, the proxy is not running, or the user asks what traffic an agent generated.
---

# millivolt

The millivolt plugin runs a self-hosted inference proxy on loopback and keeps it
in step with bb: it installs millivolt when it is missing, adopts an existing
install, starts it with bb, health-checks every 20 seconds, and pulls updates on
each bb start.

Default listener: `http://127.0.0.1:8471` (Settings → millivolt). The operator
token is a secret setting and is never available to this skill.

## Commands

```sh
bb millivolt status             # install, container and headline metrics
bb millivolt status --json
bb millivolt requests 20        # most recent proxied requests
bb millivolt requests 20 --json
bb millivolt discover           # find existing installs before creating one
bb millivolt setup              # install into ~/millivolt on port 8471
bb millivolt setup --dir PATH --port N
bb millivolt setup --adopt --dir PATH --port N
bb millivolt update             # pull the newest image, recreate if it changed
bb millivolt repair             # diagnose and fix a deployment that stopped answering
bb millivolt revert             # pin the previous image after a bad update
bb millivolt resume             # stop pinning, track the published tag again
bb millivolt start|stop|restart
bb millivolt url
```

## Reading traffic

- `status` reports state, install directory, port, the last update result,
  requests, errors, in-flight count, cost and token totals.
- `requests` prints one line per call: timestamp, status, provider/model, client,
  duration, tokens, and the error type when a call failed.
- The same data lives in bb's sidebar under **Millivolt** (Overview, Requests,
  and the full dashboard), which is also where to change providers, holds and
  rate limits.

## Provisioning rules

- Run `discover` before `setup`: a user who already runs millivolt should be
  adopted (`setup --adopt --dir … --port …`), not given a second copy.
- `setup` without `--adopt` writes a compose deployment and starts it. It refuses
  to overwrite a compose file the plugin did not create.
- `stop` is sticky: the supervisor will not bring millivolt back on its own until
  `bb millivolt start`.
- Updates skip while a request is in flight; a dropped stream is not a failed
  update.
- After `revert`, automatic updates are paused until `resume`. The pin lives in
  `rollback.yaml` beside the deployment's compose file.

## Constraints

- Docker must be running. On Windows the plugin can launch Docker Desktop.
- Durable metrics are best-effort: a nonzero dropped count means history lost
  records under load, not that inference failed.
- The listener is loopback only; do not expose it.
