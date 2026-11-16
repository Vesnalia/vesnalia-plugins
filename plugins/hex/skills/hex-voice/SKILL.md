---
name: hex-voice
description: Manage and troubleshoot local voice transcription in VesnALIA via Hex (`apple_speech` and local GGUF models).
---

# Hex Voice Plugin

This plugin registers the `hex` AI service (`Hex (Apple Speech)`) with VesnALIA for the chat composer's microphone dictation button and `alia voice transcribe <audio-file>`.

## Commands

- Check AI service status:
  ```sh
  alia settings ai-services show
  ```
- Select Hex as VesnALIA's active voice transcription service:
  ```sh
  alia settings ai-services set voice hex
  ```
- Check Hex plugin status and loaded models:
  ```sh
  alia hex status
  ```
- Transcribe an audio file via VesnALIA:
  ```sh
  alia voice transcribe /path/to/audio.wav
  ```
