declare const __ALIA_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-alia-portaled-overlay": "";
  "data-alia-plugin-root"?: "";
  "data-alia-plugin"?: string;
  "data-alia-ru-skip": "";
} {
  const pluginId =
    typeof __ALIA_PLUGIN_ID__ === "string" ? __ALIA_PLUGIN_ID__ : undefined;
  return {
    "data-alia-portaled-overlay": "",
    "data-alia-plugin-root": "",
    // The plugin localizes itself; ALIA-wide DOM translators must leave it alone.
    "data-alia-ru-skip": "",
    ...(pluginId !== undefined ? { "data-alia-plugin": pluginId } : {}),
  };
}
