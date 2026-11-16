# Compatibility verification

Verified on 2026-10-23 against VesnALIA `0.47.1-nightly.40028638376.1` and Plugin
SDK `0.6.75`. The development declarations were updated with `alia plugin types`
and `npm install`. The manifest minimums now match this tested host and SDK.
This is a conservative support floor, not a claim that every API first
appeared in these versions. Older hosts were not tested.

The installed declarations define `olderCursor`, `historySnapshot`,
`olderRowsSourceSeqEnd` and optional `olderRowUpdates`, without `hasOlderRows`.
The installed server's snapshot implementation binds the snapshot into the
opaque cursor. The loader forwards both cursor fields unchanged, checks the
snapshot on each response, collects partial older-row updates, and deduplicates
messages before ordering them. A null cursor means history is exhausted.
The 200-page and 500-hit limits still produce `truncated: true` when reached
with history or hits remaining. An incomplete search with no hits is labeled
incomplete in the panel.

The `find` tab remains a flush thread action with the same persisted params
shape. Its palette command keeps id `open` and uses the host command API for
Mod+Shift+F. The former app overlay's navigation call was declined in the
browser check. The command API successfully reopened the tab and focused an
existing instance through the palette without creating a sibling.

## Automated checks

Run from the plugin root:

```sh
npm run check
alia plugin types --check
git diff --check
```

The tests cover older-only matches, unchanged opaque cursor forwarding,
overlapping nested pages, older-row updates, deduplication, message and top-row
ordering, empty pages with cursors, exhausted history, both outcomes at the
200-page boundary, repeated cursors, changed snapshots and the 500-hit cap.
Frontend tests cover restored query params, tab identity, command availability
and shortcut registration, explicit hit selection, incomplete zero-hit status,
highlight cleanup, streamed text repainting, virtual row measurement changes,
and successive history prepends that restore the host's reading position.

## Isolated browser check

The installed server was started on `127.0.0.1:48931` with a fresh
`ALIA_DATA_DIR` under `/tmp`. Only this scratch instance installed and reloaded
the worktree's plugin. Synthetic events were seeded into its database; no
provider or agent was started and no real conversations were changed.
Browser Automation used a local headless Chrome session on the same host.

Observed with a 350-message fixture:

- The first timeline API page contained messages 251 through 350 and a cursor.
- Searching `ancientneedle` found message 5, scanned all 350 messages, and
  returned `truncated: false`.
- Only a small window of timeline rows was mounted. Selecting the old hit
  loaded older history and painted the selected text with a CSS highlight.
- The check exposed two navigation issues: repeatedly bisecting each newly
  prepended page exhausted the seek budget, and row measurements could move a
  selected highlight above the viewport. Seeking now exposes the oldest loaded
  window first, then bisects within loaded history. An explicit jump corrects
  the match position for 800 ms as virtual rows settle. Trusted user input,
  another jump or content-script disposal cancels this work. Subsequent paints
  do not scroll. The existing synthetic wheel scroll claim was retained.
- After settling, the old hit stayed visible at y=304 with `scrollTop=850`
  throughout the sampled interval.
- With `timelinePush` enabled, one synthetic message was appended using the
  installed host's normal `appendThreadEvent` helper in the scratch process.
  A temporary Node loader injected only a file-controlled QA hook into that
  process. Installed host files were unchanged. The new row appeared without
  another timeline fetch, and the old hit remained at y=304 / `scrollTop=850`
  in all ten subsequent samples.
- A new CLI search found matches at sequences 5, 345 and 351 in order, scanned
  351 messages and reported complete results.
- A real Command+Shift+F chord reopened Find. The palette's Chat Search command
  focused the existing Find tab, leaving one tab instance.
- Enter selected the first of three matches; Shift+Enter wrapped to the third.
- Closing Find cleared both highlight sets. The browser session and scratch
  server were stopped after verification.

The screenshot and measurement JSON are attached to the implementing VesnALIA thread
`thr_n6g7nm6gck` in its `chat-search-qa` storage folder.

These checks do not cover the desktop shell, mobile, Windows/Linux keyboard
input, an actual provider streaming session, or restoring saved tabs from an
older VesnALIA installation. Nested partial updates and restored query params are
covered by fixtures rather than a live provider. Seeking retains its existing
bounded history-load and step limits, so a hit can be returned by the backend
even if navigation cannot load enough history to render it in one attempt.
