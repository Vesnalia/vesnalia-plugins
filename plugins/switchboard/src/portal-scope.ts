// Plugin Tailwind utilities are scoped to elements carrying these attributes, and portalled
// menus and dialogs render outside the plugin root, so each one must carry them itself.
// `alia plugin build` defines `__ALIA_PLUGIN_ID__`; tests run without it.
declare const __ALIA_PLUGIN_ID__: string | undefined;

export function portalScopeProps(): { "data-alia-portaled-overlay": ""; "data-alia-plugin-root": ""; "data-alia-plugin"?: string } {
  const pluginId = typeof __ALIA_PLUGIN_ID__ === "string" ? __ALIA_PLUGIN_ID__ : undefined;
  return { "data-alia-portaled-overlay": "", "data-alia-plugin-root": "", ...(pluginId === undefined ? {} : { "data-alia-plugin": pluginId }) };
}
