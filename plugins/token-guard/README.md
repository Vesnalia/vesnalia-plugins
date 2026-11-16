# Token Guard

Stops API keys and tokens before they enter a BB thread, and finds the ones already in your agent history.

- **Guard.** A message containing a credential in its text or a BB-uploaded UTF-8 or BOM-marked UTF-16 text attachment is rejected before dispatch to the agent. Attachments are already uploaded to BB before this check. The rejection tells you what was found. Retries are not checked.
- **Scan.** One click on the Token Guard page, or `bb token-guard scan`. It reads Claude Code and Codex history and the BB database on the server machine.
- **Report.** Kind, short fingerprint, counts, last seen, and a link to the revoke page. Values are never shown, logged, or stored. Nothing leaves the machine.

Turn the guard off in Settings → Installed plugins → Token Guard.

## Limits

- Only formats with a distinctive prefix are recognized, so unusual or generic keys pass. This keeps false blocks rare.
- The guard checks BB-uploaded UTF-8 or BOM-marked UTF-16 text files without NUL bytes. Images, PDFs, office documents, archives, other binary files, and absolute runtime file paths are not checked. If an uploaded file cannot be read, dispatch is rejected. Tool output is not checked at dispatch; the scan does cover tool output in history.
- BB's explicit Send-now override for queued messages bypasses dispatch hooks.
- The scan covers the server machine, not other enrolled machines.
