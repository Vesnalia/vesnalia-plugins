---
name: claude-auth
description: Inspect and manage Claude Code CLI authentication, renew expired credentials, and initiate remote or mobile login via VesnALIA. Supports macOS and Linux/WSL. Use when the user asks about Claude authentication, login status, token expiration, daily login expirations, or when Claude Code commands fail with auth errors.
---

# Claude Auth

Inspect and manage Claude Code CLI credentials and remote authentication on macOS and Linux / WSL.

## Tools & Commands

- **Agent Tool `claude_auth_status`**: Inspects whether Claude Code is logged in, token expiration time, and whether a refresh token exists in Keychain or system keyring.
- **Agent Tool `claude_auth_login`**: Starts authentication and puts an interactive login card on screen in the chat composer so the user can authenticate directly from their mobile browser or remote device.
- **CLI `alia claude-auth status [--json]`**: Print current status in terminal.
- **CLI `alia claude-auth login`**: Generate a sign-in URL for browser login and return the session ID.
- **CLI `alia claude-auth submit <sessionId> <code>`**: Submit the OAuth verification code from the sign-in URL to complete authentication from the terminal.
- **CLI `alia claude-auth clean`**: Delete Claude Code credentials from credential store (signs out) and reset dead session flags.

## When to Use

1. When Claude Code or Claude provider agents fail with authentication errors.
2. When the user asks "am I logged into Claude?", "check my Claude login", or wants to log in from their phone via Tailscale.
3. Call `claude_auth_login` so the user can easily tap the link, copy the code from Claude.com, and complete authentication.
