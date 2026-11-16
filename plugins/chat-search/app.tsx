// alia-plugin-chat-search — frontend entry.
//
// Three surfaces, one feature: find text in the open chat and highlight every
// occurrence in place.
//   - a right-panel tab with the search box and hit list
//   - a content script that paints highlights over the rendered timeline
//   - a quick-palette row and a Mod+Shift+F shortcut that open the tab
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { SearchPanel } from "./src/SearchPanel";
import { mountHighlighter } from "./src/highlighter";

const ACTION_ID = "find";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "highlighter",
    mount: ({ signal }) => mountHighlighter({ signal }),
  });

  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: ACTION_ID,
    title: "Find in chat",
    icon: "Search",
    layout: "flush",
    component: SearchPanel,
  });

  app.commands.register({
    id: "open",
    title: "Chat search: find in this chat",
    defaultShortcut: { key: "f", mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: ACTION_ID });
    },
  });
});
