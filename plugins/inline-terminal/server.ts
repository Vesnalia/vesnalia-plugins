import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

/** Terminals and sends go through the app SDK; the server only declares settings. */
export default async function plugin(alia: AliaPluginApi) {
  alia.settings.define({
    autoSendResult: {
      type: "boolean",
      label: "Send command results to the agent",
      description:
        "When a command started from a code block finishes, pass its exit code and output to the agent as hidden context so it replies. Off: results stay in the terminal.",
      default: true,
    },
  });
}
