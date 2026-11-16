---
name: password-gate
description: Inspect, reset, and manage the Password Gate plugin — the lock screen in front of the VesnALIA app, its access password, and trusted devices. Use when the user asks why VesnALIA is locked, how to set or change the password, how to reset a forgotten password, how to stop being asked for the password, or how to revoke a device.
---

# Password Gate

The Password Gate plugin puts an unlock panel in front of the VesnALIA app. Every
window is locked until the correct password is entered; the server compares it
and returns only a boolean, so the password never reaches the browser.

## Commands

| Command | Effect |
| --- | --- |
| `alia password-gate status` | Report whether the app is locked. |
| `alia password-gate status --json` | Same, as JSON (`{ "required": boolean }`). |
| `alia password-gate reset` | Clear the password, open the gate, revoke every device. |
| `alia password-gate devices` | List devices that skip the prompt, with expiry. |
| `alia password-gate devices --json` | Same, as JSON (`{ "devices": [...] }`). |
| `alia password-gate revoke <device-id>` | Revoke one device. |
| `alia password-gate revoke --all` | Revoke every device. |

## Configuration

The password is a secret plugin setting. The user sets it in Settings →
Installed plugins → Password Gate → *Access password*; saving applies at once.
The equivalent CLI:

```
alia plugin config password-gate set password <value>
alia plugin config password-gate unset password
```

It is stored in a `0600` file under the plugin's secrets directory, never in
the database and never sent to the browser. With no password set, the gate is
open and nothing renders.

## Forgot the password

The unlock panel covers the app, so the Settings field is unreachable while the
gate is locked. `alia password-gate reset` is the way out: it clears the
password, opens the gate, and revokes every trusted device. The user then sets
a new password in Settings.

## Trusted devices

Ticking **Trust this device** on the panel gives that browser a server-issued
token, stored in `localStorage` under `alia-plugin-password-gate.device-token`.
The device then skips the prompt until the trust window ends (Settings →
*Trust a device for (days)*, default 30, `0` disables the feature). Only the
token's SHA-256 hash is stored server-side.

- Changing the password invalidates every trusted device.
- `alia password-gate revoke --all` locks trusted windows within one poll
  interval (~5s); a rejected token is dropped from the browser.
- At most 50 devices are kept; the oldest are dropped.

## Rules

- Never ask for, echo, print, store, or guess the password. Do not pass it on a
  command line, write it to a file, or put it in a thread message.
- Never copy a device token out of a browser profile, and never paste one into
  a message or file: possession of a token is equivalent to knowing the
  password until it expires.
- Do not set, change, or clear the password unless the user explicitly asks.
  Configuring it is the user's job. `reset` in particular opens the gate for
  everyone until a new password is set.
- Reading status, listing devices, and revoking devices are safe to do on
  request and take effect without a reload.
- If a user is locked out, first suggest entering the password; if they have
  forgotten it, tell them to run `alia password-gate reset` themselves. Agents
  cannot unlock the GUI.
- Treat the gate as a session-level convenience, not a security boundary: it is
  frontend code running same-origin, so anyone with filesystem access to the VesnALIA
  host can disable the plugin, and VesnALIA's own API is not gated at all.
