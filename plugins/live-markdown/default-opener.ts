// Makes Live Markdown the default Markdown opener on first use, without ever
// overriding a choice the user made.
//
// bb has no registration option for a default opener: with no per-extension
// pin it uses the first matching opener in plugin-id order, which is usually
// another plugin. The pin it reads is the browser-local preference behind
// Settings → File openers (`bb.fileOpenerByExtension`). On its first mount in a
// browser this script pins each Markdown extension that has no pin yet, then
// records that it did so and never touches the preference again — so a later
// "Automatic" (which removes the pin) or "Built-in preview" sticks.

/** The preference map BB's Settings → File openers reads and writes. */
const PREFERENCE_KEY = "bb.fileOpenerByExtension";

export const MARKDOWN_EXTENSIONS = ["md", "mdx", "markdown"] as const;

export const OPENER_ID = "live";

/** Pins an unpinned Markdown extension once per browser, and records that it ran. */
export function seedDefaultOpener(pluginId: string, storage: Storage = window.localStorage): void {
  const markerKey = `bb-plugin:${pluginId}:default-opener-seeded:v1`;
  if (storage.getItem(markerKey) !== null) return;

  const raw = storage.getItem(PREFERENCE_KEY);
  let preference: Record<string, string> = {};
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // Not ours to repair; leave the user's storage exactly as it is.
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
    // An object map of extension → opener ref; only key presence is read, values are kept as-is.
    preference = parsed as Record<string, string>;
  }

  const seeded = MARKDOWN_EXTENSIONS.filter((extension) => preference[extension] === undefined);
  if (seeded.length > 0) {
    const next = { ...preference };
    for (const extension of seeded) next[extension] = `${pluginId}:${OPENER_ID}`;
    const value = JSON.stringify(next);
    storage.setItem(PREFERENCE_KEY, value);
    // BB keeps the preference in memory and refreshes it from `storage` events; a
    // write in this same tab fires none, so announce it the way another tab would.
    window.dispatchEvent(
      new StorageEvent("storage", { key: PREFERENCE_KEY, newValue: value, oldValue: raw, storageArea: storage }),
    );
  }
  storage.setItem(markerKey, JSON.stringify({ seeded, at: new Date().toISOString() }));
}
