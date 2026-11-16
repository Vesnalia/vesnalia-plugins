declare const __ALIA_PLUGIN_ID__: string | undefined;

type PluginScope = { "data-alia-plugin-root": ""; "data-alia-plugin"?: string };

/**
 * The attributes the build scopes the plugin's Tailwind utilities to. A node
 * the plugin puts outside its slot (a portal, the footer chip) needs them.
 */
export function pluginScopeAttributes(): PluginScope {
  const pluginId =
    typeof __ALIA_PLUGIN_ID__ === "string" ? __ALIA_PLUGIN_ID__ : undefined;
  return {
    "data-alia-plugin-root": "",
    ...(pluginId !== undefined ? { "data-alia-plugin": pluginId } : {}),
  };
}

export function usePortalScopeProps(): PluginScope & { "data-alia-portaled-overlay": "" } {
  return { "data-alia-portaled-overlay": "", ...pluginScopeAttributes() };
}
