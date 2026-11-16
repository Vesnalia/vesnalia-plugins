# alia-plugin-claude-auth

A VesnALIA plugin to inspect and manage Claude Code CLI authentication, renew expired credentials, and perform remote OAuth sign-in on mobile or remote machines via Tailscale. Supports macOS and Linux / WSL.

## Background

When running Claude Code CLI headlessly or accessing VesnALIA remotely on a phone via Tailscale, browser-based OAuth logins cannot open local desktop browsers directly. Furthermore, standard terminal pipes hang because the Claude CLI expects an interactive pseudo-terminal (PTY) to accept the authorization verification code.

This plugin bridges that gap by managing Claude Code CLI authentication directly from VesnALIA:
- Inspects real-time Keychain / secret keyring credentials, expiration timers, and auto-refresh token status.
- Executes headless authentication inside a virtual PTY without hanging.
- Presents the OAuth sign-in link and verification code form in the VesnALIA sidebar and directly inside agent conversation threads.
- Exposes CLI commands and agent tools so assistants can verify login state and trigger authentication when sessions expire.

## Features

- **Sidebar Status & Login Panel**: Open **Claude Auth** from the left navigation bar to check your account email, subscription tier, remaining session TTL, and auto-refresh token health.
- **Remote / Mobile Login**: Tap **Sign In with Claude**, authenticate on your mobile browser, and submit the verification code back to VesnALIA without desktop interaction.
- **Agent Integration**: Exposes `claude_auth_status` and `claude_auth_login` tools so coding agents can inspect auth health or prompt you with an interactive thread card.
- **CLI Commands**: Manage authentication directly from the terminal via `alia claude-auth`.
- **Clean Reset**: Sign out of Claude Code CLI by deleting its credentials and clearing dead OAuth flags with one click.

## CLI Commands

```bash
# Check current authentication status and token expiration
alia claude-auth status
alia claude-auth status --json

# Start a remote login session (prints OAuth URL and session ID)
alia claude-auth login

# Submit the verification code received from Claude sign-in
alia claude-auth submit <sessionId> <code>

# Sign out, delete Claude Code credentials, and clear dead OAuth flags
alia claude-auth clean
```

## Agent Tools

- `claude_auth_status`: Checks whether Claude Code CLI is logged in, the active account and subscription tier, remaining token lifetime, and whether auto-refresh is active.
- `claude_auth_login`: Triggers a login session and displays an interactive verification form directly in the active thread.

## Architecture

- `server.ts`: Backend service registering RPC handlers, agent tools via `alia.agents.registerTool`, and the `alia claude-auth` CLI subcommand. Resolves `python3` from PATH or `PYTHON_BIN`.
- `scripts/pty_auth.py`: Lightweight Python helper utilizing standard library `pty` and native credential storage (`security` on macOS, credentials file and `secret-tool` on Linux) to interact headlessly with the Claude CLI.
- `app.tsx`: React frontend providing a dedicated NavPanel in the VesnALIA sidebar (`ClaudeAuthPage`) and an interactive thread form (`ClaudeAuthInteraction`).
- `skills/claude-auth/SKILL.md`: Skill instructions allowing VesnALIA agents to understand and assist with Claude CLI authentication.

## Development & Build

```bash
# Install dependencies
npm install

# Type check
npx tsc --noEmit

# Build production bundles
alia plugin build

# Install or reload in ALIA
alia plugin install .
alia plugin reload claude-auth
```
