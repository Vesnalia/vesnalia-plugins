// bb-plugin-message-date-time - backend entry.
//
// Declares the two settings the frontend reads (app.tsx) and tells it the
// computer's own clock settings. Everything else runs in the app window.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readSystemClock } from "./lib/system-clock";

export const rpcContract = defineRpcContract({
  system_clock: {
    input: z.null(),
    output: z.object({ locale: z.string().nullable(), hour12: z.boolean().nullable() }),
  },
});

export const LANGUAGE_OPTIONS = ["System", "English", "Русский"];
export const TIME_FORMAT_OPTIONS = ["System", "12-hour (2:30 PM)", "24-hour (14:30)"];

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    language: {
      type: "select",
      label: "Language / Язык",
      description: "Words like Today and Yesterday. System follows your computer's language; anything other than Russian shows English.",
      options: LANGUAGE_OPTIONS,
      default: "System",
    },
    timeFormat: {
      type: "select",
      label: "Time format / Формат времени",
      description: "System follows your computer: its 24-hour time switch on macOS, otherwise its region (24 hours in Germany, 12 in the US).",
      options: TIME_FORMAT_OPTIONS,
      default: "System",
    },
  });
  bb.rpc.register(rpcContract, { system_clock: () => readSystemClock() });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
