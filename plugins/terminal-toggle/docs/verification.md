# Verification

Date: 2026-11-01. VesnALIA 0.48.1, Plugin SDK 0.6.104, Node 26.0.0. Audited VesnALIA source: `e003e9510cbfd3bb6c26a28630b46ffb1c242a44`.

## Automated checks

- `npm run typecheck`: passed.
- `npm test`: 48 tests passed across four files.
- `npm run build`: passed; generated server/frontend bundles and SDK metadata.
- `alia plugin types --check`: host and package pin both 0.6.104.
- Dependency installation/audit: zero reported vulnerabilities after updating the test runner.
- Package inventory: source, generated bundles, README, license, skill and this verification record; research notes excluded.

The React tests use actual React DOM, exercising committed-branch lookup after DOM reuse and prop changes. Other tests cover opening/hiding/fallback, a disappeared tab, failures, serialization, disposal, context changes, late completion after a hide, inactive-document history, physical-key matching, rebinding, repeat/IME, modal/browser suppression, and declined dispatch.

## Real-host checks

The plugin was installed from the project directory and exercised against the running VesnALIA server through its actual frontend in a local headless Chrome session on the Mac. Terminal rendering used VesnALIA's own xterm and native daemon-backed shell sessions. This was not a mocked terminal or a custom terminal renderer.

The UI driver sent trusted browser keyboard/mouse input. It used an external, temporary copy of the metadata adapter for assertions, read only known test draft/attachment content, and issued test commands only into test-created shells. Test-only scripts are local scratch material and are not part of the production plugin. The plugin itself never sends shell input or intercepts requests.

| Scenario                                                          | Result                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No terminal tabs, Ctrl+backtick from composer                     | One ordinary shell was created in the current thread environment; xterm input received focus.                     |
| Ctrl+backtick from xterm                                          | Whole panel hid; primary composer received focus.                                                                 |
| Existing terminal hide/show                                       | Same terminal ID; no additional shell.                                                                            |
| Eight quick presses while creating                                | One shell; no queued surprise hide; the next press after readiness hid it.                                        |
| Second terminal focused, hide/show                                | Returned to that second terminal.                                                                                 |
| Composer click, then mouse refocus of already selected terminal   | Last-focus history updated without any tab-selection change.                                                      |
| Terminal remains selected while composer is focused               | Next invocation focused terminal rather than hiding panel.                                                        |
| File tab selected after terminal use                              | Returned to remembered terminal; no new session.                                                                  |
| Remembered terminal manually closed                               | Fell back to first remaining terminal; no replacement shell.                                                      |
| Two chat panes with shared right panel                            | Creation, remembered terminal and return composer matched active pane/thread.                                     |
| Creation request delayed, then New thread opened                  | Completed creation left shell in original thread; no terminal appeared and no focus was stolen on the new screen. |
| Draft plus text attachment                                        | Both unchanged after toggles; test draft/attachment removed afterward.                                            |
| Foreground `sleep 5; printf done > <test-file>` through hide/show | Marker appeared after completion; terminal ID remained the same.                                                  |
| Plugin disabled                                                   | Effective shortcut disappeared; native shell remained running.                                                    |
| Plugin re-enabled/reloaded                                        | Toggle worked without duplicate execution; native sessions retained.                                              |
| Temporary binding Ctrl+Shift+Y                                    | Opened from composer and hid from xterm; the override was reset afterward.                                        |
| Ctrl+Shift+backtick                                               | Did not toggle.                                                                                                   |
| Trusted physical Backquote with Russian `key` value via CDP       | Toggled; this tests event matching, not an OS keyboard-layout switch.                                             |
| Trusted repeated keydown via CDP                                  | Did not toggle.                                                                                                   |
| Quick palette already open                                        | Ctrl+backtick left the palette open.                                                                              |
| Palette command selected by its title                             | Palette closed; terminal input received focus.                                                                    |

Manual close operations were test setup/cleanup on test-created shells. Production toggle code contains no tab-close or session-close call. The temporary secondary chat pane was closed and the research thread's original archived state restored. A test-created ordinary terminal remains available in the development thread.

## Remaining evidence and release limits

- **Native macOS desktop acceptance is incomplete.** Computer Use failed twice to start its native service. Native window keyboard delivery, native embedded-browser focus, and app-deactivation behavior were not verified. Headless frontend success is not presented as a desktop check.
- An actual English/Russian OS layout switch was not performed. Trusted CDP input with `code=Backquote`, `key=ё` passed the physical-key path.
- IME and embedded-browser/modal guards have unit coverage; actual OS IME composition and native embedded-page delivery remain untested.
- Two chat panes/shared panel were tested; secondary-panel split groups, same-thread duplicate chat panes, and mouse tab reordering still require native acceptance. The implementation uses the public flat order as designed; current-order/closed-tab fallback has unit coverage.
- Caret restoration, mentions, and all attachment kinds have not been exhaustively checked. The implementation only calls the existing focus operation and never rewrites draft contents.
- New thread has no toggle command in this implementation. The asynchronous context-change test used New thread only as the destination that must retain focus.
- Private React/alia structures remain a maintenance dependency, even though the tested host resolved them correctly. The VesnALIA application version is unrestricted; SDK compatibility uses a range and runtime failures are reported. Structural validation cannot prove that unchanged method signatures retain their semantics.
- Additional Grok review was attempted under the project's standing permission, but the installed CLI was not signed in; no review result is claimed.

The original public-focus-API blocker is bypassed experimentally by the implemented private adapter. Native desktop acceptance and the remaining cases above prevent claiming full marketplace release readiness. No marketplace publication or remote push was performed.

## Initial-commit review corrections

The focus wait loop now resolves one host snapshot per iteration and exits before another scan when the existing `focusin` observer confirms completion. A bounded-clock regression test checks the exact number of observations, including timeout handling.

The actual capture listener checks the effective host shortcut, including keys without Control/Meta/Alt. Its command-provider lookup stops before traversing the transcript; unrelated keys do not resolve the full surface/composer snapshot. Window-listener regressions cover F6 and Shift+F6. Both bindings were also exercised against real xterm in the local browser frontend, then reset.

## Runtime compatibility instead of an application-version pin

The VesnALIA engine equality constraint was removed. The runtime SDK engine is `>=0.6.104 <1`; the build dependency remains reproducibly pinned. Failure-injection regressions cover missing keyboard, panel/composer contracts, changed terminal input markup, malformed panel tabs, bindings and create results. Missing private discovery no longer hides the palette command in thread contexts or silently swallows a shortcut failure. A diagnostic code identifies the failed component, automatic repeated reports are deduplicated, and explicit retries can show the error again.

A real-frontend fault-injection check temporarily made the native panel's `close` method unavailable in the isolated test browser. Ctrl+backtick displayed `TT_PANEL` identifying the missing `close` method and suggesting a plugin update. Terminal IDs and panel visibility were unchanged. The method was restored in a `finally` block; the normal terminal/composer round trip then passed. Installed VesnALIA was still 0.48.1; no newer app release is claimed tested.

The compatibility review added regressions for an unrelated nested `capabilities.panel` and for focus in an ordinary textarea. Surface discovery now follows the primary composer's committed navigation-context owner before validating its methods. Terminal-like classification requires native terminal ownership or xterm markup. Both regressions failed before the corrections and pass afterward. The real-frontend missing-panel-method diagnostic and normal toggle after restoration were rerun successfully with the new ownership resolver.
