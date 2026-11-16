# Sidebar Plus Plugin

A [VesnALIA](https://getbb.app) plugin that enhances the sidebar thread list with a project-first view. Pin, hide, reorder, and search projects, and see each thread's status, branch, and pull request without opening it.

![Sidebar Plus thread menu](screenshots/thread-menu.jpg)
![Sidebar Plus project menu](screenshots/project-menu.jpg)
![Sidebar Plus project settings](screenshots/project-settings.jpg)
![Sidebar Plus sections](screenshots/sections.jpg)

## Features

- Project-first sidebar with pinned, hidden, and collapsible sections
- Project search, grouping, and sorting
- Project pinning, hiding, reordering, and management
- Thread status and pull request indicators
- Thread details card with branch and pull request information
- Thread actions: open in split, mark read or unread, pin, rename, archive, and delete
- Preferences synced across VesnALIA windows

## Installation

Requirements: VesnALIA `>= 0.45` and plugin SDK `>= 0.6.15`.

Install from GitHub:

```sh
alia plugin install https://github.com/juanem1/bb-sidebar-plus-plugin
```

Or install from a local clone:

```sh
git clone https://github.com/juanem1/bb-sidebar-plus-plugin.git
cd alia-sidebar-plus-plugin
alia plugin install .
```

When you install a thread list plugin, VesnALIA switches to it automatically. If another thread list is active, select Sidebar Plus under **Settings → Appearance → Sidebar**, or from the CLI:

```sh
alia settings ui set sidebar.threadListProvider sidebar-plus/sidebar-plus
```

To go back to VesnALIA's default thread list:

```sh
alia settings ui reset sidebar.threadListProvider
```

To check the plugin or remove it:

```sh
alia plugin list
alia plugin remove sidebar-plus
```

## Development

### Setup

```sh
npm install
alia plugin install .   # install this checkout into alia as a local path plugin
```

### Live reload

```sh
alia plugin dev .
```

To reload the plugin by hand:

```sh
alia plugin reload sidebar-plus
alia plugin logs sidebar-plus # read server logs
```

## License

[MIT](LICENSE)
