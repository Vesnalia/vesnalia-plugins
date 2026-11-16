---
name: gigaam-voice
description: Check, configure, or troubleshoot VesnALIA voice input served by the GigaAM v3 plugin (VesnALIA gigaam), including its self-managed install and server.
---

# GigaAM voice input

The `gigaam` plugin registers the **GigaAM v3** voice input service. Its host
entry installs GigaAM into the plugin's host data directory on the VesnALIA server's
machine (uv, Python 3.12, CPU PyTorch, model checkpoints). It runs the model
as a loopback HTTP server and restarts that server when needed.

## Check and operate

```sh
alia gigaam status            # phase: installing | starting | ready | failed | unsupported
alia gigaam logs --lines 80   # install.log and server.log tails
alia gigaam restart           # reload the model
alia gigaam reinstall         # rebuild the Python environment (takes minutes)
alia settings ai-services show
alia settings ai-services set voice gigaam
alia voice transcribe <audio-file>   # end-to-end test through alia
```

`restart` and `reinstall` return at once. Poll `alia gigaam status` until it
reports `ready` or `failed`.

The managed decoder reads complete uploads through a private seekable temporary
file and removes it after decoding. This supports MP4/M4A with metadata after
audio data. Decode failures log only container, MIME type, byte count and bounded
ffmpeg diagnostics; recordings are not retained. An incomplete recording cannot
be repaired by retrying the same bytes: save it through VesnALIA's Download recording
action for diagnosis, then record again. Never report a damaged file as an empty
successful transcript.

## Settings

`alia plugin config gigaam set <key> <value>`:

- `model`: `v3_e2e_rnnt` (default, punctuation), `v3_e2e_ctc` (faster), or
  `v3_rnnt` / `v3_ctc` (no punctuation). A new model downloads about 450 MB
  on first use.
- `threads`: CPU threads; `0` uses half the cores, at most 8.
- `serverUrl`: an external OpenAI-compatible `/v1/audio/transcriptions`
  server. When set, the plugin stops managing a local install, and
  `restart` / `reinstall` refuse to run.

## Constraints

- The model recognizes Russian only. VesnALIA's vocabulary hint is ignored.
- The managed server needs Linux (x64 or arm64) or macOS on Apple silicon,
  about 2 GB of disk, and 1.5 GB of RAM.
- Recordings must be 20 MB or smaller. Audio over 20 s is split at pauses.
  Recognition takes about 7 s of CPU time per minute of audio.
- A failed install retries on its own with backoff, up to one hour.
  `alia gigaam reinstall` retries at once.
- `alia plugin remove gigaam` does not delete the downloaded environment.
  Delete the `Data dir` from `alia gigaam status` to free the space.
