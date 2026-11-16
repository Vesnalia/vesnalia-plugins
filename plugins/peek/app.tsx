// Peek — frontend entry.
//
// Two registrations. The content script decorates the plugin store's cards
// with a Preview button; the app overlay renders the report those buttons ask
// for. They talk through one window event so the button never needs React
// context and the overlay never needs to know about the store's DOM.

import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { PeekOverlay } from "./src/ui/PeekOverlay";
import { mountStoreDecorator, PEEK_OPEN_EVENT, type PeekOpenDetail } from "./src/ui/store-decorator";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "store-preview-buttons",
    mount({ signal }) {
      return mountStoreDecorator({
        signal,
        onOpen: (detail: PeekOpenDetail) => {
          window.dispatchEvent(new CustomEvent<PeekOpenDetail>(PEEK_OPEN_EVENT, { detail }));
        },
      });
    },
  });

  app.slots.experimental_appOverlay({
    id: "preview",
    component: PeekOverlay,
  });
});
