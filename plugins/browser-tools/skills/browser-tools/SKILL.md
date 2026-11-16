---
name: browser-tools
description: Control a real VesnALIA desktop browser using native browser_* tools. Use when testing a local web app, reproducing UI bugs, verifying interactions, inspecting websites, capturing screenshots, or checking browser console and network failures. Covers snapshot-first navigation, clicks, typing, screenshots, diagnostics, and safe session cleanup.
---

# Browser Tools

Use the native browser tools to inspect and operate one VesnALIA desktop automation
tab. The tools own session lifecycle, refs, bounds, and cancellation; this
skill owns the working habits.

## Workflow

1. `browser_open` once per task. Pass `url` for the first page, or `tabId`
   only when the user explicitly asks to use an existing tab (that hands off
   the tab's logged-in profile; `allowPersonal` needs explicit authorization).
   Reuse the returned `sessionId` for every later call.
2. Read the snapshot that `browser_open`, `browser_navigate`, and
   `browser_click`/`browser_type`/`browser_press` already return. Do not call
   `browser_snapshot` again immediately; only take a fresh snapshot when the
   page changed outside a tool call or the previous snapshot is stale.
3. Refs are versioned to one snapshot. After any action, use refs from that
   action's post-action snapshot; an older ref fails with `STALE_REF`. Take a
   fresh snapshot instead of retrying an old ref.
4. Confirm readiness from the returned snapshot and page metadata. Navigation
   waits for DOMContentLoaded only; a single-page app may need one explicit
   `browser_snapshot` after the UI settles. Never loop with fixed sleeps.
5. Never automatically retry a click, typing, Enter, or navigation. If the
   result is `ACTION_OUTCOME_UNKNOWN`, the browser may have acted: inspect the
   retained tab in VesnALIA before deciding, and ask the user when the action was
   consequential. The session is closed on an unknown outcome; a fresh,
   explicitly authorized open is required for further tool inspection.
6. Sign in manually in the automation tab when a site needs credentials. Never
   type secrets through `browser_type`; tool inputs and results can be
   recorded in the thread.
7. `browser_evaluate` is disabled unless the user enabled it in the plugin
   settings. When enabled it is trusted JavaScript, not read-only. Use it for
   bounded inspection only, never to bypass approvals or manufacture
   application state that hides the real workflow.
8. Tenant and action scope follow the user's request and the host repository's
   own policy. Confirm the practice/tenant and obtain approval before
   consequential actions such as submissions, payments, or messages.
9. `browser_close` releases control but keeps the tab and its login. Pass
   `closeTab: true` only when the user explicitly wants a plugin-created tab
   destroyed; borrowed or personal tabs are never closed by the plugin. Stop
   or Take over in VesnALIA ends the session and keeps the tab.
10. Control leases last at most thirty minutes. When a session stops or
    expires, call `browser_open` again; the retained tab keeps its login.

## Evidence

Report bounded evidence: what action ran, the tool's own summary, and only
the snapshot or screenshot excerpt that proves the result. Do not paste entire
page dumps, credentials, tokens, or full screenshots when a short excerpt or
the tool summary is enough.
