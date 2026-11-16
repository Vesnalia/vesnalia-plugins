import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

export default function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    showModeIndicator: {
      type: "boolean",
      label:
        'Show Vim mode indicator. "I" for Insert, "N" for Normal, "V" for Visual, and "L" for Visual Line.',
      default: true,
    },
  });

  alia.http.route("GET", "/settings", async (context) =>
    context.json(await settings.get()),
  );

  alia.log.info("loaded");
}
