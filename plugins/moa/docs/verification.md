---
title: Verification
type: gaps
created: 2026-09-13
updated: 2026-10-11
status: active
confidence: medium
tags: [verification, beta, checks]
sources:
  - tests/app.test.tsx
  - tests/server.test.ts
  - app.tsx
  - new-chat.tsx
  - components/ui/dialog.tsx
  - components/ui/responsive-overlay.tsx
  - components/ui/icon.tsx
  - package.json
---
# Verification

TL;DR: This page records earlier local and live verification. The current source also contains regression coverage for the new-chat draft path, composer controls, and language settings; no new test run is asserted by this refresh. (tests/app.test.tsx:47-80, tests/app.test.tsx:118-151)

## Verification records

### 0.1.0-beta.1

Checked on 2026-09-13 with VesnALIA 0.43.1, Plugin SDK 0.4.87 and Node on macOS arm64.

## Automated checks

- `npm run check`: TypeScript, all 20 tests and server/frontend bundles passed.
- `alia plugin types --check`: installed SDK pin matches 0.4.87.
- Clean source copy: `npm ci --omit=dev` followed by `alia plugin build` passed. Git installations can build without development dependencies.
- Package allowlist includes bundles and compatibility metadata, original prompts, skill, license and documentation. Tests, node_modules and private chat artifacts are excluded.

The official SDK harness tests dispatch gating, forged markers, recursion prevention, session reuse, role reversal, failure handling, stale edits, cancellation/bypass, off-mode cleanup, durable reload state, explicit retry, per-chat FIFO, and frontend toggling/error feedback. An early bypass cancellation race was found and fixed; the regression now passes. A reload test initially needed its fake-host SDK stubs restored after reload; that fixture was corrected.

## Live checks

A hidden, isolated chat used Codex Luna/Sol with low reasoning. Seven consultations completed and their private reference blocks appeared in VesnALIA's outbound request events. Main/advisor timelines contained assistant responses and reasoning, with no tool-call items.

- Sol advised Luna; the next question reused the Sol worker.
- Changing the main model to Sol selected Luna as advisor.
- Disabling MoA delivered the next message normally, with no reference block.
- Re-enabling reused the advisor and supplied the intervening conversation.
- Browser composer submissions verified the checkbox and user-message delivery.
- A user correction made with MoA off was remembered by both advisor and main agent after re-enabling, then again after plugin reload. The same advisor thread was reused.
- Russian desktop settings rendered with the native model picker and optional CLI Agents catalog. Test workers were stopped and archived after verification.

One earlier probe sent a fact change through `alia thread tell`, which VesnALIA labels as an **agent** message. After reload the main model returned the original user's fact despite receiving the advisor's updated fact. The outbound event confirmed correct delivery. Repeating the scenario using actual browser **user** submissions passed before and after reload, without a code change. The exact model decision in the earlier probe is not established; MoA does not guarantee agreement or factual accuracy.

## Remaining scope

Other providers and actual native-profile execution need separate live validation. No compact-device live interaction check is recorded here. The settings control uses VesnALIA's dialog trigger, which selects `MobileTrigger` for compact viewports and toggles on click. (components/ui/dialog.tsx:107-146, components/ui/responsive-overlay.tsx:108-125, components/ui/responsive-overlay.tsx:157-225)

The build printed an unrelated existing custom ACP configuration warning on the test host, while returning success and generating all bundles. This plugin does not alter ACP configuration.

These records describe a local beta, not marketplace acceptance or compatibility with future VesnALIA versions.

## 0.1.0-beta.2 — first-message support

Checked on 2026-09-13: TypeScript, 27 tests and build passed. Added coverage for
new-composer selection with attachments preserved, binding configuration before
first dispatch, another project/token-free draft isolation, retaining the worker
after main provisioning, defaults without a project source, and disabling MoA
when the first workspace is unavailable. Draft tokens are persisted and scoped
to the receiving chat; a retried initial marker cannot re-enable a disabled mode.

In a real browser, the new-chat checkbox opened the model-pair dialog and added
its MoA mention to the draft. The first user request remained queued while the
advisor ran; its private advice was present in the main model's first outbound
request. The main model replied FIRST-READY. A user follow-up reused the same
advisor and both answered COBALT. The checkbox remained enabled in the created
chat. Browser computed styles confirmed a 12 px checkbox and 12 px label.

The initial live attempt failed because VesnALIA permits personal workspaces only in
the personal project. This was corrected to use the standard project's source
on the actual submission host; the original queued first request then succeeded
on explicit retry. These initial failures remain in the consultation history.
No main turn was dispatched before successful consultation. Test chats were
stopped and archived afterward.

First-message native-profile execution and creating a new machine are outside
this beta's verified scope. The first advisor uses a source checkout and text
context, while the main agent keeps the user's requested workspace. No separate
worktree is created just for the advisor.


## Beta.3 — shared settings, hidden marker and long consultations (2026-09-13)

Typecheck, build and 34 tests pass on VesnALIA 0.43.1 / SDK 0.4.87. New cases cover cross-chat/project model/profile sharing with independent enable flags, older draft binding to current shared settings, first-message profile routing, invalidation of another chat's ready advice, and content-script isolation/disposal.

Using a controlled clock, a silent active advisor stayed running after 2041 seconds and its eventual answer passed the delivery gate. A pending advisor stayed running after 3600 seconds and could still be cancelled by disabling MoA. Saving only the notice threshold did not stop or replace the running advisor. These are deterministic lifecycle simulations, not 34/60-minute live provider calls.

An initial new sharing test expected role reversal when swapping both slots; that expectation was incorrect because the main model also changed its matching slot. The test now changes the native profile and verifies actual consultation invalidation/replacement. Earlier failure evidence is retained in the task history.

The live path installation was reloaded only after the plugin-held queue was empty. Four existing chats across projects returned the same selected models/efforts, retaining their different enable flags. In a real new-chat composer, saved shared models appeared, enabling retained the structured draft mention while both its native chip and wrapper had display:none. Browser screenshot inspection confirmed the checkbox remained visible with no chip in the text field. No model request was submitted for this UI check.

Native profile first-message routing is covered by the SDK harness, not a live profile invocation. Native VesnALIA runtime state and event timestamps are observations, not proof that a remote provider is making useful progress. MoA's threshold no longer cancels active work; ALIA/provider watchdogs and explicit user actions retain their separate behavior.

## Beta.4–5 corrections and current verification

The first live history modal returned HTTP 400 because it requested 500 events at once. Corrected to pagination of at most 100 events per API call (up to 500 outgoing requests); a regression test enforces the page size and continuation cursor. The expanded model-status badge was rejected during UI review and removed; the remaining Workflow action is underneath verified user messages.

Beta.5 changes the original one-advisor scheme to two independent participants, followed by the acting chat model. Old runs remain marked historical, with one actual advisor. Both settings history and the audit modal use native Markdown; legacy JSON advice is decoded for display.

`npm run check`: **49 tests passed**, TypeScript and frontend/backend bundles passed. SDK pin check: 0.4.87 matches the host. Tests cover concurrent A/B start, no early delivery after only one answer, reuse of both sessions, preserved ready peer on retry, reserve success/failure, no automatic retry loop, explicit one-answer continuation, both-failed hold, manual replacement of only the silent participant, cancellation/bypass, ignored legacy profiles, and event-history pagination. Clock tests cover active 2041-second and pending 3600-second waits without automatic cancellation. Native profile injection was removed from production code; legacy selections are normalized to null.

A live isolated Grok 4.6 high + Gemini 3.8 Flash high consultation started both outgoing requests before either answer completed. Participant elapsed times were 20.132 and 16.563 seconds; the full consultation took 20.817 seconds. The recorded outgoing request of the acting Codex Luna chat contained both exact answers. No CLI Agents selection marker was present. This verifies actual routing and delivery, not merely the coordinator's status. Provider failure fallback is verified with controlled SDK simulations; no live provider outage was induced.

Browser verification on VesnALIA 0.43.1: settings show the fallback policy in the existing modal, reserve picker appears when selected, save is disabled until a reserve is explicitly chosen, and native profile selectors are absent. Legacy consultation opens without HTTP 400 and renders headings/lists with an explicit one-advisor historical label. The composer retains its compact checkbox/settings controls.

The live two-participant modal showed separate A/B tabs and confirmed actual inputs for both. Expanded delivery payload rendered two model headings and no escaped newline sequences. Both native session tabs displayed the respective real transcript. VesnALIA 0.43.1's embedded timeline also displayed a residual “Working…” footer for an idle worker; the coordinator's runtime state and message-level receipt remained correct. This host-renderer discrepancy is not treated as evidence of current provider activity.

## Beta.6 — optional File Gateway

`npm run check` passed: 54 tests, TypeScript and both bundles. SDK 0.4.87 matches the host. Added tests for absent, disabled, errored, unrelated and running plugin records; discovery failure selects local-only mode. Native File Gateway mentions preserve their original itemId/source reference while unrelated plugin selections and duplicates are excluded. A reused A/B pair receives an updated unavailable policy after gateway removal, without losing session continuity.

MoA uses only the public VesnALIA plugin list and native thread input APIs. File Gateway supplies its own tool/CLI and resolves file references. No gateway imports, fixed host IDs or access-policy changes are introduced. Per-attempt history labels availability separately from actual reads. Gateway access enforcement belongs to the optional plugin; local provider role restrictions are instructions, not an OS sandbox.

Initial live remote-reading test: Gemini issued gateway hosts/read commands and reported the remote file's correct size and headings. Grok waited for manual approval of `alia file-gateway hosts` because MoA still forced `accept-edits`. The test was cancelled and archived, not reported as a successful two-participant run. Fixed worker permissions to inherit the original queued message's mode; a regression test verifies full inheritance and preservation of manual approval mode.

Repeated live test with inherited full mode passed: Grok and Gemini each issued completed `alia file-gateway hosts` and `read` commands against the same remote file and reported its correct 2246-byte size and headings. Both exact notes reached the acting Codex Luna request; consultation elapsed 21.3 seconds. Grok's VesnALIA event included the raw gateway read result; the Antigravity bridge exposed command arguments/status and the final note, but omitted the raw command output. This transport visibility limitation is preserved in the private verification artifact. Native gateway-mention forwarding and plugin absence/removal were verified by SDK tests, without disabling the user's live gateway.

## Current source coverage

The test suite contains an existing composer test for first-message MoA draft selection and marker cleanup, and tests for the language settings section and fallback save control. These are source-level coverage references; this documentation refresh did not execute the suite. (tests/app.test.tsx:47-80, tests/app.test.tsx:118-151)

The settings triggers are wired through the local dialog wrapper. Its compact branch uses `MobileTrigger`; that trigger blurs keyboard input and changes open state from click. (app.tsx:109-123, components/ui/dialog.tsx:107-146, components/ui/responsive-overlay.tsx:157-225)

Icon rendering now includes explicit builtin/custom resolution, lazy extended icon loading, custom-icon error fallback, and a pending marker while an extended icon definition is unavailable. (components/ui/icon.tsx:182-195, components/ui/icon.tsx:227-278, components/ui/icon.tsx:311-339)

## Undocumented areas

The current code and test sources document the compact-trigger path and icon resolution, but this page has no new live device observation for those changes. (tests/app.test.tsx:126-151, components/ui/responsive-overlay.tsx:157-225)

## Open questions

- Compact-device interaction needs a live check; current source wiring alone does not establish device behavior. (components/ui/dialog.tsx:107-146, components/ui/responsive-overlay.tsx:157-225)
- Other providers and native-profile execution remain outside the recorded live checks; see [Remaining scope](#remaining-scope).

## Wiki debt

Historical test counts and environment observations appear in [Verification records](#verification-records); this documentation refresh did not rerun those checks.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Deployment](deployment.md)
- [Mixture of Agents overview](overview.md)
- [Release preparation](releasing.md)
