---
name: project-page
description: Read a VesnALIA project's homepage metadata and README using the Project Page plugin.
---

Use `alia project-page show <project-id>` to read the project's name, repository URL, default checkout path, README, and any read error as bounded JSON. This command is read-only. It resolves files on the project's enrolled host through VesnALIA's SDK. The page is `/plugins/project-page/home/<project-id>` and opens when the user clicks a project title in the native sidebar.

README previews are limited to 500 KB. An absent README is distinct from an unavailable checkout. Refresh in the page to reread files. The plugin's title adapter uses host DOM hooks, so inspect `title-link.ts` if a VesnALIA sidebar update breaks title activation.
