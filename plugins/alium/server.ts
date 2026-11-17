// alia-plugin-alium: keyboard behavior lives in the frontend app overlay (app.tsx, keys.ts).
// The server only declares settings; the frontend reads them via useSettings.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default async function plugin(alia: AliaPluginApi) {
  alia.settings.define({
    vimKeys: {
      type: "boolean",
      label: "Vim keys",
      description: "f hints, j/k and d/u scroll, gg/G top and bottom, i composer. Active when focus is outside a text field (press Esc in the composer).",
      default: true,
    },
    disabledKeys: {
      type: "string",
      label: "Disabled keys",
      description: "Keys alium leaves to VesnALIA and other plugins, e.g. jk when the sidebar switches threads with j/k. Any of f i j k d u g G.",
      default: "",
    },
    hintCharacters: {
      type: "string",
      label: "Hint characters",
      description: "Letters used for labels, home row first. At least 2 unique letters a-z.",
      default: "sadfjklewcmpgh",
    },
    scrollStep: {
      type: "number",
      label: "Scroll step (px)",
      description: "Distance for j/k. d/u always scroll half a screen.",
      default: 70,
    },
    theme: {
      type: "select",
      label: "Hint theme",
      options: ["keycap", "vimium", "alia", "mono"],
      description: "keycap: alia-style key chips with the typed letters in the accent color. vimium: yellow labels. VesnALIA: the app accent color, follows light/dark. mono: text color on background.",
      default: "keycap",
    },
    customCss: {
      type: "string",
      label: "Custom CSS",
      description: "Applied after the theme. Set --alium-* variables on [data-alium-root] or style .alium-hint directly. See the alium skill for the full list.",
      experimental_multiline: true,
      default: "",
    },
  });
}
