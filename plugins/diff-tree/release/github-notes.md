# Diff Tree v0.1.3

Compare image changes and keep your review context when switching chats.

- Preview PNG, JPEG, GIF, WebP, BMP, ICO, AVIF and SVG files with **Before / After** images, transparency backgrounds, dimensions and **Fit / 100%** zoom. SVG retains a **Text diff** option.
- Historical comparisons read both images from pinned Git revisions, including renamed files. Added or deleted images keep the available side visible. File mode and the full Worktree tree preview the current working-copy image.
- Image previews are limited to **2 MiB per side** and the browser's supported decoders. Unsupported, oversized or unreadable sides have notices. No image service or new dependency is added.
- Choose the starting commit for **Recent commits**, with SHA, subject and author, instead of entering a count. The combined diff includes that commit through HEAD, excludes working-copy changes, and stays anchored to the selected SHA as new commits arrive.
- Remember comparison scope, commit selection, manual base, Worktree mode, layout and Diff/File preview per thread. Selected files, searches and expanded folders are restored independently for Changes and Full tree.
- Stabilize full-file previews during scrolling and refreshes, avoiding transient missing-line errors. Files over 10,000 lines use complete plain text with line numbers.
- Returning to a chat preserves its review state rather than replaying an older file navigation. UI preferences stay in this browser; file contents and chat drafts are not persisted by the view-state store.

Requires BB 0.46.1+, Plugin SDK 0.6.49+, and Git on the workspace host for history. Git and file reads use the environment's enrolled host. No LSP service, new account, external service or repository writes are introduced.

Install with:

```sh
bb plugin install 'git:https://github.com/SergeyGavrilov/bb-diff-tree.git@^0.1.0'
```

Existing Plugin Hub installs track the compatible `^0.1.0` range. Check for plugin updates in BB to select this release. The marketplace overview update is reviewed separately from compatible tag selection.
