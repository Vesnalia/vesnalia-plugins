---
title: Mixture of Agents for VesnALIA — agent reference
updated: 2026-10-11
sources:
  - package.json
  - app.tsx
  - server.ts
  - contract.ts
  - i18n.ts
  - docs/architecture.md
  - docs/data-model.md
  - docs/gotchas.md
  - docs/deployment.md
---
# Mixture of Agents for VesnALIA — agent reference

## Identity

- VesnALIA plugin: two independent advisor sessions provide private reference context to the acting chat model. See [overview](docs/overview.md).
- Compatibility range and package entry points: [package.json](package.json), [deployment](docs/deployment.md).

## Entry points

- Server hooks, background coordinator, RPC, CLI: [architecture](docs/architecture.md#building-blocks).
- Composer app and existing/new chat control split: [architecture](docs/architecture.md#ui-control-and-rpc).
- Typed RPC inputs/outputs: `contract.ts:55-89`; implementation is indexed in [architecture](docs/architecture.md#ui-control-and-rpc).

## Critical invariants

- Keep A/B independent; deliver advice only as an agent-only reference block. See [architecture invariants](docs/architecture.md#invariants).
- Preserve the queued content/model/config revision check before enrichment. See [architecture invariants](docs/architecture.md#invariants).
- Draft tokens must match the receiving project and thread. See [data model](docs/data-model.md#stored-document-kinds).
- Permission mode comes from the source queued message; see [gotchas](docs/gotchas.md#advisor-read-only-rules-are-prompt-instructions).

## Conventions

- Persist plugin state through `createStore`; document kind and payload lifecycle are in [data model](docs/data-model.md).
- Keep shared model/fallback configuration separate from chat-local `enabled`; see [data model](docs/data-model.md#stored-document-kinds).
- UI copy uses `i18n.ts`; presentation controls route actions through typed RPC. See `app.tsx:61-104` and `i18n.ts:216-255`.

## Common gotchas

- Send now can bypass consultation; timeout is an overdue notice. See [gotchas](docs/gotchas.md).
- Advisor instructions are not an OS sandbox; inspect native worker activity.
- Records have no automatic retention job. See [data model](docs/data-model.md#writers-readers-retention-and-cleanup).

## Useful commands

- Install locally: `npm ci && alia plugin build && alia plugin install . --yes`.
- Verify locally: `npm run check && alia plugin types --check`.
- Chat operations: `alia moa status THREAD_ID --json`, `alia moa on THREAD_ID`, `alia moa off THREAD_ID`, `alia moa retry THREAD_ID RUN_ID`.
- More [deployment and rollback details](docs/deployment.md).

## Where to look next

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Deployment](docs/deployment.md)
- [Verification](docs/verification.md)
