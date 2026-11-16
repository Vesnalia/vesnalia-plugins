import { z } from "zod";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { sendShortcuts, shortcutLabels } from "./settings.ts";

export default function plugin(alia: AliaPluginApi) {
  alia.settings.define({
    sendShortcut: {
      type: "select",
      label: "Send messages with",
      options: [...sendShortcuts],
      experimental_optionLabels: shortcutLabels,
      experimental_schema: z.enum(sendShortcuts),
      default: "ctrl-enter",
    },
  });
}
