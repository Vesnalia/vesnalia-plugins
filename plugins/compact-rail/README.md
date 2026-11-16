# Compact Rail

A VesnALIA theme for small desktop screens.

## More room on desktop

The navigation rail is 40 px wide with 28 px buttons and 16 px icons. Button spacing is 6 px. The thread list fills its available container as you resize the sidebar.

Window gutters on the right and bottom use 60% of VesnALIA’s default size: 7.2 px with a 16 px root font. The File Tree panel uses the same outer gutters when installed.

## Activate

Install the plugin, then select Compact Rail in Settings → Appearance. Installing the plugin does not switch your current theme. Choose Default to restore the default layout.

## Compatibility

Requires VesnALIA 0.46 or later and Plugin SDK 0.6.37 or later. Compact sizing applies to desktop viewports at least 768 px wide with a fine pointer. The theme retains VesnALIA’s default light and dark colors.

This theme uses internal VesnALIA layout selectors. VesnALIA interface updates may require a theme update. File Tree is optional. If it is already open when switching themes, resize the window once to refresh its reserved width.

## Development

```sh
npm install
npm run typecheck
alia plugin build
```
