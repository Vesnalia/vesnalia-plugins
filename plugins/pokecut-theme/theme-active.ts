// Whether the Pokecut theme is the selected VesnALIA theme. The theme CSS declares
// --pk-theme: pokecut on :root; VesnALIA swaps the CSS in <style id="alia-app-theme">
// when the user picks another theme, so a head observer catches every change.
import { useSyncExternalStore } from "react";

export function themeIsActive(): boolean {
  if (typeof document === "undefined") return false;
  return getComputedStyle(document.documentElement).getPropertyValue("--pk-theme").trim() === "pokecut";
}

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** Re-renders when the active theme changes; DOM enhancements run only while it is Pokecut. */
export function useThemeActive(): boolean {
  return useSyncExternalStore(subscribe, themeIsActive, () => false);
}
