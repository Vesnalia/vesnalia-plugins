import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { mountCopySessionIdContextMenu } from "./src/sidebar-context-menu";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "sidebar-context-menu",
    mount: mountCopySessionIdContextMenu,
  });
});
