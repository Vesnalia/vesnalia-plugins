Open the files your agent mentions with one click. In the VesnALIA desktop app on
macOS, a chat link to a local document opens it in its own app, and a link to
a folder opens it in Finder.

## What you get

- Documents (Word, Excel, PowerPoint, Pages, Numbers, Keynote, PDF, CSV,
  images, audio, video, zip) open in their default Mac app.
- Folders open in Finder. Plain VesnALIA does not treat a folder link as a file at all.
- Text and code files keep VesnALIA's own preview.
- Option-click on any local link selects the item in Finder.
- A bundled skill tells agents to write local paths as links you can click.
- Error messages in English or Russian.

## Safety

Scripts, apps, installers and unknown file types are never opened, only
selected in Finder. A link to a symlink is judged by the file the symlink
points to, so `report.pdf` that leads to a script is only selected. The
server makes this decision on the real path right before it calls macOS
`open`. Office files keep their own macro warnings.

## Limits

macOS only, in the VesnALIA window that runs on the same Mac as the VesnALIA server. On
Windows, Linux, from another device, or in a window connected to a remote VesnALIA
server, the plugin does nothing and links behave as in plain VesnALIA. A folder
whose name contains a dot (`Q3.2026`) is not opened by a plain click;
Option-click selects it in Finder.

## Settings

Settings > Plugins > Clickable Local Link: Language (System, English, Русский).
