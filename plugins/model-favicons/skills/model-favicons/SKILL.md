---
name: model-favicons
description: Set or change the icon bb draws for an agent provider, in particular ACP agents that bb shows with the generic Toolbox mark. Use when the user wants a custom favicon/logo for a model or provider, wants two ACP agents to look different, or asks which icons are available.
---

# Model favicons

bb draws **one icon per provider**, never per model: `availableModelSchema` carries no
icon field, so every model row in a picker inherits its provider's logo. This plugin
sets the mark for a **provider id**.

bb's own provider-acp plugin ships a logo for its 41 registry agents and for
`cursor`, `opencode`, `grok` and `hermes-agent`. Every other agent — the ones added
with `bb acp add` or the ACP plugin's `customAgents` setting — falls back to the
generic **Toolbox** glyph, which is why custom agents look identical in every list.

## Commands

| Command | Effect |
| --- | --- |
| `bb model-favicons list` | Show every override as `provider-id  mark`. |
| `bb model-favicons set <provider-id> <mark>` | Draw `mark` for that provider. |
| `bb model-favicons reset <provider-id>` | Drop the override; the provider keeps bb's own logo. |

Add `--json` to any command when the output drives code.

## Marks

| Mark | Agent |
| --- | --- |
| `glm` | Z.ai / GLM |
| `kimi` | Kimi (the official KIMI "K only" mark) |
| `minimax-code` | MiniMax Code |
| `opencode` | OpenCode |
| `qwen-code` | Qwen Code |
| `claude` | Claude |
| `codex` | Codex |
| `gemini` | Gemini |
| `agent` | A neutral agent mark, for a custom agent with no vendor logo. |

## Procedure

1. Find the provider id first — never guess it:
   `bb provider list --json` and read the `id` field. An ACP agent registered as
   `zcode` is the provider `acp-zcode`; the prefix is `acp-`.
2. Check the current state: `bb model-favicons list`.
3. Apply the mark: `bb model-favicons set acp-zcode glm`.
4. Tell the user the change is live — the icon updates in place, no reload needed.
   If it does not appear, ask them to reload the BB window.

## Rules

- Change icons only through `bb model-favicons`. Do not edit bb.db or the plugin's
  storage directly.
- Use the provider id from `bb provider list --json`. A wrong id silently does
  nothing, so verify the id before setting.
- Prefer the vendor's own mark. Use `agent` only when the agent has no vendor mark.
- Do not set a mark on a provider that already shows the right logo; leave it alone.
