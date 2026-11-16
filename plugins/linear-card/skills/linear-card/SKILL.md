---
name: linear-card
description: Explain, configure, or troubleshoot the Linear Card plugin, which shows each thread's Linear issue in the thread header.
---

# Linear Card

In enabled projects, a chip in the thread header shows the Linear logo, the thread's
issue id, and its title (an AI short label from Claude Haiku via the Account Pooler when
the title is over 40 characters). Clicking it opens the card: description (Linear
attachments load through the plugin's authenticated `/upload` proxy), Open in Linear,
Change card, Unlink. With no card, the chip reads "No Linear card" and opens an explorer
of the viewer's assigned issues, grouped by state, with search, a Linear-project filter,
and a "Show done" toggle. Expanding a row shows the description and "Link to this chat".

State icons follow Linear: dashed circle = backlog, empty = todo/triage, half-filled =
in progress, check = done, cross = canceled; the color is the team's color for that
exact state (for example QA is orange in TRA).

## How a thread gets its card

1. An explicit link, stored in the thread's plugin metadata namespace `linear-card`
   as `{ "identifier": "TRA-123" }`.
2. Otherwise the environment's git branch: the first `KEY-123` whose `KEY` is a real
   Linear team key (Linear branch names such as `daniel/tra-123-title` match).
3. Unlink writes `{ "unlinked": true }`, which also stops branch detection.

## Settings

- `apiKey` (secret): Linear personal API key. Set with
  `alia plugin config linear-card set apiKey <key>`.
- **Projects** (settings page section): one checkbox per VesnALIA project. The chip appears
  only in checked projects. Stored as project ids in plugin kv (`enabled-projects`).

The explorer's Linear team is remembered per VesnALIA project; a workspace with one team
uses it automatically.
