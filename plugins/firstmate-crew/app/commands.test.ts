/** The palette command opens the FirstMate tab through VesnALIA 0.48's panel controller, or VesnALIA 0.47's `openPanel`. */
import type { PluginCommandContext } from "@vesnalia/plugin-sdk/app";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { openTab, PANEL_ACTION_ID } from "./commands";

describe("openTab", () => {
  it("asks the panel controller for the action tab", () => {
    const openTabCall = vi.fn(() => true);
    const context = {
      threadId: "thr_mate",
      projectId: null,
      experimental_panel: { openTab: openTabCall, toggleTab: vi.fn(), close: vi.fn() },
    } satisfies PluginCommandContext;
    expect(openTab(context)).toBe(true);
    expect(openTabCall).toHaveBeenCalledWith({
      tab: { id: PANEL_ACTION_ID, context: { kind: "thread" }, availability: "action" },
    });
  });

  it("passes the controller's refusal on", () => {
    const context = {
      threadId: "thr_mate",
      projectId: null,
      experimental_panel: { openTab: () => false, toggleTab: vi.fn(), close: vi.fn() },
    } satisfies PluginCommandContext;
    expect(openTab(context)).toBe(false);
  });

  it("falls back to openPanel on a VesnALIA without the controller", () => {
    const openPanel = vi.fn(() => true);
    const legacy = { threadId: "thr_mate", projectId: null, openPanel } as unknown as PluginCommandContext;
    expect(openTab(legacy)).toBe(true);
    expect(openPanel).toHaveBeenCalledWith({ actionId: PANEL_ACTION_ID });
  });
});
