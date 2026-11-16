---
title: Mixture of Agents overview
type: overview
created: 2026-10-11
updated: 2026-10-11
status: active
confidence: medium
tags: [overview, alia-plugin, moa]
sources:
  - package.json
  - server.ts
  - app.tsx
  - contract.ts
  - core.ts
  - store.ts
  - i18n.ts
  - new-chat.tsx
  - prompts.ts
  - file-access.ts
---
# Mixture of Agents overview

TL;DR: MoA is a VesnALIA plugin that asks two independent advisor sessions to analyze a queued user message, then attaches their answers as private context for the chat’s acting model. Consultation state and controls are stored by the plugin; VesnALIA owns the chat queue, worker threads, providers, and final response. (server.ts:27-33, server.ts:297-323, core.ts:23-28)

## What it is

MoA adds a composer control to new-thread and existing-thread scopes. In an existing chat, a user selects two advisor models, shared fallback settings, and a per-chat enabled state. In a new chat, the user binds a configuration token to the draft so the first message can be gated before the regular workspace is ready. (app.tsx:171-195, new-chat.tsx:11-22, server.ts:459-476)

When an enabled chat receives a user message, VesnALIA queues it and MoA holds dispatch. Its background service starts two advisor attempts independently, collects the available responses, and adds an agent-only reference block to the queued input before asking VesnALIA to recheck dispatch. The acting chat model remains responsible for the user-facing answer. (server.ts:113-153, server.ts:297-323, prompts.ts:22-23)

The plugin also provides a consultation audit modal, a CLI for chat state and retry, English/Russian interface strings, and optional read-only file access through the separately installed File Gateway plugin. (app.tsx:171-191, server.ts:495-521, i18n.ts:216-255, file-access.ts:4-27)

## Stack

- VesnALIA Plugin SDK 0.4.87; VesnALIA compatibility range `>=0.43.1`. (package.json:5-8, package.json:28-30)
- TypeScript 5.7, React 19 types, and Zod 4. (package.json:21-27, package.json:28-37)
- Radix UI primitives, Hugeicons, and Tailwind class utilities for the plugin UI. (package.json:21-26, package.json:38-53)
- VesnALIA plugin storage backed by SQLite for durable plugin documents. (store.ts:12-17)

## Quick start

```sh
npm ci
alia plugin build
alia plugin install . --yes
```

Open a chat composer’s MoA control, select different A/B provider-model pairs, and enable MoA for that chat. For the first message in a new chat, configure the pair in the new-chat composer before sending. (new-chat.tsx:55-68, app.tsx:93-104)

## Where to look next

- [Architecture](architecture.md) explains dispatch, participant work, references, UI entry points, and registered RPC methods.
- [Data model](data-model.md) explains persisted plugin documents and their lifecycle.
- [Gotchas](gotchas.md) lists bypass, permission, and long-wait behaviors that affect operation.
- [Deployment](deployment.md) covers installation, verification commands, and rollback.
- [Verification](verification.md) records checked behavior and the limits of those checks.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Deployment](deployment.md)
- [Release preparation](releasing.md)
