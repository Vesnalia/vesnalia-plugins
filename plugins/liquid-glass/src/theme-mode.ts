/**
 * VesnALIA's light/dark mode is a client-side setting (`localStorage["alia.theme"]`,
 * read through a jotai `atomWithStorage`). The originating tab never receives
 * its own `storage` event, so a synthetic one is dispatched — exactly what the
 * marketplace Theme Toggle plugin does.
 */
export type AliaThemeMode = "light" | "dark" | "system";

export const ALIA_THEME_KEY = "alia.theme";

/** Same-window nudge from the settings section to the content script. */
export const APPEARANCE_EVENT = "liquid-glass:appearance";

export function readAliaThemeMode(): AliaThemeMode {
  try {
    const stored = localStorage.getItem(ALIA_THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeAliaThemeMode(mode: AliaThemeMode): void {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(ALIA_THEME_KEY);
    localStorage.setItem(ALIA_THEME_KEY, mode);
  } catch {
    /* private mode — the class toggle below still applies */
  }
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: ALIA_THEME_KEY,
      oldValue: previous,
      newValue: mode,
      storageArea: globalThis.localStorage,
    }),
  );
  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}
