# bb-plugin-jira-dc

Jira Data Center issues in BB: list, board, in-place editing, project links,
agent tools with per-action approval, and `bb jira-dc` CLI.

Adapted from the BB Community [Jira Cloud plugin](https://github.com/Willhong/bb-plugin-jira)
for on-prem / Data Center REST API v2 with Personal Access Tokens.

## Setup

```bash
bb plugin install .
bb plugin config jira-dc set siteUrl https://jira.company.com
bb plugin config jira-dc set pat <your-personal-access-token>
```

Create a PAT in Jira: **Profile → Personal Access Tokens** (Jira 8.14+).

## Features

- **Jira DC** nav page + thread side panel (list / board, issue detail)
- Link a BB project to one or more Jira project keys
- **Send to agent** / `bb jira-dc spawn KEY` creates a thread with issue context
- Transitions and comments from the UI, CLI, and agents
- Agent tools `jira_dc_*` with ask-every-time / always-allow policies

## CLI

```bash
bb jira-dc status
bb jira-dc link WEB APP
bb jira-dc search 'assignee = currentUser() AND statusCategory != Done'
bb jira-dc get WEB-123
bb jira-dc comment WEB-123 'Looking into it'
bb jira-dc transition WEB-123 'In Progress'
bb jira-dc spawn WEB-123 --note 'Reproduce and fix'
```

## Develop

```bash
npm install
npm test
bb plugin build
bb plugin install . --yes
bb plugin dev
```

## Layout

| File | Role |
| --- | --- |
| `jira.ts` | REST v2 client, JQL helpers, write permissions |
| `wiki.ts` | Markdown ⇄ Jira wiki markup |
| `server.ts` | Settings, RPC, agent tools, CLI, project links |
| `app.tsx` | Nav panel + thread panel + approval card |
| `skills/jira-dc/` | Agent skill |
