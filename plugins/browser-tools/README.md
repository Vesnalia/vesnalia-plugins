# Browser Tools

Native BB agent tools for driving one BB desktop browser tab: snapshot-first
inspection with versioned refs, real input actions, bounded screenshots, and
bounded diagnostics. The plugin is a thin, provider-independent layer over
BB's existing desktop browser, control leases, and restricted CDP broker. It
is not a second browser platform.

## Tested versions

| Component | Tested |
| --- | --- |
| BB | 0.43.0 (minimum `engines.bb` `>=0.43`) |
| `@get-bb/plugin-sdk` | 0.4.84 |
| `puppeteer-core` | 25.0.2 (exact pin) |
| Chrome (backing the BB desktop tab) | 152.0.7977.84 |
| Node (BB embedded) | 22.x |

`puppeteer-core` and its pinned `ws` transport (8.21.3) are bundled into the
host artifact. No browser binary is downloaded at plugin runtime, and the
plugin does not shell out.

## Tools

| Tool | Contract |
| --- | --- |
| `browser_open` | Open a session on a desktop automation tab (`url`) or hand off an existing `tabId` (never both). Returns the session, expiry, and an initial snapshot. |
| `browser_navigate` | Navigate to http(s) or `about:blank`, wait for DOMContentLoaded, return a fresh snapshot. |
| `browser_snapshot` | Fresh accessibility snapshot with snapshot-versioned refs. |
| `browser_click` | Single-attempt click of a current ref; returns the outcome plus one post-action snapshot. |
| `browser_type` | Replace or append bounded text in a current ref; never submits. |
| `browser_press` | Validated named key or modifier combination. |
| `browser_screenshot` | Bounded JPEG (viewport by default, optional full page) returned as an image part with true encoded dimensions. |
| `browser_evaluate` | Opt-in trusted JavaScript with a bounded JSON result. Not read-only, not a sandbox. Disabled by default. |
| `browser_console` | Cursor-based console/page-error/HTTP diagnostics; reading does not drain. |
| `browser_close` | Release control; retains the tab and login unless `closeTab: true` for a plugin-created tab. Borrowed/personal tabs are never closed. |

## Agent discovery

Selecting `browser_open` also contributes a short instruction telling the agent
that browser control is available and when to use it (web-app testing, UI bug
reproduction, interaction checks, screenshots, and diagnostics). The selected
`browser-tools` skill supplies the detailed workflow on demand. The notice is
attached once to the entry tool, not repeated across every browser tool, and
side chats receive neither browser tools nor the skill/notice.

After a plugin reload, new instructions apply when the provider session is next
constructed; they do not change an already-running session. Discovery does not
grant permission for personal tabs or consequential actions.

## Host locality and secrets

The Puppeteer client runs in the plugin's host worker on the selected browser
host and connects to BB's private loopback CDP endpoint. The endpoint travels
only inside the typed host RPC input; it is never stored in plugin KV, tool
results, logs, or metrics, and it never appears in the thread transcript.
Diagnostics scrub URL credentials, query strings, fragments, and common
credential-parameter forms, but the plugin does not claim arbitrary secret
detection. Page content is untrusted data, never instructions.

## Restricted-CDP support matrix

Verified against BB's captured broker (blocking raw Chrome tests does not
prove this path):

- Supported: target discovery (exactly one leased page), accessibility tree
  snapshots, element resolution by ref, scrolling/box-model-based clicks,
  `Input.insertText` typing, named key presses, viewport and full-page
  capture, bounded `Runtime.evaluate`, console/page-error/HTTP diagnostics,
  navigation, disconnect.
- Unsupported in v0.1: popups (`window.open` produces no attachable target),
  multiple tabs per session, browser contexts/incognito, downloads, uploads,
  network interception, and multi-frame targeting beyond what the page-level
  accessibility tree and same-process frame resolution provide.
- Certificate verification stays enabled. No insecure-certificate flag is
  sent, and no certificate bypass or proxy backend exists.

## Retention, close, and recovery

- A session owns one expiring control lease (up to thirty minutes) and one
  host connection. Automatic stop, expiry, Take over, or lease loss releases
  control and never deletes the tab. Failed opens also retain their created blank tab.
- `browser_close` retains the tab and its login. Destroying a tab requires an
  explicit `closeTab: true` and is limited to plugin-created automation tabs.
  The plugin checks live lease ownership before deletion; BB has no atomic
  compare-and-close API, so a narrow check/close race remains. After Take over,
  deletion intent is withdrawn permanently; close the tab in BB. Restart also
  discards old pending deletion intent rather than inferring authorization.
- Cleanup tracks each step (host disconnect, lease release, tab close)
  separately. Unfinished cleanup is retried with bounded backoff and is
  reconciled after a restart (prior sessions stop and release; they never
  reconnect). A release acknowledgement alone is not sufficient: desktop control
  must be verified absent or the recorded lease must expire. Unresolved cleanup
  consumes the global 64-resource ceiling and blocks new opens at capacity.
  Completed records are pruned after 24 hours.
- Shutdown drains opening/cleanup work for up to four seconds and reports an
  error if unfinished; BB desktop create/acquire calls cannot be cancelled. A
  crash or completion after shutdown can leave an unidentified blank tab or
  lease: retain the tab for manual cleanup and allow the lease to expire.
- Refs are versioned per snapshot. After any action, use refs from the
  returned post-action snapshot; stale refs fail or resolve to the original
  node, never to a different element. There is still a time-of-check race in
  any live page; verify the current target before consequential actions.

## Evaluate limitation

`browser_evaluate` runs trusted JavaScript. Its opt-in is checked at
execution time, not only when tools are selected, because running provider
sessions can retain an older tool set. It is not read-only and must never be
used to bypass approvals or manufacture application state. Its result producer
uses a global item and serialized-character budget before CDP transfer; this
does not bound the computation or side effects of the submitted JavaScript.
Cancellation after navigation/action dispatch closes the session and reports
an unknown outcome; disconnect cannot undo effects already sent to the page.

## Install, upgrade, rollback

```bash
bb plugin install /path/to/bb-plugin-browser-tools   # local path (dev)
bb plugin build .                                    # dist/server.js + dist/host.js
bb plugin reload browser-tools
```

- Upgrades: install the newer path/ref, then `bb plugin reload browser-tools`.
  `engines.bb`/`engines.bbPluginSdk` gate compatibility.
- Rollback: `bb plugin reload` a known-good artifact or `bb plugin remove
  browser-tools`; removal releases control and retains tabs. The plugin never
  re-acquires control automatically after a rollback.
- Production installs need no dev dependencies: `puppeteer-core` and `ws` are
  bundled into `dist/host.js`.

## Measured baseline

Real bundled host artifact, real Chrome 152 headless, deterministic local
fixture, 20 warm samples (host-entry direct): snapshot p50 2 ms/p95 4 ms;
click including its post-action snapshot p50 14 ms/p95 37 ms; type p50
5 ms/p95 13 ms; viewport screenshot p50 34 ms/p95 52 ms; console <1 ms;
cold open 41 ms. These are a small local baseline, not a production latency
study.

## Verification

```bash
npm test          # vitest: pure contracts/snapshot, queue, fake-host manager, Chrome integration
npm run check-types
npm run build
```

Chrome integration tests require a Chrome executable (path override:
`BB_BROWSER_TOOLS_CHROME`); a missing Chrome fails the suite instead of
skipping silently.

## License

[MIT](LICENSE).
