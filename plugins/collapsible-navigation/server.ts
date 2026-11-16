// alia-plugin-collapsible-navigation — Collapsible Sidebar Navigation backend
import { type AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("Collapsible Navigation loaded");

  // Declarative settings — editable in Settings → Plugins and via `alia plugin config`
  alia.settings.define({
    defaultCollapsed: {
      type: "boolean",
      label: "Start collapsed",
      default: false,
    },
    showQuickActions: {
      type: "boolean",
      label: "Show quick actions when collapsed",
      default: true,
    },
  });

  // When installed, automatically activate our collapsible navigation provider
  alia.onInstall(async () => {
    try {
      const { preferences } = await alia.sdk.system.uiPreferences.list();
      const currentNavProvider = preferences["sidebar.navigationProvider"]?.value;
      if (
        currentNavProvider === "__automatic__" ||
        currentNavProvider === "navigation/navigation" ||
        !currentNavProvider
      ) {
        await alia.sdk.system.uiPreferences.set({
          key: "sidebar.navigationProvider",
          value: "collapsible-navigation/collapsible",
          expectedRevision: preferences["sidebar.navigationProvider"]?.revision,
        });
        alia.log.info("Set sidebar.navigationProvider to collapsible-navigation/collapsible");
      }
    } catch (error) {
      alia.log.warn(
        `Failed to set default navigation provider on install: ${String(error)}`,
      );
    }
  });
}
