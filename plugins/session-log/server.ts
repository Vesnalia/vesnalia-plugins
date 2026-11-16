import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { SETTINGS_CHANNEL, SETTING_DESCRIPTORS } from "./src/settings";

// The log runs in app.tsx; the server owns the settings and tells open panels when they change.
export default function sessionLog(alia: AliaPluginApi): void {
  const settings = alia.settings.define(SETTING_DESCRIPTORS);
  settings.onChange(() => alia.realtime.publish(SETTINGS_CHANNEL, {}));
  alia.log.info("loaded");
}
