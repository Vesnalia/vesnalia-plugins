/**
 * FNXC:PinchZoom 2026-11-13-12:39:
 * Backend entry. Gestures and sizes live in each app window, so the server only declares settings and logs its lifecycle.
 *
 * FNXC:PinchZoom 2026-11-13-13:11:
 * User requirement: plugin settings for (1) the composer and terminal size relative to the text size, and (2) whether text scaling changes the whole app or only chat, composer and terminal.
 * These are shared by every device; the pinched text size itself stays per device.
 * The frontend reads them live with `useSettings()`; the server never uses the values, so no reload is needed after a change.
 */
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function pinchZoom(alia: AliaPluginApi) {
  alia.settings.define({
    scope: {
      type: "select",
      label: "What text size changes",
      description:
        "Chat, composer and terminal (the default) leaves the sidebar, headers and the rest of VesnALIA at their normal size. Whole app scales every part of VesnALIA.",
      options: ["content", "app"],
      experimental_optionLabels: {
        content: "Chat, composer and terminal only",
        app: "Whole app",
      },
      // FNXC:PinchZoom 2026-11-13-13:39: User requirement: by default a pinch resizes only chat, composer and terminals, not the whole app.
      default: "content",
    },
    composerScale: {
      type: "number",
      label: "Composer size relative to text",
      description:
        "1 keeps the composer the same size as the text; 1.2 makes it 20% larger. Allowed range 0.5 to 2.",
      default: 1,
    },
    terminalScale: {
      type: "number",
      label: "Terminal size relative to text",
      description:
        "Multiplies VesnALIA's 12px terminal font by the text size and this value; 1.25 at 100% text gives 15px. Allowed range 0.5 to 2. Pinching over a terminal fine-tunes it further on that device.",
      default: 1,
    },
  });
  alia.log.info("loaded");
}
