import "./app.css";
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { SettingsSection } from "./app/settings-section.tsx";

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "models",
    title: "OpenCode v2",
    description:
      "Check OpenCode on your hosts and choose how VesnALIA runs it and which models it offers.",
    component: SettingsSection,
  });
});
