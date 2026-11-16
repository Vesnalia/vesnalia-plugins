---
name: clickable-local-links
description: "How to write links to local files and folders in chat replies so the user opens them with one click (macOS: document in its app, folder in Finder)."
---

# Clickable links to local files and folders

With the Clickable Local Link plugin, in the BB desktop app on macOS:

- a document (docx, xlsx, pptx, pdf, csv, images, audio, video, zip) opens in its default app;
- a folder opens in Finder;
- text and code files (md, py, json, ...) open in BB's preview panel;
- Option-click on any of them selects the item in Finder;
- scripts, apps and unknown file types are never opened, only selected in Finder.

Write every local file or folder as a Markdown link with an **absolute path**,
and keep the full path visible as plain text next to it:

```markdown
[Report.xlsx](/Users/alex/Documents/Q3%20Report.xlsx)
/Users/alex/Documents/Q3 Report.xlsx

[Results folder](/Users/alex/Documents/Q3)
```

Rules:

- Encode spaces as `%20` in the link target, or wrap it in angle brackets: `[name](</abs/path with spaces/file.docx>)`. A raw space breaks the link.
- Do not end a folder link with `/`.
- Use `/Users/...`, `/Volumes/...` or `file:///...`. Relative paths and `~` do not work.
- A line reference stays as usual: `[server.py:120](/abs/path/server.py:120)`.
- On Windows, Linux and remote clients the plugin does nothing; links behave as in plain BB.
