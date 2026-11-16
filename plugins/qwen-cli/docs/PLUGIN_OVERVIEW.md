## Qwen CLI

Use your installed Qwen Code CLI as an ACP agent in VesnALIA.

### How it works

The plugin launches `qwen --acp` through VesnALIA's shared ACP bridge. Your existing Qwen sign-in, models, and tools are available without extra configuration. The ACP dialect maps Qwen's tools (run_command, read_file, write_file, edit, grep_search, web_fetch, and more) to VesnALIA's rich timeline presentation with icons, labels, and progress.

### Features

- Native Qwen Code models and reasoning levels
- Plan mode via composer or `--prompt-mode plan`
- Auto-approve permission requests in Accept edits mode
- Sandbox support (`--sandbox`)
- ALIA-native delegation (disable Qwen subagents, use `alia thread spawn`)
- Command descriptions (human-readable tool summaries)

### Requirements

- Qwen Code CLI installed: `npm install -g @qwen-code/qwen-code@latest`
- Signed in via `qwen` → `/auth`, or `OPENAI_API_KEY` + `OPENAI_BASE_URL` for CI

### Install

```sh
alia plugin install github:ols-md/alia-plugin-qwen-cli
```