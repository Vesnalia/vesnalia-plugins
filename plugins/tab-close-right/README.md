# Tab Close Right

Move VesnALIA secondary-panel tab close buttons to the right while keeping the original icons visible on the left. Space stays reserved so labels do not jump on hover. The active tab always shows its close button; inactive tabs show it on hover or keyboard focus. Touch screens show close buttons without hover. Pinned tabs keep their original behavior.

## Requirements

VesnALIA 0.46.1+ with Plugin SDK 0.6.49 in the 0.6 series. Verified visually on VesnALIA 0.46.1. Later VesnALIA releases are not automatically verified: this plugin uses DOM selectors and CSS rather than a stable tab-layout API. It only affects the right-panel tab strip.

## Install from this repository

```sh
alia plugin install . --subdirectory plugins/tab-close-right
```

Run that command at the repository root. Inside this plugin folder use `alia plugin install .` instead. A clean Git install needs no development dependencies: VesnALIA supplies its SDK and build toolchain.

## Develop

Run inside this folder with VesnALIA CLI, Node and npm available:

```sh
npm ci --include=dev
npm run typecheck
npm run build
```

There are no runtime npm dependencies. The SDK, TypeScript and React declarations are development-only. To prepare an npm archive, build first and run `npm pack --ignore-scripts`; the files allowlist includes the source and required built artifacts, excluding source maps and local state.

## Disable or enable

```sh
alia plugin disable tab-close-right
alia plugin enable tab-close-right
```

Disabling removes the stylesheet. No tab data, event handlers, account credentials or network services are changed. Existing VesnALIA click, middle-click and drag behavior remains owned by VesnALIA. No model calls are made.

## Release

This plugin is prepared for Git distribution from a monorepo. Use a `tab-close-right/vX.Y.Z` tag and a marketplace source with the matching subdirectory and tag prefix. Publication and tags are separate steps; none have been created yet.
