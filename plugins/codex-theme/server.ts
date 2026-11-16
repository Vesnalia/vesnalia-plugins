// alia-theme-codex — backend entry.
//
// The palettes are declarative: `alia.themes` in package.json points VesnALIA at
// theme.css ("Codex") and theme-alia.css ("Codex (VesnALIA colors)"). This entry
// declares the optional-change settings (app.tsx reflects them onto <html>)
// and activates the palette on install, so installing is enough on its own.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { OPTIONS, OPTION_KEYS, type OptionKey } from "./options";

type BooleanSetting = { type: "boolean"; label: string; description: string; default: boolean };

/**
 * Must match `alia.themes[0].id` in package.json. VesnALIA lists a plugin theme as
 * `plugin:<pluginId>:<themeId>`.
 */
const THEME_ID = "plugin:codex-theme:codex";

export default async function plugin(alia: AliaPluginApi) {
  const descriptors = Object.fromEntries(
    OPTION_KEYS.map((key) => [
      key,
      { type: "boolean", label: OPTIONS[key].label, description: OPTIONS[key].description, default: false },
    ]),
  ) as Record<OptionKey, BooleanSetting>;
  alia.settings.define(descriptors);
  alia.log.info("loaded — contributes the Codex palettes");

  // Runs once, right after a fresh install (not on update, reload, enable, or
  // server restart). Only take over the appearance while the user is still on
  // VesnALIA's default: someone who deliberately picked another palette keeps it.
  alia.onInstall(async () => {
    const current = await alia.sdk.theme.get();
    if (current.themeId !== "default") {
      alia.log.info(
        `install: leaving theme '${current.themeId}' alone (not the default)`,
      );
      return;
    }
    await alia.sdk.theme.set(THEME_ID);
    alia.log.info(`install: activated ${THEME_ID}`);
  });
}
