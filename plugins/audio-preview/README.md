# Audio Preview

Plays **audio files in VesnALIA's file panel**.

VesnALIA's built-in preview refuses `audio/mp4` — the MIME type for `.m4a` — so
opening a track shows "Preview not available". This plugin registers as the
opener for common audio extensions and renders an HTML5 player instead.

## What it does

- Opens `.m4a`, `.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`, and other common
  audio files in a playable preview tab.
- Loads a correctly-typed, seekable blob when the file fits VesnALIA's read limit,
  then falls back to VesnALIA's host preview URL for larger files.
- Keeps one playback session alive while you move between threads and file
  tabs in the same VesnALIA window.
- Works for workspace files, absolute host paths, and thread-storage files.
- Nothing else. No settings, no sidebar, no background work.

## Install

From the VesnALIA marketplace:

```bash
alia plugin install audio-preview
```

Or from a local checkout:

```bash
git clone https://github.com/braedonsaunders/bb-plugin-audio-preview.git
cd alia-plugin-audio-preview
npm install --include=dev
alia plugin install . --yes
```

Re-open the audio file, or use **Open with → Audio preview**. If VesnALIA's
built-in preview is still pinned for that extension, change it under
Settings → File openers.

## How it works

VesnALIA's file preview has no audio player. The plugin claims the audio
extensions through `fileOpener` and renders a player tab instead of the
host's "Preview not available" page.

Two transports:

1. `files.read` returns the bytes and the frontend plays a seekable blob with
   the right MIME (`audio/mp4` for `.m4a`).
2. `alia.sdk.files.createPreview` is the fallback for files above VesnALIA's read
   limit. It produces a temporary same-origin URL confined to the host root.

The audio element belongs to the plugin window rather than an individual file
tab, so navigating to another thread does not destroy the current playback
position.

`.mp4` and `.webm` are left to VesnALIA — those containers are often video.

## Compatibility

Requires VesnALIA `>= 0.39` and plugin SDK `>= 0.4.8`. Playback uses the
browser's decoders. AAC-in-MP4 (`.m4a`) works in Chromium and Safari;
some rarer codecs will show a decode error.

## Develop

```bash
npm install --include=dev
npm test
npx tsc --noEmit
alia plugin install .
alia plugin dev
```

## Licence

MIT © Braedon Saunders
