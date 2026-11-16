import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { mountGlass } from "./backdrop";
import { GlassPanel } from "./glass-panel";
import "./app.css";

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "glass", mount: mountGlass });
  app.slots.navPanel({ id: "glass", title: "Transparency", icon: "Layers", path: "glass", component: GlassPanel });
  app.slots.settingsSection({ id: "glass", title: "Transparency", component: GlassPanel });
});
