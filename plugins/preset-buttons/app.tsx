// alia-plugin-preset-buttons — frontend entry.
//
// One registration does the work: a composer customization scoped to the
// NEW-THREAD composer, whose banner mounts PresetStrip. The banner is the only
// plugin surface positioned inside a composer, so it is the only place
// `useComposer()` is reachable — which applying a preset requires. PresetStrip
// then portals its buttons into the bottom action row, between the
// provider/model trigger and the Prompt Enhancer plugin's icon. See that file
// for why the two halves are split.
//
// Scoping matters: `scopes: ["new-thread"]` keeps this off thread composers,
// where there is no project picker to sit beside and no new thread to seed.
import { definePluginApp } from "@vesnalia/plugin-sdk/app";
import { PresetStrip } from "@/components/PresetStrip";
import { PresetSettings } from "@/components/PresetSettings";
import { ICON_GROUPS } from "@/lib/icons";

export default definePluginApp((app) => {
  // Register the OSS icon pool so every preset `icon` name resolves to real
  // artwork from this plugin rather than the host's fallback. A registered name
  // shadows any built-in of the same name, and the host removes registrations
  // on unload — so this needs no cleanup of its own.
  for (const group of ICON_GROUPS) {
    for (const entry of group.icons) {
      app.experimental_icons.register({
        name: entry.name,
        component: entry.component,
      });
    }
  }

  app.composer.customize({
    id: "preset-buttons",
    scopes: ["new-thread"],
    banners: [
      {
        id: "preset-strip",
        // The strip renders through a portal into the host's footer row, not
        // into this slot, so the slot itself must add no card chrome.
        chrome: "bare",
        component: PresetStrip,
      },
    ],
  });

  // A complete interactive editor on the plugin settings page. It uses VesnALIA's
  // live provider/model picker rather than asking people to author provider
  // ids and model names by hand.
  app.slots.settingsSection({
    id: "presets",
    title: "Preset buttons",
    description:
      "Choose a starting set, then add, remove, reorder, rename, and configure the buttons with VesnALIA's live provider and model catalogue.",
    component: PresetSettings,
  });
});
