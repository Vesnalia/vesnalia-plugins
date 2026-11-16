# alia-plugin-linear-card

Shows the Linear card behind each VesnALIA thread in the thread header, in the projects
switched on under Settings → Plugins → Linear Card → Projects.

- **Card linked or detected**: the chip shows the Linear logo, issue id, and title
  (an AI short label when the title is long). Click it for the description (with
  Linear attachments), Open in Linear, Change card, and Unlink.
- **No card**: the chip reads "No Linear card". Click it to browse your assigned
  Linear issues for the project's team and link one to the chat.

A thread's card is the explicitly linked issue (thread plugin metadata), else the
issue named by its git branch (`daniel/tra-123-…`). Unlinking also disables branch
detection for that thread.

## Setup

```sh
npm install --include=dev
alia plugin install .
alia plugin config linear-card set apiKey <linear-personal-api-key>
# then turn on projects under Settings → Plugins → Linear Card → Projects
```

Short titles use Claude Haiku through the Account Pooler on this machine.

## Files

- `server.ts`: Linear GraphQL client, RPC (`thread_card`, `link_card`,
  `unlink_card`, `issue_detail`, `explorer`), short-title summaries, and the
  `GET /upload` attachment proxy.
- `app.tsx`: the thread header chip, card dialog, and explorer.
- `skills/linear-card/SKILL.md`: agent-facing notes.
