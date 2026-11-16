import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { ProviderAuthenticationSettings } from "./components/provider-authentication-settings";

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "providers",
    title: "Providers",
    description:
      "Authenticate provider CLIs on an enrolled machine without opening a terminal.",
    component: ProviderAuthenticationSettings,
  });
});
