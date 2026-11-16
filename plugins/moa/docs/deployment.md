---
title: Deployment
type: deployment
created: 2026-10-11
updated: 2026-10-11
status: active
confidence: low
tags: [deployment, installation, release]
sources:
  - package.json
  - README.md
  - docs/releasing.md
  - server.ts
---
# Deployment

TL;DR: Install from the source checkout by installing locked dependencies, building with the VesnALIA CLI, and installing the local plugin. The plugin declares compatibility with VesnALIA `>=0.43.1` and Plugin SDK `>=0.4.87`. (package.json:5-8)

## Prerequisites

- A VesnALIA installation in the declared engine range and its `alia` CLI. (package.json:5-8)
- Node and npm, plus network access to resolve the lockfile dependencies. Follow the [source install quick start](overview.md#quick-start).
- A VesnALIA project with an existing machine and available provider/model pair to enable MoA. First-message bootstrap resolves the host from project sources or VesnALIA’s primary host. (server.ts:442-457)

## Deploy procedure

1. From the plugin checkout, run `npm ci`.
2. Build the server and app bundles with `alia plugin build`.
3. Install the checkout with `alia plugin install . --yes`.
4. In VesnALIA, open the composer’s MoA control and choose two distinct provider/model pairs before enabling the chat. The server validates model availability when enabled. (server.ts:388-405)

For the source install command sequence, see the [quick start](overview.md#quick-start). The plugin manifest points to `server.ts`, `app.tsx`, and the `skills` directory. (package.json:9-19)

## Verify

1. Run `npm run check` to typecheck, run the test suite, and build. (package.json:74-79)
2. Run `alia plugin types --check` as described in [release preparation](releasing.md#verify).
3. In an isolated chat, verify a two-participant consultation, follow-up history, off/on behavior, retry after a failed consultation, and composer behavior; see the [release verification checklist](releasing.md#verify).

See [Verification](verification.md) for the recorded checks and their scope.

## Rollback

1. Turn MoA off in each affected chat using the chat control or `alia moa off THREAD_ID`.
2. Disable the plugin from VesnALIA if the plugin itself must be unloaded; see [release rollback](releasing.md#rollback).
3. Reinstall the last known-good release if a code rollback is required; see [release rollback](releasing.md#rollback).

Disabling or changing settings aborts active plugin-owned consultations and queue stripping restores ordinary input. (server.ts:407-413, server.ts:547-550) For upgrade timing, see [release rollback](releasing.md#rollback).

## Troubleshooting

| Symptom | Check |
|---|---|
| Build or compatibility check fails | Confirm the VesnALIA and SDK versions against `package.json:5-8`; run `npm ci` before rebuilding. |
| A model pair cannot be saved while enabled | Check provider availability, exact model ID, supported reasoning level, A/B uniqueness, and reserve selection. (server.ts:388-405) |
| A message remains queued | Read the run error with `alia moa status THREAD_ID --json`, then retry with `alia moa retry THREAD_ID RUN_ID` or turn MoA off. (server.ts:495-519, server.ts:419-429) |
| An advisor is still running after the notice threshold | Check VesnALIA runtime status and the native worker transcript. The threshold does not stop active work. (server.ts:229-255) |

<!-- lane-pilot:backlinks -->
## Referenced by

- [Mixture of Agents overview](overview.md)
