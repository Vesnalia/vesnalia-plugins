---
name: git-worktree
description: Git Panel plugin — a "Git worktree" tab in VesnALIA's thread panel that stages, commits, pulls, pushes, syncs, switches branches and stashes in the thread's workspace. Use when the user asks what the panel does, why it refused a Git action, or where to do Git work in VesnALIA.
---

# Git worktree

The Git Panel plugin adds a **Git worktree** tab to the thread panel. It acts on
the workspace of the current thread, and only if that workspace is a Git
repository; a thread without a workspace, or a workspace that is not a repo,
gets an error instead of the panel.

The plugin contributes no CLI command and no agent tools. You cannot drive the
panel; you run `git` yourself as usual. Use this skill to explain the panel to
the user, to point them at it, and to know what it will and will not do to a
repository you are both working in.

## What the panel shows and does

- A status bar tinted by the worktree's state, offering one next action:
  Commit when something is staged, Pull when behind, Push when ahead, Sync when
  the branch has diverged, Stage all when there are unstaged changes,
  "No new changes" when the tree is clean and in step, or "No upstream" when the
  branch has none. Diverged outranks staged, which outranks behind, ahead, then
  unstaged.
- Commit goes through VesnALIA's own commit feature, which writes the commit message.
  The user does not type one.
- A branch pill opens a picker: Local and Remote tabs, a search field, a button
  that creates a branch off the current HEAD and checks it out (uncommitted work
  comes along), and a rename for the current local branch.
- Changes and Staged tabs list one row per file — folder and filename, added and
  removed line counts, a stage or unstage button, and a VS Code status letter
  (M, A, U for untracked, D, R, and "!" for a conflict). Line counts come from
  `git diff --numstat`; untracked files are counted directly, and very large or
  binary ones show no count.
- A tools row: pull and push with their incoming and outgoing commit counts,
  fetch, and a menu with Sync, Undo last commit, Stash changes (including
  untracked) and Pop latest stash.

## What the panel refuses

Tell the user these rules rather than guessing why an action failed:

- Switching branches is refused while the worktree is dirty. They must stage,
  commit or stash first.
- Pull is fast-forward only, and is refused when the branch has diverged or has
  no upstream. Push is refused while the branch is behind.
- Sync fetches, rebases local commits onto the incoming ones, then pushes. On a
  conflict it aborts the rebase and leaves the branch unchanged; resolving it is
  a manual job.
- Undo last commit is a soft reset, so the commit's changes stay staged. It is
  refused once the commit is on the upstream, and on a first commit.
- A stash that does not apply cleanly is kept, not dropped.

## Notes

- Git runs on the machine that owns the workspace, as plain `git` subprocesses
  with terminal prompts disabled. The plugin holds no credentials; pushing and
  pulling uses whatever authentication git is already configured with, and fails
  rather than prompting.
- Ahead and behind counts come from local remote-tracking refs. The panel
  fetches once after it opens, so a fresh count needs the panel's Fetch button
  or a `git fetch`.
