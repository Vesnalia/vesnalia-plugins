// alia-plugin-quick-thread — frontend entry.
//
// A floating "new thread" dialog you can open from anywhere without leaving
// the thread you are on. All of the UI lives in QuickThreadOverlay; this file
// only wires it into VesnALIA.
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { OPEN_EVENT, QuickThreadOverlay } from "@/components/QuickThreadOverlay";

export default definePluginApp((app) => {
  // App-wide floating dialog. Owns its own Ctrl/Cmd+N shortcut.
  app.slots.experimental_appOverlay({
    id: "quick-thread",
    component: QuickThreadOverlay,
  });

  // Reliable fallback for browsers/OSes that reserve Cmd/Ctrl+N. The palette
  // row cannot reach React state directly, so it signals the overlay.
  app.slots.commandPaletteAction({
    id: "new-thread",
    title: "Quick Thread: new thread",
    run: () => {
      window.dispatchEvent(new Event(OPEN_EVENT));
    },
  });
});
