---
name: android-emulator
description: Show and control Android emulators on VesnALIA hosts — list AVDs and devices, start or stop an AVD, press back/home/recent, paste text — through VesnALIA android-emulator.
---
UI: thread right panel "+" → Android Emulator, or Android Emulator in VesnALIA navigation.
The user picks the Android host there; commands use that host unless `--host` is given.

- `alia android-emulator hosts --json` — VesnALIA hosts with online status.
- `alia android-emulator list --json` — environment checks, AVDs, running devices, active serial.
- `alia android-emulator start AVD --json` — start an existing AVD headless. It keeps running.
- `alia android-emulator stop SERIAL --json` — shut an emulator down. Only on the user's explicit request: unsaved state may be lost.
- `alia android-emulator key --key back|home|recent [--serial S] --json`.
- `alia android-emulator paste 'Text' [--serial S] --json` — into the focused field, up to 64 KB. Never pass secrets: arguments stay in shell history; the user types them in the panel.

`--serial` defaults to the active device; `--host` takes a host name or id.

For taps, swipes, screenshots, UI dumps and logs use ADB on the Android host
(its terminal or a thread there): `adb -s SERIAL shell input tap X Y`,
`input swipe X1 Y1 X2 Y2 MS`, `exec-out screencap -p`, `shell uiautomator dump`, `logcat`.
Do not run ADB locally when the SDK is on another machine.

Scope: the plugin only checks the Android SDK, ADB, emulator, acceleration and AVDs.
When a check fails, tell the user what to prepare. Installing the SDK, system images
or KVM/WHPX, and creating or editing AVDs are outside the plugin.

Connection setting: VesnALIA network (needs VesnALIA at getbb.app) or LAN / VPN (`ws://` to the host).
