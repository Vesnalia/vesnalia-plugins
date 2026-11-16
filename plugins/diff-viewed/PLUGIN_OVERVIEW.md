## What you get

- A count in the changes panel toolbar, such as **3/6 viewed**, of the files you have checked with VesnALIA's own **Viewed** checkbox, across every file in the range.
- On a thread with an open pull request, the same marks as GitHub's Viewed boxes, both ways. Check a file in VesnALIA and it is viewed on GitHub; mark it on GitHub and it is checked in VesnALIA.
- A **Local** icon on a file whose diff differs from the pull request's, such as one with edits you have not pushed. Its mark goes to GitHub once a push makes the diffs match.

## How it works

VesnALIA keeps the Viewed marks. This plugin reads them to count, and syncs them with GitHub using your `gh` sign-in: at most one query for the pull request's files when the panel opens, the window regains focus, or a checkbox changes, and one call for each mark that changed.

## Requirements

VesnALIA 0.47 or later. GitHub sync needs `gh` signed in, and can be turned off with the **Sync with GitHub** setting.
