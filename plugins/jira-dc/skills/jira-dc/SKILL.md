---
name: jira-dc
description: Read and change Jira Data Center issues with the jira_dc_* agent tools and `alia jira-dc` — search with JQL, read an issue with its comments, create, edit fields, move status, comment, assign, or delete. Use when the user mentions a Jira issue key (PROJ-123), asks what is assigned to them, or wants work reflected back into Jira DC.
---

# Jira Data Center

## Setup

Plugin settings (server-side):

- **Jira base URL** — e.g. `https://jira.company.com`
- **Personal Access Token** — Profile → Personal Access Tokens (Jira 8.14+)

Link a VesnALIA project: `alia jira-dc link PROJ` (or the Links UI in the Jira DC panel).

## CLI

- `alia jira-dc status` — connection check
- `alia jira-dc link KEY…` / `unlink` — project links
- `alia jira-dc search 'jql…'` — search (scoped when linked)
- `alia jira-dc get KEY` — issue + comments + transitions
- `alia jira-dc comment KEY 'body'` — add comment
- `alia jira-dc transition KEY Done` — workflow transition
- `alia jira-dc spawn KEY` — create a VesnALIA thread from the issue

## Read first

- `jira_dc_search_issues` — JQL in, one row per issue out (key, type, status,
  priority, assignee, summary). Example:
  `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`.
  **In a VesnALIA project linked to Jira projects, results are limited to those
  projects** (the first output line names the scope); leave `project = …` out.
- `jira_dc_search_all_issues` — the same, across every Jira project. Use it only
  when the user asks about issues outside the linked projects.
- `jira_dc_get_issue` — fields, the description as Markdown, the latest comments,
  and the transitions available right now. Read it before transitioning or
  editing so you use real status names.

## Writes

| Tool | Changes |
| --- | --- |
| `jira_dc_create_issue` | New issue. `projectKey` defaults to the linked Jira project when there is exactly one. `assignee` takes `me`, a name, or an email. |
| `jira_dc_update_issue` | Summary, description, priority, labels. `description` and `labels` **replace** the current value — read first and send the full result. |
| `jira_dc_transition_issue` | Status, by transition name or target status (`Done`, `In Progress`). |
| `jira_dc_add_comment` | Markdown comment. |
| `jira_dc_assign_issue` | `me`, `unassigned`, a name, or an email. |
| `jira_dc_delete_issue` | Permanent. Only when the user explicitly asked to delete. |

Descriptions and comments are Markdown; the plugin converts to Jira wiki markup for Data Center REST v2.

## Approval

Each write action has its own policy in the plugin settings: **Ask every
time** (default) or **Always allow**. When it asks, the tool call waits for the
user's card in the thread. A declined or timed-out approval returns an error
saying nothing was sent — do not retry the same write unless the user asks.
The user can pick "Always allow" on the card to stop asking for that action.
