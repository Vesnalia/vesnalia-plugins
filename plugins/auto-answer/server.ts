// bb-plugin-auto-answer — backend entry.
//
// The behavior lives entirely in the frontend (app.tsx): the countdown is a
// property of the question widget in the app window. The server exists to own
// the two declarative settings the overlay reads through `useSettings()`, and
// to expose them to `bb auto-answer`.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Kept in sync with the `delaySeconds` descriptor below. */
const DEFAULT_DELAY_SECONDS = 4;
const MIN_DELAY_SECONDS = 1;
const MAX_DELAY_SECONDS = 120;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Auto-apply answers",
      description:
        "Start a countdown when you pick an option in an agent question, then apply it.",
      default: true,
    },
    delaySeconds: {
      type: "number",
      label: "Countdown (seconds)",
      description:
        "How long to wait after the last option you picked before the answer is applied.",
      experimental_schema: z
        .number()
        .int()
        .min(MIN_DELAY_SECONDS)
        .max(MAX_DELAY_SECONDS),
      default: DEFAULT_DELAY_SECONDS,
    },
  });

  bb.cli.register({
    name: "auto-answer",
    summary: "Show the Auto Answer countdown settings",
    commands: [
      {
        name: "status",
        summary: "Print the current settings",
        usage: "bb auto-answer status [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command] = argv.filter((arg) => arg !== "--json");
      if (command !== undefined && command !== "status") {
        return {
          exitCode: 1,
          stderr: "Usage:\n  bb auto-answer status [--json]",
        };
      }
      // Re-read per invocation so the output reflects a just-saved change.
      const { enabled, delaySeconds } = await settings.get();
      return {
        exitCode: 0,
        stdout: json
          ? JSON.stringify({ enabled, delaySeconds })
          : `Auto-apply answers: ${enabled ? "on" : "off"}\nCountdown: ${delaySeconds}s`,
      };
    },
  });

  settings.onChange((next) => {
    bb.log.info(
      `settings changed: enabled=${next.enabled} delaySeconds=${next.delaySeconds}`,
    );
  });
}
