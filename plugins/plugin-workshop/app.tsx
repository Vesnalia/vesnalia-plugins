import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { WorkshopPanel } from "./app/board";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "plugin-workshop", title: "Plugin Workshop", icon: "plugin-workshop/board", path: "plugin-workshop", component: WorkshopPanel });
});
