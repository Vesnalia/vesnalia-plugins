/**
 * The icons Herald draws. VesnALIA's built-in set has no speaker or megaphone, so
 * those three are SVGs this plugin declares in `alia.branding.experimental_icons`
 * and names as `"<pluginId>/<name>"`. A name VesnALIA does not know renders as its
 * generic bolt, silently — `icons.test.ts` checks every name used here against
 * VesnALIA's built-in list and the manifest.
 */
export const HERALD_ICONS = {
  megaphone: "herald/megaphone",
  volume: "herald/volume",
  volumeOff: "herald/volume-off",
} as const;
