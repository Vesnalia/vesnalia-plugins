/**
 * Plugin flavor of the app's `lib/portal-scope.ts` (registry override —
 * component files are byte-identical between the app and the registry; only
 * this file differs). Everything a plugin renders is plugin-scoped, so the
 * scope attributes are unconditional: portaled overlay content (dialog,
 * select, popover, …) lands in document.body, outside the plugin's
 * `[data-alia-plugin]` mount, and must carry its own scope root for the
 * plugin's compiled stylesheet (`@scope ([data-alia-plugin="<id>"], …)`) to
 * reach it. `__ALIA_PLUGIN_ID__` is an esbuild define stamped by
 * `alia plugin build`; outside that pipeline (registry copies, tests) it is
 * undefined and the generic root attribute alone keeps legacy behavior. In
 * the host app the same hook reads the plugin-slot context instead, so host
 * overlays stay out of plugin scopes. The portaled-overlay marker is shared
 * with the host copy and lets Electron route pointer input to visible
 * overlay controls instead of an underlying window-drag region.
 */
declare const __ALIA_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-alia-portaled-overlay": "";
  "data-alia-plugin-root"?: "";
  "data-alia-plugin"?: string;
} {
  const pluginId =
    typeof __ALIA_PLUGIN_ID__ === "string" ? __ALIA_PLUGIN_ID__ : undefined;
  return {
    "data-alia-portaled-overlay": "",
    "data-alia-plugin-root": "",
    ...(pluginId !== undefined ? { "data-alia-plugin": pluginId } : {}),
  };
}
