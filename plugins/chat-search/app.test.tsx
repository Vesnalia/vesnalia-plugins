// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@vesnalia/plugin-sdk/testing/app";
import type { PluginCommandRegistration } from "@vesnalia/plugin-sdk/app";
import definition from "./app";
import { SearchPanel } from "./src/SearchPanel";
import { searchStore } from "./lib/search-store";
import type { SearchResult } from "./server";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  searchStore.clear();
});

async function load() {
  const commands: PluginCommandRegistration[] = [];
  // Capture commands at the public builder boundary; the SDK test helper's
  // CapturedPluginApp does not yet expose them in its declarations.
  const app = await loadPluginApp({
    __aliaPluginApp: true,
    setup(builder) {
      definition.setup({ ...builder, commands: { register(command) {
        commands.push(command);
        builder.commands.register(command);
      } } });
    },
  });
  return { app, commands };
}

describe("Find registration and navigation", () => {
  it("keeps the thread action identity, params contract and flush layout", async () => {
    const { app, commands } = await load();
    expect(app.tabs).toHaveLength(1);
    expect(app.tabs[0]).toMatchObject({
      id: "find", title: "Find in chat", layout: "flush",
      context: { kind: "thread" }, availability: "action",
    });
    expect(app.tabs[0]?.component).toBe(SearchPanel);
    const openPanel = vi.fn(() => true);
    const context = { threadId: "thr_1", projectId: "proj_1", openPanel };
    expect(commands[0]?.id).toBe("open");
    expect(commands[0]?.isAvailable?.(context)).toBe(true);
    expect(commands[0]?.isAvailable?.({ ...context, threadId: null })).toBe(false);
    await commands[0]?.run(context);
    expect(openPanel).toHaveBeenCalledWith({ actionId: "find" });
  });

  it("registers Mod+Shift+F on the same command used by the palette", async () => {
    const { app, commands } = await load();
    expect(commands[0]?.defaultShortcut).toEqual({ key: "f", mod: true, shift: true });
    expect(app.appOverlays).toEqual([]);
  });

  it("restores a query from params, only jumps on selection, and clears highlights on close", async () => {
    const { app } = await load();
    const result: SearchResult = {
      hits: [{ rowId: "old", topRowId: "turn", role: "assistant", seq: 1, index: 0, before: "", match: "needle", after: "" }],
      rowOrder: ["turn"], totalMatches: 1, matchedMessages: 1, scannedMessages: 100,
      truncated: false, invalidRegex: false,
    };
    const jump = vi.fn();
    cleanups.push(searchStore.onJump(jump));
    const panel = renderSlot({ component: SearchPanel }, { threadId: "thr_1", params: { query: "needle" } }, {
      rpc: { search: () => result },
    });
    cleanups.push(() => panel.lifecycle.unmount());
    expect((panel.getByRole("textbox") as HTMLInputElement).value).toBe("needle");
    await panel.findByText("1 match in 1 message");
    expect(jump).not.toHaveBeenCalled();
    fireEvent.keyDown(panel.getByRole("textbox"), { key: "Enter" });
    expect(jump).toHaveBeenCalledWith({ rowId: "old", topRowId: "turn", index: 0 });
    panel.lifecycle.unmount();
    expect(searchStore.get().query).toBe("");
    cleanups.pop();
  });

  it("does not call an incomplete zero-hit search complete", async () => {
    const { app } = await load();
    const panel = renderSlot({ component: SearchPanel }, { threadId: "thr_1", params: { query: "absent" } }, {
      rpc: { search: () => ({ hits: [], rowOrder: [], totalMatches: 0, matchedMessages: 0, scannedMessages: 200, truncated: true, invalidRegex: false }) },
    });
    cleanups.push(() => panel.lifecycle.unmount());
    await panel.findByText("No matches in searched history (search incomplete).");
  });
});
