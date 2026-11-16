// Opening a page of VesnALIA's own settings in place. The SDK navigates to threads,
// projects, and plugin panels, not to VesnALIA's settings pages, and a plain link
// would reload the whole app. VesnALIA's router follows the browser history, so a
// pushed entry plus a popstate event moves it there like any in-app link.

export type AliaSettingsSection = "keyboard" | "appearance" | "general";

export function aliaSettingsHref(section: AliaSettingsSection): string {
  return `/settings/${section}`;
}

export function openAliaSettings(section: AliaSettingsSection): void {
  const href = aliaSettingsHref(section);
  if (window.location.pathname === href) return;
  window.history.pushState(window.history.state, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
}
