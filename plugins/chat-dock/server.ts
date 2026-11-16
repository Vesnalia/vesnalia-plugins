// alia-plugin-chat-dock — backend entry.
//
// Owns the settings and the debug log. Everything the user sees happens in the page
// (app.tsx); it calls back here only to write a setting (the frontend can read
// plugin settings but not write them) and to hand over debug lines.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

import { definitions, SETTING_KEYS } from "./src/shared";

export type { SettingKey } from "./src/shared";

export const rpcContract = defineRpcContract({
  set_setting: { input: z.object({ key: z.enum(SETTING_KEYS), value: z.boolean() }), output: z.null() },
  debug: {
    input: z.object({
      event: z.string().max(40),
      data: z.record(z.string().max(40), z.union([z.number(), z.string().max(200), z.boolean()])),
    }),
    output: z.null(),
  },
});

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define(definitions());
  alia.rpc.register(rpcContract, {
    set_setting: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value });
      return null;
    },
    debug: async ({ event, data }) => {
      if (!(await settings.get()).debugLog) return null;
      alia.log.debug(`${event} ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      return null;
    },
  });
  alia.log.info("loaded");
  alia.onDispose(() => alia.log.info("disposed"));
}
