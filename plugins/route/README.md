# alia-plugin-route

A headless VesnALIA plugin that lets an agent call other agents and models during its turn:

- `route_worker` gives a task to another VesnALIA harness and model. That agent edits the same files.
- `route_ask` asks a model on any OpenAI-compatible API.
- `route_decide` asks a System One decision model (for example TypeSafe Jev) for a typed decision.

The plugin has no preset endpoints, keys, or models. Each tool appears only after you configure it. See [skills/route/SKILL.md](skills/route/SKILL.md) for the settings.

## Quick start

```sh
alia plugin install <path or git URL>
alia plugin config route set workers '[{"name":"cheap","provider":"codex","model":"gpt-5-mini"}]'
alia plugin config route set askBaseUrl https://openrouter.ai/api/v1
alia plugin config route set askApiKey <key>
alia plugin config route set askModels 'fast=openai/gpt-5-mini'
```

Start a new thread to get the tools.

## Develop

```sh
npm install
npm run check   # typecheck
npm test        # unit tests for lib.ts
alia plugin build
```
