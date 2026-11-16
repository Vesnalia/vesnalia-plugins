# Security policy

## Supported versions

The current 0.2.x release line receives security updates.

## Report a vulnerability

Report sensitive vulnerabilities through [GitHub private vulnerability reporting](https://github.com/mpiv-ai/noted/security/advisories/new). Do not disclose a vulnerability in a public issue, discussion, or pull request.

## Trust and data boundary

VesnALIA plugins run with full trust. Noted reads only artifacts and assets that the user opens. It stores sessions, revisions, and feedback in ALIA-managed SQLite. Noted writes exports only to the destination passed to `alia noted file --to`. It sends feedback to the selected VesnALIA thread and adds no independent telemetry.
