import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { installInputVim } from "./vendor/input-vim";

async function readIndicatorSetting(pluginId: string, signal: AbortSignal) {
  try {
    const response = await fetch(
      `/api/v1/plugins/${encodeURIComponent(pluginId)}/http/settings`,
      { signal },
    );
    if (!response.ok) return true;
    const settings = (await response.json()) as { showModeIndicator?: unknown };
    return settings.showModeIndicator !== false;
  } catch {
    return true;
  }
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "vim-editors",
    async mount({ pluginId, signal }) {
      const controller = installInputVim(signal, {
        showModeIndicator: await readIndicatorSetting(pluginId, signal),
      });
      let lastChecked = 0;
      const refreshSetting = () => {
        const now = Date.now();
        if (now - lastChecked < 500) return;
        lastChecked = now;
        void readIndicatorSetting(pluginId, signal).then((enabled) => {
          if (!signal.aborted) controller.setIndicatorEnabled(enabled);
        });
      };
      document.addEventListener("focusin", refreshSetting, {
        capture: true,
        signal,
      });
      return () => controller.dispose();
    },
  });
});
