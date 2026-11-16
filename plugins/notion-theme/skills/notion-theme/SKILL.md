---
name: notion-theme
description: Activate, switch off, or edit the Notion palette contributed by the Notion Theme plugin.
---

The plugin adds one palette, `plugin:notion-theme:notion`, to Settings → Appearance and `alia theme list`. It covers light and dark mode; the mode itself stays VesnALIA's per-client setting.

- Turn it on: `alia theme set plugin:notion-theme:notion`
- Back to VesnALIA's look: `alia theme reset`

Colours and fonts live in `themes/notion.css` as VesnALIA design tokens (`--canvas`, `--ink`, `--primary`, text tiers, semantic colours, `--font-*`). Notion's own fonts are licensed, so the theme names them first and falls back to system fonts.

Beyond the palette, `themes/notion.css` restyles a few VesnALIA surfaces while the Notion palette is active: menus and popovers (Notion shadow, 14px items), modal dialogs, switches, the user's message bubble, and markdown in messages (inline code, quotes, headings, tables). It targets Radix parts and stable `data-*` attributes (`data-message-column`, `data-markdown-preview`, `data-promptbox-editor-content`); if a VesnALIA update renames them, those rules stop matching and VesnALIA's own look shows instead.

Content font: the plugin setting `font` (`default`, `serif`, `mono`), set on the plugin's settings page (dropdown or the Ag tiles) or with `alia plugin config notion-theme set font <value>`. The app marks `<html data-notion-font>` and the theme switches messages and the composer to `--font-serif` / `--font-mono`. The UI font stays Notion's default stack.

The hover sidebar lives in the Threadspace plugin (setting `sidebarHoverMode`, ⌘⇧S).
