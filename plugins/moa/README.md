# Mixture of Agents for VesnALIA

Mixture of Agents (MoA) is a VesnALIA plugin that asks two configured models for independent advice before the chat’s acting model responds. It adds controls for new and existing chats, retry and fallback options, and consultation history.

## Quick start

```sh
npm ci
alia plugin build
alia plugin install . --yes
```

Open the MoA control in a chat composer to choose the two models and enable consultation for that chat. For a new chat, configure MoA before sending the first message.

## Documentation

- [Overview](docs/overview.md) and [architecture](docs/architecture.md)
- [Data model](docs/data-model.md), [gotchas](docs/gotchas.md), and [deployment](docs/deployment.md)
- [Verification notes](docs/verification.md) and [release preparation](docs/releasing.md)
- [Plugin usage skill](skills/moa/SKILL.md)
