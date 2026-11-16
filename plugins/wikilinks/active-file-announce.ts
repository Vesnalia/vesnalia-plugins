// Announces which file this opener is showing so other plugins (vault-graph's
// Backlinks panel) can follow along. Contract: `alia-active-file` on mount,
// path change and focus/pointerdown inside the opener; `alia-active-file-closed`
// on unmount. detail: { pluginId, path, source }.
import { useEffect, type RefObject } from "react";
import type { PluginFileOpenerSource } from "@vesnalia/plugin-sdk/app";

export function useAnnounceActiveFile(
  pluginId: string,
  path: string,
  source: PluginFileOpenerSource,
  rootRef: RefObject<HTMLElement | null>,
): void {
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    const detail = { pluginId, path, source: JSON.parse(sourceKey) as PluginFileOpenerSource };
    const announce = () => document.dispatchEvent(new CustomEvent("alia-active-file", { detail }));
    const onInteract = (event: Event) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) announce();
    };
    announce();
    document.addEventListener("pointerdown", onInteract, true);
    document.addEventListener("focusin", onInteract, true);
    return () => {
      document.removeEventListener("pointerdown", onInteract, true);
      document.removeEventListener("focusin", onInteract, true);
      document.dispatchEvent(new CustomEvent("alia-active-file-closed", { detail }));
    };
  }, [pluginId, path, sourceKey, rootRef]);
}
