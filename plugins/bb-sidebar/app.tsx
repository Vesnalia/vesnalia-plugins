// VesnALIA Sidebar: a shelved, manually ordered replacement for VesnALIA's thread list.
// Manual order stays fixed until the user moves a row. Optional views can sort
// by activity, creation date, or project without changing the saved order.
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import "./src/theme.css";
import { ThreadInbox } from "./src/ThreadInbox";
import { ParentChip } from "./src/ParentChip";
import { SidebarSettings } from "./src/SidebarSettings";
import { registerThreadHeaderAction } from "./src/alia-sdk";
import { registerSnoozeCommands } from "./src/lib/snooze-commands";

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "sidebar-settings",
    component: SidebarSettings,
  });

  app.slots.experimental_threadList({
    id: "inbox",
    title: "VesnALIA Sidebar",
    description: "Shelves, project filtering, manual ordering, and optional sorted views.",
    component: ThreadInbox,
  });

  // An open child thread names its parent here. The list draws a child inside
  // its parent's row, not as a row of its own, so this chip is the way back
  // up from the child's own page.
  registerThreadHeaderAction(app.slots, {
    id: "parent",
    title: "Parent thread",
    component: ParentChip,
  });

  // Palette commands act on the thread in view, so a thread can be snoozed
  // without finding its row.
  registerSnoozeCommands(app.commands);
});
