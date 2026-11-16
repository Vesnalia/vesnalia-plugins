# Project Page

Click a project's name in VesnALIA's sidebar to open its homepage. That project title carries the selected state; there is no separate Project home item in the top navigation. The chevron still expands and collapses threads. The homepage shows the checkout's README, a repository link when configured, and a New thread button.

## Install

Requires VesnALIA 0.43.1 or later with Plugin SDK 0.4.87 or later, plus Node.js and npm for Git installation.

```sh
alia plugin install https://github.com/jem-computer/bb-project-page
```

Click any project title after installation. Disable or remove Project Page in VesnALIA's plugin settings to restore the original sidebar behavior.

## Development

```sh
npm ci --include=dev
npm run typecheck
npm test
alia plugin build
alia plugin install .
```

The plugin uses VesnALIA's public SDK for project reads, navigation, and Markdown rendering. It doesn't register a replacement thread list. A small app overlay enhances the existing project-title element using `data-sidebar-project-id` and `data-sidebar="group-label"`. The page remains a plugin route internally; CSS hides its automatic navigation entry because SDK 0.4.87 has no hidden-route option. Those DOM hooks are not a versioned title slot; a VesnALIA sidebar markup change may require updating `title-link.ts`. Disabling the plugin restores all attributes and removes its listeners and observer.

README reads use the project's default source and its enrolled host, so remote browser clients don't need local filesystem access. Root README files take priority over `.github/README` and `docs/README`; Markdown, plain text, and extensionless files are supported. The preview caps at 500 KB. Refresh rereads the checkout. No files, threads, or repository metadata are changed.

Open `/plugins/project-page/home/<project-id>` directly or click its title in the sidebar. `alia project-page show <project-id>` returns the same read-only data as JSON.

Relative README links and images currently use VesnALIA's default Markdown routing; resolving them against the project checkout is not implemented yet.

## License

MIT.
