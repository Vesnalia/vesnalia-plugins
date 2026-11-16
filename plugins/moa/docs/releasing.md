---
title: Release preparation
type: deployment
created: 2026-09-13
updated: 2026-10-11
status: active
confidence: medium
tags: [release, packaging, verification]
sources:
  - package.json
  - README.md
  - docs/verification.md
  - server.ts
---
# Release preparation

TL;DR: Prepare a source release by checking the supported BB/SDK range, running the project checks, inspecting the package allowlist, and verifying behavior in an isolated chat. GitHub release publication and marketplace acceptance are separate actions; see the [verification record](verification.md#remaining-scope). (package.json:5-8, package.json:80-109)

## Prerequisites

- Use a BB version within the package’s declared range and the matching Plugin SDK. (package.json:5-8)
- Confirm the authenticated GitHub account and repository metadata before publishing. (package.json:110-118)
- Use an isolated chat for live checks; the [verification record](verification.md#live-checks) describes the checked scenarios.

## Deploy procedure

1. Set the package version and engine ranges in `package.json`. (package.json:2-8)
2. Run `npm ci`, `npm run check`, and `bb plugin types --check`. (package.json:74-79)
3. Build the plugin and inspect `npm pack --dry-run --json`; confirm the output matches the package file allowlist. (package.json:74-79, package.json:80-109)
4. Commit the source and lockfile in the standalone repository. Include `dist` and generated metadata in npm/release artifacts. Confirm that a source install builds with development dependencies omitted using the [recorded verification notes](verification.md#verification-records). (package.json:80-109)
5. Capture demonstration screenshots from a demonstration workspace only. Keep private chats out of published material; see the [recorded browser checks](verification.md#live-checks).
6. Publish a GitHub release or submit to the Community marketplace only when requested. The [verification record](verification.md#remaining-scope) distinguishes local checks from marketplace acceptance. (package.json:110-118)

## Verify

1. In an isolated chat, check parallel A/B routing, follow-up history, off/on behavior, and that a failed consultation remains queued; use the [recorded verification scenarios](verification.md#verification-records) as a checklist.
2. Check Send now bypass and composer placement against new BB versions. The dispatch hook records a run as `bypassed` when dispatch lacks the MoA reference. (server.ts:527-533)
3. Confirm version, repository, homepage, and issue tracker metadata before publishing. (package.json:2-8, package.json:110-118)

## Rollback

Turn MoA off in affected chats, then disable the plugin or reinstall the last known-good release. Disabling stops active plugin-owned consultation jobs and allows pending work to be released. (server.ts:407-413, server.ts:547-550)

Do not upgrade while a consultation is being delivered. (server.ts:547-550)

## Troubleshooting

- If source installation fails, run `npm ci` and `bb plugin build`; see the [source install quick start](overview.md#quick-start). The package build script runs the BB plugin builder. (package.json:74-79)
- If packaged content includes tests, `node_modules`, or private artifacts, correct the `files` allowlist before publishing. The current allowlist enumerates the published roots. (package.json:80-109)
- If a live consultation fails, inspect its history and retry or turn MoA off. The [verification record](verification.md#verification-records) describes previously checked behavior and remaining scope. (server.ts:419-429)

<!-- lane-pilot:backlinks -->
## Referenced by

- [Deployment](deployment.md)
