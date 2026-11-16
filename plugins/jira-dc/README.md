# alia-plugin-jira-dc

Jira Data Center issues in VesnALIA: list, board, in-place editing, project links,
agent tools with per-action approval, and `alia jira-dc` CLI.

Adapted from the VesnALIA Community [Jira Cloud plugin](https://github.com/Willhong/bb-plugin-jira)
for on-prem / Data Center REST API v2 with Personal Access Tokens.

## Setup

```bash
alia plugin install .
alia plugin config jira-dc set siteUrl https://jira.company.com
alia plugin config jira-dc set pat <your-personal-access-token>
```

Create a PAT in Jira: **Profile → Personal Access Tokens** (Jira 8.14+).

## Features

- **Jira DC** nav page + thread side panel (list / board, issue detail)
- Link a VesnALIA project to one or more Jira project keys
- **Send to agent** / `alia jira-dc spawn KEY` creates a thread with issue context
- Transitions and comments from the UI, CLI, and agents
- Agent tools `jira_dc_*` with ask-every-time / always-allow policies

## CLI

```bash
alia jira-dc status
alia jira-dc link WEB APP
alia jira-dc search 'assignee = currentUser() AND statusCategory != Done'
alia jira-dc get WEB-123
alia jira-dc comment WEB-123 'Looking into it'
alia jira-dc transition WEB-123 'In Progress'
alia jira-dc spawn WEB-123 --note 'Reproduce and fix'
```

## Develop

```bash
npm install
npm test
alia plugin build
alia plugin install . --yes
alia plugin dev
```

## Layout

| File | Role |
| --- | --- |
| `jira.ts` | REST v2 client, JQL helpers, write permissions |
| `wiki.ts` | Markdown ⇄ Jira wiki markup |
| `server.ts` | Settings, RPC, agent tools, CLI, project links |
| `app.tsx` | Nav panel + thread panel + approval card |
| `skills/jira-dc/` | Agent skill |
