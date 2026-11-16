# Android Emulator for VesnALIA

Watch and control Android emulators that run on your VesnALIA hosts, right inside VesnALIA:
live screen, touch, keyboard, Unicode paste, clipboard sync and system buttons.
Agents get the same controls through `alia android-emulator`.

## How it works

```mermaid
flowchart LR
  P[alia panel in the browser] -- RPC --> S[plugin server]
  S -- host call --> H[host entry on the Android host]
  H -- adb + scrcpy-server --> E[emulator]
  P -- WebSocket: H.264 + input --> H
```

- The plugin server lists your VesnALIA hosts; you pick one in the panel. One device
  stream is active per host.
- The host entry runs inside the VesnALIA host worker. It checks the Android SDK,
  lists AVDs and devices, starts an AVD headless and pushes the bundled
  scrcpy-server 3.3.3 to the device.
- The browser decodes H.264 with WebCodecs and sends touch, keys and text back
  over the same WebSocket. Each connection needs a one-time token (60 s) and the
  panel's exact Origin.
- A session nobody watches for 2 minutes closes. The emulator keeps running
  until you stop it.

## Requirements

On the Android host (Windows or Linux; macOS is untested):

- VesnALIA host enrolled and online.
- Android SDK with `platform-tools` and `emulator`, found through
  `ANDROID_HOME`, `ANDROID_SDK_ROOT` or the default SDK location.
- At least one AVD.
- Hardware acceleration (`emulator -accel-check` passes): WHPX/AEHD on Windows,
  KVM on Linux.

The plugin only checks these. It does not install the SDK, system images or
KVM, and does not create or change AVDs. The panel shows each failed check with
a hint.

In the browser: WebCodecs with H.264 (current Chromium, Firefox or Safari).

## Connection

Settings → Plugins → Android Emulator → Connection:

| Mode | Path | Needs |
| --- | --- | --- |
| VesnALIA network (default) | `wss://…` through `alia connect` shared ports | VesnALIA opened at getbb.app |
| LAN / VPN | `ws://ADDRESS:PORT` straight to the host | Browser reaches the host; Chromium asks for local network access from an HTTPS page |

LAN / VPN uses plain `ws://` on purpose: it is meant for a trusted local or VPN
network. When a host has more than one IPv4 address, add one of them in the
**LAN / VPN addresses** section of the plugin settings (one row per host; edit,
add, or delete rows there); each host uses the one it owns.
**Viewer port** defaults to 6090.

## Agent commands

Commands target the host chosen in the panel unless `--host` is given.
`--serial` defaults to the active device. Every command accepts `--json`.

```sh
alia android-emulator hosts
alia android-emulator list
alia android-emulator start Pixel_6_API_34
alia android-emulator key --key back|home|recent
alia android-emulator paste 'Text for the focused field'
alia android-emulator stop emulator-5554
```

`stop` shuts the emulator down; unsaved state may be lost. Do not pass secrets
through `paste`: arguments stay in shell history. Type them in the panel.

## Install

```sh
alia plugin install git:https://github.com/nicolay-i/bb-plugin-android-emulator.git@host-entry-scrcpy
```

## Development

```sh
npm ci
npm run check   # TypeScript
npm test        # unit tests + i18n dictionaries
npm run build   # alia plugin build
```

On Windows, `alia plugin build` (VesnALIA 0.46.1) fails with
`Cannot find module 'npm/package.json'`. Workaround:

```sh
NODE_PATH="$(npm root -g)" alia plugin build
```

Other scripts:

- `npm run embed:scrcpy-server` — download, verify and embed scrcpy-server.
- `npm run notices` — regenerate `THIRD_PARTY_NOTICES.md` after dependency
  changes.

## License

MIT. Bundled third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); scrcpy-server is Apache-2.0.
