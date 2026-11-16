import { createPortal } from "react-dom";
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { FolderSection } from "@/components/FolderSection";
import { PrPage } from "@/components/PrPage";
import { PR_PANEL_PATH } from "@/lib/pr-context";
import { useAliaThreadListAnchor } from "@/lib/sidebar-anchor";

declare const __ALIA_PLUGIN_ID__: string | undefined;

function AliaListFolder() {
  const host = useAliaThreadListAnchor(typeof __ALIA_PLUGIN_ID__ === "string" ? __ALIA_PLUGIN_ID__ : "github-folder");
  return host ? createPortal(<FolderSection />, host) : null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "github-folder", component: AliaListFolder });
  app.slots.navPanel({ id: "pr", title: "GitHub", icon: "Github", path: PR_PANEL_PATH, component: PrPage });
});
