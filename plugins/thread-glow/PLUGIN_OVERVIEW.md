## What you get

Thread Glow colours a thread orange when observed work stops, so you can find it in the thread list. When the thread is open in a split view, its pane title uses the same highlight.

Selecting the thread clears its highlight. Starting work again or an error also clears it.

Middle-click the title of an open split pane to close it using VesnALIA's close control. This also works for other pane titles with a close button. The sidebar thread list is unaffected.

## How it works

The plugin observes thread status while the VesnALIA window is open and stores highlights in that client's local storage. It does not reconstruct completion events that happened while the window was closed. A highlight means a transition to idle was observed; check the conversation to confirm the task result.

## Requirements

VesnALIA 0.47 or later. No account, API key, or external service is required. The plugin relies on the current VesnALIA sidebar and split-pane markup, which may change in a future VesnALIA update.
