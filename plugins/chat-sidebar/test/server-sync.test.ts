// The backend keeps the folder layout and the three older settings in step.
// VesnALIA writes settings asynchronously and reports the change afterwards, so
// quick edits must not let a late report undo the edit that followed it.
import { describe, expect, it } from "vitest";

import plugin from "../server";
import { defaultLayout, type FolderLayout } from "../lib/folders";

type Values = Record<string, string | number | boolean>;
type Handler = (input: unknown) => Promise<unknown>;

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeAlia() {
  const store = new Map<string, unknown>();
  let values: Values = { projects: "Folders", sectionFolders: true, archiveFolder: true };
  const listeners: ((next: Values, prev: Values) => void)[] = [];
  const handlers: Record<string, Handler> = {};
  const alia = {
    settings: {
      define: () => ({
        get: async () => ({ ...values }),
        // Persisted after a while, and reported a little later still.
        experimental_set: async (patch: Values) => {
          await tick(20);
          const prev = values;
          values = { ...values, ...patch };
          const next = values;
          setTimeout(() => listeners.forEach((listener) => listener(next, prev)), 5);
          return { ...values };
        },
        onChange: (listener: (next: Values, prev: Values) => void) => listeners.push(listener),
      }),
    },
    storage: {
      kv: {
        get: async (key: string) => store.get(key),
        set: async (key: string, value: unknown) => void store.set(key, value),
        delete: async (key: string) => void store.delete(key),
      },
    },
    realtime: { publish: () => undefined },
    rpc: { register: (_contract: unknown, impl: Record<string, Handler>) => Object.assign(handlers, impl) },
    log: { warn: () => undefined },
  };
  plugin(alia as never);
  return {
    call: (name: string, input: unknown) =>
      handlers[name]!(input) as Promise<{ revision: number; layout: FolderLayout | null }>,
    settings: () => values,
    setSetting: (patch: Values) => alia.settings.define().experimental_set(patch),
  };
}

const withArchive = (layout: FolderLayout, shown: boolean): FolderLayout => ({
  ...layout,
  entries: layout.entries.map((entry) => (entry.kind === "archive" ? { ...entry, hidden: !shown } : entry)),
});
const archiveShown = (layout: FolderLayout | null) => layout?.entries.some((e) => e.kind === "archive" && !e.hidden);

describe("backend settings sync", () => {
  it("keeps the last of two quick edits", async () => {
    const alia = fakeAlia();
    const base = defaultLayout({ projects: "tabs", sectionFolders: true, archiveFolder: true });
    const first = await alia.call("folders_set", { layout: withArchive(base, false), baseRevision: 0 });
    await alia.call("folders_set", { layout: withArchive(base, true), baseRevision: first.revision });
    await tick(150);
    const state = await alia.call("folders_get", null);
    expect(archiveShown(state.layout)).toBe(true);
    expect(alia.settings().archiveFolder).toBe(true);
  });

  it("still follows a setting the user changes", async () => {
    const alia = fakeAlia();
    const base = defaultLayout({ projects: "tabs", sectionFolders: true, archiveFolder: true });
    await alia.call("folders_set", { layout: base, baseRevision: 0 });
    await alia.setSetting({ archiveFolder: false });
    await tick(100);
    expect(archiveShown((await alia.call("folders_get", null)).layout)).toBe(false);
  });
});
