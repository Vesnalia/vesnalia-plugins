# Screenshot for VesnALIA

Click the camera, select an area with the native macOS crosshair, and the PNG
appears in your VesnALIA message. No manual paste or machine selector.

Capture always runs on the Mac displaying VesnALIA. The plugin verifies a temporary,
authenticated loopback connection before launching the screenshot tool. It never
falls back to another machine. This Mac must be connected to VesnALIA; the site may
ask for local network access. The loopback connection expires after two minutes.

macOS screen recording permission is checked before selection. If permission has
not been granted, macOS can display its request. Allow the application running
the VesnALIA host process under System Settings → Privacy & Security → Screen & System
Audio Recording, then restart that process if macOS asks.

Escape cancels. The camera becomes a cancel button while capture is in progress.
Only the selected area is captured. Temporary files are removed after transfer,
with a two-minute expiry for interrupted transfers. Existing draft contents are
preserved. Send normally when ready. PNG limit: 10 MB. Selection timeout: two minutes.

## Install

With VesnALIA installed, run:

```sh
alia plugin install git:https://github.com/strelov1/bb-plugin-screenshot.git@main
```

The plugin installs on your VesnALIA server. Its native helper runs on the connected Mac
where you use VesnALIA, including when the server itself runs elsewhere.

## Development

```sh
npm install --include=dev
npm run typecheck
npm test
npm run build
alia plugin install . --yes
```
