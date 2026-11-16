# Security policy

Model Pilot 0.4.x targets VesnALIA 0.46 on macOS as an experimental integration.
The plugin starts coding agents with the permissions that VesnALIA grants them.
Treat model output and tool requests according to your normal VesnALIA approval policy.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/MahmoudElsayad/bb-model-pilot/security/advisories/new) when it is available.
If GitHub does not offer private reporting, open a minimal issue that requests a private contact channel.
Do not include the vulnerability details in that public issue.
Never share API keys, account tokens, private conversations, or a working exploit against another person's account.

Include the affected version, affected component, impact, and steps that reproduce the problem in an isolated environment.
The project has no guaranteed response time or paid security support agreement.

## Credential exposure

If a key appears in a public report or recording, revoke it with its provider immediately.
Create a replacement key and update the corresponding VesnALIA plugin setting for that legacy API mode.
Read [PRIVACY.md](PRIVACY.md) for local storage and removal limits.
VesnALIA manages native Codex and Claude Code sign-ins.
If a native account is compromised, revoke its sessions through that provider.
The plugin does not include credits or shared provider accounts.
