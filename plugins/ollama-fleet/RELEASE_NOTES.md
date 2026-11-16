# Ollama Fleet v0.6.0

First public beta: local inference routing and observability for VesnALIA.

- Manage multiple Ollama endpoints and inspect health, model inventory, and running-model metadata.
- Recommend and route to a model/server using task fit and configured preferences, with bounded fallback after failure.
- Observe generation jobs through routing, running, and terminal states, including the actual model/server and attempt count.
- Connect optional Agent Board >=0.6.0 for live job and delegated-worker visibility. Fleet remains independently usable.
- Keep observability bounded: at most 20 snapshot rows, 100 terminal plus 20 active persisted jobs, and a 240 KB registry ceiling. Raw prompts, responses, reasoning, credentials, and endpoint URLs are excluded from the public job registry.

Requires VesnALIA >=0.40 and public Plugin SDK >=0.4.21; development types use SDK 0.4.34. Routing heuristics are not model-quality guarantees. Local-only classification is name-based and configurable. Cancellation stops the HTTP request and further fallback but cannot prove remote compute stopped. No token stream or per-attempt history API is exposed.

Install: `alia plugin install git:https://github.com/aaronphifer/bb-plugin-ollama-fleet.git@v0.6.0`

MIT licensed. Report security issues privately through this repository's Security → Report a vulnerability form after publication activation.
