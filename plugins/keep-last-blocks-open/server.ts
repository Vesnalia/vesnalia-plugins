// alia-plugin-keep-last-blocks-open: backend entry.
//
// The plugin keeps no server state. Its three settings appear in the plugin's
// settings page. The frontend reads them with useSettings and passes them to
// the content script (see app.tsx).
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

export default async function plugin(alia: AliaPluginApi) {
  alia.settings.define({
    runningBlocks: {
      type: "number",
      label: "Open blocks while the thread runs (0 = off)",
      experimental_schema: z.number().int().min(0).max(10),
      default: 5,
    },
    answeredBlocks: {
      type: "number",
      label: "Open blocks after the final answer (0 = off)",
      experimental_schema: z.number().int().min(0).max(3),
      default: 1,
    },
    countThoughts: {
      type: "boolean",
      label: "Count Thought as a block",
      default: true,
    },
  });
  alia.log.info("loaded");
}
