---
name: screenshot
description: Explain the Screenshot plugin's native macOS crosshair and local-only direct message attachments.
---

# Screenshot

Click the camera beside Send, or **+ → Take screenshot**. Drag to select an area
with the native macOS crosshair, then release. The PNG attaches to the original
draft; send the message normally when ready. Escape cancels.

Capture runs only on the Mac displaying VesnALIA. There is no machine selector, saved
remote target, or fallback to another machine. An authenticated loopback probe
verifies the local VesnALIA host before launching capture. This Mac must be connected
to VesnALIA. The site may request local network access for this verification.

The camera becomes a cancel button while busy. Existing text, mentions, and
attachments are preserved. macOS screen recording permission is checked before
selection and may trigger its native permission request. If refused, allow the
application running the VesnALIA host process under System Settings → Privacy & Security
→ Screen & System Audio Recording. macOS may require restarting that process.

PNG uploads are limited to 10 MB. Native selection and temporary local connections
time out after two minutes. Temporary image files are removed after transfer or
failure, with a two-minute fallback cleanup. There are no server-wide settings.
