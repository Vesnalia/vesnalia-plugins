// alia-plugin-diff-plus — frontend entry.
//
// Adds a folder tree beside the Diff tab's file list (src/Tree.tsx). VesnALIA has no
// slot there, so an app overlay finds the tab in the page and portals into it.
// VesnALIA's diffs themselves are left alone: quoting selected lines is VesnALIA's own
// "Add to chat".
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { TreeOverlay } from "./src/Tree";
import { LIST_ICON, LIST_TREE_ICON, ListIcon, ListTreeIcon, TREE_ICON, TreeIcon } from "./src/icons";
import "./src/styles.css";
import "./src/icons.css";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: TREE_ICON, component: TreeIcon });
  app.experimental_icons.register({ name: LIST_ICON, component: ListIcon });
  app.experimental_icons.register({ name: LIST_TREE_ICON, component: ListTreeIcon });
  app.slots.experimental_appOverlay({ id: "tree", component: TreeOverlay });
});
