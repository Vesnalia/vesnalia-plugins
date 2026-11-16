# alia-plugin-password-gate

A VesnALIA plugin that puts a password prompt in front of the VesnALIA app: before anyone
can use VesnALIA, they must enter the password. The password is a secret plugin
setting — set it in VesnALIA's own Settings UI, and it never reaches the browser.

- `server.ts` — the backend: the `password` secret setting, RPC methods
  (`gate_status`, `gate_verify`) that keep verification server-side, and the
  `alia password-gate` CLI command.
- `app.tsx` — the frontend: a full-screen unlock panel rendered through the
  `experimental_appOverlay` slot, plus two settings sections — **How to use**
  (step-by-step instructions, shown on the plugin's detail page) and **What
  this protects** (the honest limits of the gate).
- `skills/password-gate/SKILL.md` — a skill that tells agents how to inspect the
  gate and reminds them never to handle the password.
- `PLUGIN_OVERVIEW.md` — the store listing text.

## How it works

On app load the overlay asks the server whether a password is configured. With
no password set the gate is open and nothing renders. Otherwise the unlock
panel covers the app until the correct password verifies; verification runs on
the server (`crypto.timingSafeEqual` over SHA-256 digests) and only a boolean
returns to the frontend. Unlock is per app window (in memory), so each fresh
window locks again.

## Setting the password

Settings → Installed plugins → Password Gate → **Access password**. Saving it
applies at once — no reload, no restart. The equivalent CLI:

```
alia plugin config password-gate set password 'hunter2'
alia plugin config password-gate unset password
```

The value is a secret setting: it is stored in a `0600` file at
`<dataDir>/plugins/password-gate/secrets/password`, never in the database and
never in a settings payload sent to the browser.

## Forgot the password

The unlock panel covers the app, so the Settings field is unreachable while the
gate is locked. Reset from a terminal:

```
alia password-gate reset
```

That clears the password, opens the gate, and revokes every trusted device.
Set a new password in Settings afterwards. `alia password-gate status` reports the
current state:

```
alia password-gate status            # Locked (password from the stored setting)
alia password-gate status --json     # { "required": true }
```

## Trust this device

With the panel's **Trust this device** box ticked, the server mints a random
256-bit token and the browser keeps it in `localStorage`, so that device skips
the prompt until the trust window ends. Only the token's SHA-256 hash is
stored server-side, so reading the plugin database does not yield a usable
token.

Guards that matter:

- **Password rotation retires every device.** Each token records a fingerprint
  of the password it was issued under; changing the password invalidates all
  of them.
- **Expiry.** Tokens expire after *Trust a device for (days)* (default 30, `0`
  disables the feature).
- **Revocation is immediate.** `alia password-gate revoke --all` locks every
  trusted window within one poll interval, and a rejected token is deleted
  from the browser rather than retried.
- **Bounded table.** At most 50 devices are kept; the oldest are dropped.

Trust is per browser profile, not per VesnALIA account, and it is a convenience, not
a security boundary: anyone who can read the browser profile's `localStorage`
can copy the token. Revoke from a terminal when a device is lost.

## Security scope

This is a session-level gate, not a cryptographic boundary. It stops casual and
unattended access to the app window; it does **not** protect the data behind
VesnALIA. Concretely, and verified against a running VesnALIA:

- **The overlay is DOM.** Removing the panel's element from the page hides the
  lock for that window until the next reload. Any script, bookmarklet, or
  browser extension can do this.
- **The plugin can be switched off.** `alia plugin disable password-gate` and
  `alia plugin safe-mode on` both stop the gate entirely; the app then loads
  unlocked.
- **VesnALIA's own API is not gated.** Plugin RPC uses `local` auth semantics, and
  VesnALIA's core routes serve loopback callers without credentials, so anything that
  can reach the port (including a forwarded or tunnelled port) reads threads,
  projects, and environments without the password.
- **The password is readable on disk** by anyone who can read the VesnALIA server's
  files or environment, and a plugin installed from a local path can be edited
  and reloaded.
- **Brute force is unthrottled.** `gate_verify` has no rate limit or lockout,
  so a short password falls quickly.

If the data needs real protection, restrict who can reach the VesnALIA server
(`ALIA_SERVER_BIND_HOST`) and who can read its data directory. Treat this plugin
as a lock on the door of a room with open windows.
