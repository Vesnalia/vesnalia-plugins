---
title: Gotchas
type: gotchas
created: 2026-10-11
updated: 2026-10-11
status: active
confidence: medium
tags: [gotchas, dispatch, operations]
sources:
  - server.ts
  - core.ts
  - prompts.ts
  - audit.ts
  - new-chat.tsx
  - store.ts
  - components/ui/responsive-overlay.tsx
  - app.tsx
  - composer-toggle.tsx
---
# Gotchas

TL;DR: MoA holds messages at BB’s dispatch boundary, but BB can still bypass the wait. A long-wait threshold is informational, persisted state is not automatically pruned, and advisor role restrictions are instructions rather than an operating-system sandbox. (server.ts:113-153, server.ts:229-255, prompts.ts:4-5)

## Critical

### Send now can bypass consultation

**Problem:** If BB dispatches a queued message without the MoA reference, the run is recorded as `bypassed` and active advisor work is stopped. (server.ts:527-533)
**Risk:** The acting model may answer without either advisor reviewing the request. (server.ts:527-533)
**Workaround:** Treat `bypassed` as a distinct outcome in history; retry only when the message remains queued and the run is failed. (server.ts:419-429)

`server.ts:527-533`

## High

### Advisor read-only rules are prompt instructions

**Problem:** `ADVISOR_PROMPT` prohibits edits, installs, configuration changes, tests, and unrelated services, but the restriction is expressed as role instructions. Provider permissions are inherited from the original message. (prompts.ts:2-9, server.ts:209-218)
**Risk:** The prompt itself does not create an operating-system sandbox; the worker’s effective tools depend on BB and provider permissions.
**Workaround:** Preserve the originating permission mode and inspect actual session activity for evidence of reads or actions. (server.ts:209-218, audit.ts:53-70)

`prompts.ts:2-9`

## Medium

### Timeout is an overdue notice, not an automatic stop

**Problem:** The coordinator sets `overdue` after the configured elapsed threshold and continues polling active work. It fails only on explicit errors or an idle worker without a fresh answer after the threshold. (server.ts:229-255)
**Risk:** A silent but active provider request can keep the queue held beyond the threshold.
**Workaround:** Use explicit cancellation, disable MoA, or inspect the advisor session; do not infer failure from silence alone. (server.ts:268-272, server.ts:523-526)

`server.ts:229-255`

### Persisted documents have no pruning job

**Problem:** `documents` stores configs, runs, links, drafts, and sessions. Listing is capped at 100 rows, but no retention cleanup is registered; archive/delete stops and archives worker threads without deleting the records. (store.ts:27-32, server.ts:534-539)
**Risk:** Historical documents remain in plugin storage after a chat’s workers are archived.
**Workaround:** Do not treat the list cap as a retention policy. Storage cleanup would require an explicit implementation and migration-safe policy.

`store.ts:12-32`

## Low

### Compact composer triggers open on click

**Problem:** The compact viewport trigger blurs the keyboard and toggles the overlay from its click handler. (components/ui/responsive-overlay.tsx:178-186)
**Risk:** Replacing it with a nested or mouse-down controlled button can lose the first tap on mobile.
**Workaround:** Keep the composer control inside BB’s dialog trigger path and verify compact-device behavior when changing it. (app.tsx:109-123, composer-toggle.tsx:5-32)

`components/ui/responsive-overlay.tsx:157-225`

<!-- lane-pilot:backlinks -->
## Referenced by

- [Mixture of Agents overview](overview.md)
