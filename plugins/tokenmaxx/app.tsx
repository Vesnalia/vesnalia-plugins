import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Dashboard } from "@/components/tokenmaxx/dashboard";
import { SidebarAccessory } from "@/components/tokenmaxx/sidebar-accessory";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "dashboard",
    title: "tokenmaxx",
    icon: "Zap",
    path: "tokenmaxx",
    component: Dashboard,
    experimental_sidebarAccessory: SidebarAccessory,
  });
});
