// alia-plugin-plugin-updates — frontend entry. A badge on the Plugin Updates nav
// entry shows how many plugins have updates; the page applies them. Toasts
// announce newly found versions.
//
// Compiled by `alia plugin build` into dist/app.js + dist/app.css. React and
// @vesnalia/plugin-sdk/app are provided by the VesnALIA app at load time.
//
//   components/UpdatesPage.tsx     the page (sections in components/sections/)
//   components/UpdatesOverlay.tsx  headless: toasts
//   hooks/                         report, update-job, and nav-badge state
//   components/ui/                 vendored VesnALIA components
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { UpdatesOverlay } from "@/components/UpdatesOverlay";
import { UpdatesPage } from "@/components/UpdatesPage";
import { useUpdatesBadge } from "@/hooks/useUpdatesBadge";
import { PANEL_PATH, PANEL_TITLE } from "@/lib/updates";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "plugin-updates",
    title: PANEL_TITLE,
    icon: "plugin-updates/update",
    path: PANEL_PATH,
    component: UpdatesPage,
    experimental_useBadge: useUpdatesBadge,
  });
  app.slots.experimental_appOverlay({ id: "update-toasts", component: UpdatesOverlay });
});
