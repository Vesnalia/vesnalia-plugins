# Omarchy Sync for VesnALIA

Keep VesnALIA visually in step with the active [Omarchy](https://omarchy.org) theme. Switch an Omarchy theme and VesnALIA follows automatically—palette, light/dark mode, terminal ANSI colors, code and diff accents, favicon tint, and a motion-aware transition.

## Showcase

[Watch the 36-second Omascreen showcase](https://github.com/salemsayed/bb-plugin-omarchy/releases/download/v0.1.1/showcase.mp4)

| Lupine · light | Tokyo Night · dark |
| --- | --- |
| ![Omarchy Sync following the light Lupine theme](media/lupine-light.png) | ![Omarchy Sync following the dark Tokyo Night theme](media/tokyo-night-dark.png) |

## What it does

- Reads Omarchy's active `colors.toml` through VesnALIA's primary-host daemon.
- Follows `omarchy-theme-set` immediately through an isolated hook, with a native file-watcher fallback.
- Supports both named semantic palettes and `color0`–`color15` palettes (including Oxocarbon), preserving all 16 explicit ANSI colors.
- Handles explicit Omarchy `mode = "light"` / `mode = "dark"`, with a luminance fallback for older themes.
- Offers Off, Subtle, Smooth, and Cinematic transitions and honors `prefers-reduced-motion`.
- Includes a VesnALIA panel with live swatches, sync status, controls, and hook management.

## Desktop, PWA, and mobile behavior

The VesnALIA desktop app and ordinary desktop browser tabs follow Omarchy through a client-only overlay.

Installed PWAs on every platform remain independent, as do Android and iOS browser tabs, tablets, and the native VesnALIA mobile app. Omarchy Sync detects the browser's PWA display mode, mobile browser identifiers (including iPadOS's Mac identity with multitouch), and VesnALIA's Expo/React Native bridge. It does not fetch or inject theme CSS on those clients, and removes any stale overlay from an older plugin generation. They retain VesnALIA's own appearance settings, including the device's light/dark preference when set to follow the system. Mobile browsers that hide all mobile identifiers cannot be distinguished from desktop tabs unless they are installed as a PWA. The plugin also leaves VesnALIA's shared server palette ID unchanged.

## Requirements

- Omarchy with a theme containing `colors.toml`
- VesnALIA 0.41 or newer
- Omarchy running on VesnALIA's primary host

## Install

Once the marketplace listing is live:

```sh
alia plugin install omarchy
```

Directly from GitHub:

```sh
alia plugin install git:https://github.com/salemsayed/bb-plugin-omarchy.git@^0.1.0
alia plugin run omarchy hook install
```

Open **Omarchy Sync** from VesnALIA's navigation panel. The hook is recommended for the fastest switch; the watcher still keeps themes synchronized if the hook is not installed.

## Commands

```sh
alia omarchy status
alia omarchy sync
alia omarchy hook install
alia omarchy hook remove
```

Add `--json` to any command for machine-readable output. The explicit equivalent is `alia plugin run omarchy …`.

## Development

Sync types from the VesnALIA version you are developing against, then validate and build:

```sh
alia plugin types .
npm ci
npm run check
alia plugin build .
alia plugin install . --yes
```

Tests cover Omarchy TOML parsing, light/dark inference, color generation, hook ownership, server behavior, and native/PWA/mobile-browser/desktop-tab client boundaries.

## Privacy and safety

The plugin reads only the active Omarchy theme files on the primary host. It makes no outbound requests and sends no theme data to third parties. The optional hook owns exactly `~/.config/omarchy/hooks/theme-set.d/90-alia-omarchy`; removing it does not touch other Omarchy hooks.

## License

MIT

## Theme host

After moving the VesnALIA server, keep theme synchronization on the Omarchy desktop with `alia omarchy host <host-id> --json`. Use `alia omarchy host auto --json` to follow the primary server again. The selection persists across restarts. A disconnected desktop reports its error and retains the last palette.
