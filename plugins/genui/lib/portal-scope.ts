import { useMotionScope } from "../ui/components/motion";

declare const __ALIA_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-alia-portaled-overlay": "";
  "data-alia-plugin-root"?: "";
  "data-alia-plugin"?: string;
  "data-genui-motion"?: "off";
} {
  const motion = useMotionScope();
  const pluginId =
    typeof __ALIA_PLUGIN_ID__ === "string" ? __ALIA_PLUGIN_ID__ : undefined;
  return {
    "data-alia-portaled-overlay": "",
    "data-alia-plugin-root": "",
    ...(pluginId !== undefined ? { "data-alia-plugin": pluginId } : {}),
    ...motion,
  };
}
