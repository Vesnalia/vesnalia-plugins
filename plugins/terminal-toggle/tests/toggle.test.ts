import { describe, expect, it, vi } from "vitest";
import type { PluginCommandContext } from "@get-bb/plugin-sdk";
import { Toggle, type Runtime } from "../src/toggle";
import type { Focus, HostSnapshot, Surface } from "../src/host";

function fixture(ids = ["a", "b"]) {
  let focus: Focus = { kind: "other" },
    clock = 0;
  let visible = false;
  const selected: string[] = [];
  const composer = {
    scope: { kind: "thread" as const, threadId: "thread" },
    focus: vi.fn(() => {
      focus = { kind: "other" };
    }),
  };
  const surface: Surface = {
    paneId: "pane",
    threadId: "thread",
    composer,
    panel: {
      getTabs: () => ({
        open: visible,
        selectedKey: selected.at(-1) ?? null,
        tabs: ids.map((id) => ({
          key: id,
          title: id,
          status: null,
          closable: true,
          detail: { kind: "terminal" as const, terminalId: id },
        })),
      }),
      close: vi.fn(() => {
        visible = false;
        return true;
      }),
      selectTab: vi.fn((id) => {
        visible = true;
        selected.push(id);
        focus = {
          kind: "terminal",
          terminalId: id,
          threadId: "thread",
          paneId: "pane",
        };
        return true;
      }),
    },
    openTerminal: vi.fn((session) => {
      const id = (session as { id: string }).id;
      ids.push(id);
      surface.panel.selectTab(id);
      return true;
    }),
  };
  const host: HostSnapshot = { tree: [], surface, commands: null };
  const runtime: Runtime = {
    read: () => host,
    focus: () => focus,
    blocked: () => false,
    create: vi.fn(async () => ({ id: "new", threadId: "thread" })),
    now: () => clock,
    wait: async () => {
      clock += 25;
    },
  };
  const toggle = new Toggle(runtime);
  const context: PluginCommandContext = {
    threadId: "thread",
    projectId: "project",
    experimental_panel: {
      ...surface.panel,
      openTab: () => false,
      toggleTab: () => false,
      closeTab: () => {
        throw new Error("Must not close processes");
      },
    },
  };
  return {
    toggle,
    runtime,
    host,
    surface,
    context,
    ids,
    selected,
    composer,
    setFocus: (next: Focus) => {
      focus = next;
    },
  };
}
const input = (terminalId: string): Focus => ({
  kind: "terminal",
  terminalId,
  threadId: "thread",
  paneId: "pane",
});

describe("toggle behavior", () => {
  it("opens first as fallback, then hides and focuses composer from any terminal", async () => {
    const f = fixture();
    await f.toggle.run(f.context);
    expect(f.selected).toEqual(["a"]);
    f.setFocus(input("b"));
    f.toggle.observe();
    await f.toggle.run(f.context);
    expect(f.surface.panel.close).toHaveBeenCalledOnce();
    expect(f.composer.focus).toHaveBeenCalledOnce();
    expect(f.runtime.create).not.toHaveBeenCalled();
  });
  it("remembers actual focus through arbitrary navigation and uses current order after closure", async () => {
    const f = fixture();
    f.setFocus(input("b"));
    f.toggle.observe();
    f.setFocus({ kind: "other" });
    await f.toggle.run(f.context);
    expect(f.selected).toEqual(["b"]);
    f.ids.splice(1, 1);
    f.ids.unshift("c");
    f.setFocus({ kind: "other" });
    await f.toggle.run(f.context);
    expect(f.selected).toEqual(["b", "c"]);
  });
  it("does not hide a selected terminal when focus is in the composer", async () => {
    const f = fixture();
    await f.toggle.run(f.context);
    f.setFocus({ kind: "other" });
    await f.toggle.run(f.context);
    expect(f.selected).toEqual(["a", "a"]);
    expect(f.surface.panel.close).not.toHaveBeenCalled();
  });
  it("serializes creation and drops rapid presses without queued toggles", async () => {
    const f = fixture([]);
    let resolve!: (session: { id: string; threadId: string }) => void;
    f.runtime.create = vi.fn(
      () =>
        new Promise<{ id: string; threadId: string }>((r) => {
          resolve = r;
        }),
    );
    const first = f.toggle.run(f.context);
    await Promise.all(
      Array.from({ length: 10 }, () => f.toggle.run(f.context)),
    );
    expect(f.runtime.create).toHaveBeenCalledOnce();
    resolve({ id: "new", threadId: "thread" });
    await first;
    expect(f.selected).toEqual(["new"]);
    expect(f.surface.panel.close).not.toHaveBeenCalled();
    await f.toggle.run(f.context);
    expect(f.composer.focus).toHaveBeenCalledOnce();
  });
  it("leaves new session intact and does not open/focus it after a pane switch", async () => {
    const f = fixture([]);
    f.runtime.create = async () => {
      f.host.surface = null;
      return { id: "new", threadId: "thread" };
    };
    await f.toggle.run(f.context);
    expect(f.surface.openTerminal).not.toHaveBeenCalled();
    expect(f.composer.focus).not.toHaveBeenCalled();
  });
  it("disposal during creation prevents delayed host actions", async () => {
    const f = fixture([]);
    f.runtime.create = async () => {
      f.toggle.dispose();
      return { id: "new", threadId: "thread" };
    };
    await f.toggle.run(f.context);
    expect(f.surface.openTerminal).not.toHaveBeenCalled();
    expect(f.toggle.last.size).toBe(0);
  });
  it("declines unknown focus, unsupported context, and modal/browser state", async () => {
    const f = fixture();
    f.setFocus({ kind: "unknown" });
    await expect(f.toggle.run(f.context)).rejects.toThrow("identify");
    f.setFocus(input("a"));
    f.runtime.blocked = () => true;
    await f.toggle.run(f.context);
    expect(f.surface.panel.close).not.toHaveBeenCalled();
    expect(f.runtime.create).not.toHaveBeenCalled();
  });
  it("retries a disappeared tab once and never creates a replacement shell", async () => {
    const f = fixture();
    f.surface.panel.selectTab = vi.fn(() => false);
    await expect(f.toggle.run(f.context)).rejects.toThrow("no longer");
    expect(f.surface.panel.selectTab).toHaveBeenCalledTimes(2);
    expect(f.runtime.create).not.toHaveBeenCalled();
  });
  it("unresolved focus invalidates remembered history", () => {
    const f = fixture();
    f.setFocus(input("b"));
    f.toggle.observe();
    f.setFocus({ kind: "unknown" });
    f.toggle.observe();
    expect(f.toggle.last.size).toBe(0);
  });
  it("reports a focus timeout without closing the session", async () => {
    const f = fixture();
    f.surface.panel.selectTab = vi.fn(() => true);
    await expect(f.toggle.run(f.context)).rejects.toThrow("did not focus");
    expect(f.surface.panel.close).not.toHaveBeenCalled();
  });
});

it("does not report a late timeout after focus was confirmed and the user hid the panel", async () => {
  const f = fixture();
  f.surface.panel.selectTab = vi.fn(() => true);
  f.runtime.wait = vi.fn(async () => {
    f.setFocus(input("a"));
    f.toggle.observe();
    await f.toggle.run(f.context);
  });
  await expect(f.toggle.run(f.context)).resolves.toBeUndefined();
  expect(f.runtime.wait).toHaveBeenCalledOnce();
  expect(f.composer.focus).toHaveBeenCalledOnce();
});
it("does not steal focus after leaving and returning to the original pane during creation", async () => {
  const f = fixture([]);
  f.runtime.create = async () => {
    const original = f.host.surface;
    f.host.surface = null;
    f.toggle.observe();
    f.host.surface = original;
    return { id: "new", threadId: "thread" };
  };
  await f.toggle.run(f.context);
  expect(f.surface.openTerminal).not.toHaveBeenCalled();
});

it("retains focus history while the app document is inactive", () => {
  const f = fixture();
  f.setFocus(input("b"));
  f.toggle.observe();
  f.setFocus({ kind: "unknown", invalidateHistory: false });
  f.toggle.observe();
  expect(f.toggle.last.get("thread")).toBe("b");
});

it("reads the host once per wait iteration, including the deadline check", async () => {
  const f = fixture();
  f.surface.panel.selectTab = vi.fn(() => true);
  f.runtime.read = vi.fn(() => f.host);
  f.runtime.wait = vi.fn(async () => {});
  let clock = 0;
  f.runtime.now = () => clock++ * 2000;
  await expect(f.toggle.run(f.context)).rejects.toThrow("did not focus");
  expect(f.runtime.wait).toHaveBeenCalledTimes(3);
  // Initial decision + three waiting observations + one deadline observation.
  expect(f.runtime.read).toHaveBeenCalledTimes(5);
});

it("keeps the command reachable and reports a missing surface before creating/selecting/closing", async () => {
  const f = fixture();
  f.host.surface = null;
  expect(f.toggle.available(f.context)).toBe(true);
  await expect(f.toggle.run(f.context)).rejects.toThrow("TT_SURFACE");
  expect(f.runtime.create).not.toHaveBeenCalled();
  expect(f.surface.panel.close).not.toHaveBeenCalled();
  expect(f.surface.panel.selectTab).not.toHaveBeenCalled();
});
it("rejects malformed host tabs without creating or closing a shell", async () => {
  const f = fixture();
  f.surface.panel.getTabs = () =>
    ({ tabs: undefined }) as unknown as ReturnType<
      typeof f.surface.panel.getTabs
    >;
  await expect(f.toggle.run(f.context)).rejects.toThrow("TT_TABS");
  expect(f.runtime.create).not.toHaveBeenCalled();
  expect(f.surface.panel.close).not.toHaveBeenCalled();
});
it("rejects a changed create response without calling terminal reveal/focus", async () => {
  const f = fixture([]);
  f.runtime.create = async () => ({ id: "", threadId: "thread" });
  await expect(f.toggle.run(f.context)).rejects.toThrow("TT_SESSION");
  expect(f.surface.openTerminal).not.toHaveBeenCalled();
});
