# Compact Nav

A VesnALIA plugin that turns the main sidebar navigation into compact, borderless icon buttons.

- Icons sized to VesnALIA's header controls (`--alia-sidebar-control-size`), with 4px gaps.
- Optional header placement: icons sit between the sidebar toggle and the back/forward arrows. Items that do not fit go into More.
- VesnALIA's saved order and hidden items, split drags, plugin accessories, and the customize editor.
- Accessible labels, hover titles, and selected states.

## Install

```sh
alia plugin install https://github.com/SawyerHood/bb-plugin-compact-nav.git
```

Installing Compact Nav picks it for both **Navigation** and **Header** under **Settings → Appearance**, so the icons sit beside the sidebar toggle right away. To keep them in a row above the thread list instead, set **Header** back to **VesnALIA (built-in)**. If the header is not picked or stops working, the row above the thread list comes back on its own, and disabling the plugin returns the sidebar to VesnALIA's Navigation.

## Customize

Open **More (…) → Customize sidebar** to reorder items or change visibility. Right-click an item for **Open in split**, **View details**, **Hide from sidebar**, and **Customize sidebar**.

Choose **VesnALIA (built-in)** under Navigation and Header, or disable this plugin, to restore the original navigation.

## Development

```sh
npm install
npm run typecheck
npm run build
alia plugin install . --yes
```

Requires Plugin SDK >=0.5.15. The plugin uses only the public navigation API (`experimental_useSidebarNavigation`, `experimental_sidebarHeader`); it does not depend on VesnALIA's markup.

## License

MIT
