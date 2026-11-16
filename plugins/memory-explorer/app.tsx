// alia-plugin-memory-explorer — the frontend entry.
//
// One sidebar page, Memory, at /plugins/memory-explorer/memory: VesnALIA memory as
// a table and a graph (pages/MemoryPage.tsx). VesnALIA loads this bundle and reads
// its default export; don't import this file directly.
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { MemoryPage } from "./pages/MemoryPage";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "memory",
    title: "Memory",
    // Brain: the page is everything agents remember, not only people.
    icon: "Brain",
    path: "memory",
    component: MemoryPage,
  });
});
