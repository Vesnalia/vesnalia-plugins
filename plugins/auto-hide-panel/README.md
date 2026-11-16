# Auto-hide Panel

Hides VesnALIA's right panel when its last closable content tab is removed. Info and Diff do not count as content tabs. Opening Info manually, loading the plugin, or navigating to another thread does not itself hide the panel.

Uses VesnALIA's experimental panel-tabs API: `experimental_usePanelTabs()` reports the open tabs and `experimental_useAppPanel().close()` hides the panel. The watcher mounts as an invisible thread-composer banner and shows no UI. No DOM attributes, tab-strip selectors, or synthetic clicks on the Hide right panel control. No network calls, credentials, or runtime dependencies. Disabling the plugin unmounts its observer. Enable/disable with `alia plugin enable auto-hide-panel` and `alia plugin disable auto-hide-panel`.

Requires VesnALIA 0.48.1+ with Plugin SDK 0.6.104 in the 0.6 series. The panel API is experimental; a future VesnALIA release may change it and require a plugin update.

Build: `npm ci --include=dev --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run build`. Install: `alia plugin install . --yes`.
