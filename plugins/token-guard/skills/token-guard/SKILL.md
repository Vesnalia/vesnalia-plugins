---
name: token-guard
description: Check whether API keys or tokens were pasted into agent history with `bb token-guard`, and explain a message rejected by Token Guard.
---

# Token Guard

`bb token-guard scan` looks through Claude Code, Codex and BB history on the server machine. `bb token-guard status` shows the last report. Reports contain the kind, a short fingerprint and counts, never the value.

The dispatch guard checks message text and BB-uploaded UTF-8 or BOM-marked UTF-16 text attachments without NUL bytes. The attachment is already stored by BB before this check. It does not check images, binary documents, absolute runtime paths, or tool output; BB's Send-now override bypasses the hook. An unreadable uploaded file blocks dispatch.

When a message is rejected because it contains a credential, do not ask the user to resend it. Request it through the `secrets` skill, and tell them to revoke the one they tried to send if it ever reached a chat.

Never print a credential while investigating.
