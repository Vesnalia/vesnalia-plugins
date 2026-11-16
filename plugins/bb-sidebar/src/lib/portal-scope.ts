/**
 * Portaled content leaves the plugin mount. These attributes restore the
 * plugin style scope and mark the content as an interactive overlay.
 */
declare const __ALIA_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-alia-portaled-overlay": "";
  "data-alia-plugin-root": "";
  "data-alia-plugin"?: string;
} {
  const pluginId = typeof __ALIA_PLUGIN_ID__ === "string" ? __ALIA_PLUGIN_ID__ : undefined;
  return {
    "data-alia-portaled-overlay": "",
    "data-alia-plugin-root": "",
    ...(pluginId === undefined ? {} : { "data-alia-plugin": pluginId }),
  };
}
