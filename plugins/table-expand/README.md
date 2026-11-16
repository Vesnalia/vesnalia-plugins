# Table Expand

VesnALIA plugin: click a markdown table in the timeline (or its hover expand button)
to open it full width in a dialog. Esc, the close button or the backdrop closes it.
Clicks on links, buttons and inputs, modified clicks, and text selections are ignored.

It is a content script keyed on VesnALIA's markdown table DOM
(`[data-markdown-preview] div.overflow-x-auto > table`), so it may need updating
after VesnALIA releases. See `PLUGIN_OVERVIEW.md` for the optional CSS that keeps tables
inside the message column. Upstream request: https://github.com/get-bb/bb/issues/1705

## Install

From the VesnALIA plugin store (alia-community), or:

```sh
alia plugin install git:https://github.com/steveafrost/bb-plugin-table-expand.git@v0.1.1
```

## Develop

```sh
npm install
npm run typecheck && npm test
alia plugin build && alia plugin install . --yes
```
