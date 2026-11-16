Gitea issues and pull requests inside VesnALIA. You can browse, comment, review, and label from a panel or from `alia gitea`, and a VesnALIA agent can fix or merge your pull requests.

## What you get

- Issue and pull request lists filtered by repository, state, and text, with My PRs and assigned-to-me My Issues views.
- A conversation view where you comment, edit or delete your own comments, pick labels and assignees, close or reopen, review, and see checks.
- A Files changed view with a file tree, unified or split diffs, and inline line comments.
- A **Gitea** environment for new threads. It lists the project's Gitea branches, yours first, with pull request badges that show CI and merge state. The thread starts on the picked branch in a new or existing worktree.
- Auto-fix (fix CI failures and address review feedback) and Auto-merge (merge when Gitea allows) controls on My PRs and Pull requests. Each starts a hidden VesnALIA agent thread. Both are off by default.

## Requirements

Install the `tea` CLI 0.15.1 or newer and sign in with `tea login add`. VesnALIA stores no Gitea token. Set `baseUrl` to your Gitea instance with `alia plugin config gitea set baseUrl https://gitea.example.com`. Repositories come from project `origin` remotes and the optional `extraRepos` setting.

## Costs and permissions

Browsing, commenting, and native Auto-merge use no agent time. The Auto-merge on/off toggle calls Gitea through `tea api`; Gitea owns the queue and enforces its merge rules. Auto-fix and `alia gitea send-agent` start VesnALIA threads using your configured model. Auto-fix agents never merge. Bulk auto-merge is not available.

## Commands

Run `alia gitea` for the full list. Examples: `alia gitea my-prs`, `alia gitea show pr owner/repo 12`, `alia gitea auto-fix owner/repo 12 on`.

Source and full docs: https://github.com/Nick-Motion/bb-plugin-gitea
