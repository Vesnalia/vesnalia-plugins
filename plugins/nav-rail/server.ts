import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

const SLOT_KEY = "nav-rail/rail";
const SIDEBAR_PREFERENCES = [
  "sidebar.navigationProvider",
  "sidebar.headerProvider",
] as const;

export default function navRail(alia: AliaPluginApi) {
  alia.onInstall(async () => {
    const { preferences } = await alia.sdk.system.uiPreferences.list();
    for (const key of SIDEBAR_PREFERENCES) {
      await alia.sdk.system.uiPreferences.set({
        key,
        value: SLOT_KEY,
        expectedRevision: preferences[key].revision,
      });
    }
  });
}
