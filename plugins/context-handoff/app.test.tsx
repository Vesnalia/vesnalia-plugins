// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@vesnalia/plugin-sdk/testing/app";
import type { HandoffView, rpcContract } from "./server";
import definition from "./app";

afterEach(cleanup);

/** jsdom's serialization of the meter's yellow (#faf76b) and orange (#ff9245). */
const YELLOW = "rgb(250, 247, 107)";
const ORANGE = "rgb(255, 146, 69)";
const fill = (ui: { getByRole: (role: string) => HTMLElement }) =>
  ui.getByRole("meter").querySelector<HTMLElement>("[data-meter-fill]")!;
const target = (ui: { getByRole: (role: string) => HTMLElement }) =>
  ui.getByRole("meter").querySelector<HTMLElement>("[data-meter-target]");

const initial: HandoffView = {
  threadId: "thr_a", autoHandoff: false, enabled: true, eligible: true,
  usedTokens: 120_000, contextWindow: 500_000, limit: 150_000, stage: "watching", part: 1, nextThreadId: null,
  next: null, creating: false, stuck: false, requested: false,
};

async function mount(options: { state?: Partial<HandoffView>; failToggle?: boolean } = {}) {
  const app = await loadPluginApp(definition);
  let view = { ...initial, ...options.state };
  return renderSlot<{}, typeof rpcContract>(app.composerCustomizations[0]!.banners![0]!, {}, {
    composer: { scope: { kind: "thread", threadId: "thr_a" } },
    rpc: {
      state: async ({ threadId }: { threadId: string }) => ({ ...view, threadId }),
      set_enabled: async ({ enabled, threadId }: { enabled: boolean; threadId: string }) => {
        if (options.failToggle) throw new Error("Save failed");
        view = { ...view, autoHandoff: enabled, threadId };
        return { ok: true, result: "saved", view };
      },
    },
  });
}

describe("context-handoff.composer", () => {
  it("shows a meter and one switch while automatic handoff is off", async () => {
    const ui = await mount();
    const toggle = await ui.findByRole("switch", { name: "Automatic context handoff" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(ui.getByRole("meter").getAttribute("aria-valuenow")).toBe("24");
    expect(ui.getByRole("meter").getAttribute("aria-valuemax")).toBe("100");
    expect(ui.getByText(/24.0%/)).toBeTruthy();
    expect(ui.queryByText("Build")).toBeNull();
    expect(ui.queryByText("Planning")).toBeNull();
    expect(ui.queryByText("Hand off now")).toBeNull();
  });

  it("saves the switch for the current thread only", async () => {
    const ui = await mount();
    const toggle = await ui.findByRole("switch");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(ui.inspection.rpcCalls.filter(c => c.method === "set_enabled")).toEqual([
      { method: "set_enabled", input: { threadId: "thr_a", enabled: true } },
    ]);
  });

  it("keeps the saved state and shows an error when the switch cannot save", async () => {
    const ui = await mount({ failToggle: true });
    const toggle = await ui.findByRole("switch");
    fireEvent.click(toggle);
    expect((await ui.findByRole("alert")).textContent).toContain("Save failed");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("updates usage live and ignores updates from the other comparison thread", async () => {
    const ui = await mount();
    await ui.findByRole("meter");
    await ui.behavior.emitRealtime("state-changed", { ...initial, usedTokens: 145_000 });
    expect(ui.getByRole("meter").getAttribute("aria-valuenow")).toBe("28.999999999999996");
    await ui.behavior.emitRealtime("state-changed", { ...initial, threadId: "thr_b", usedTokens: 20_000 });
    expect(ui.getByRole("meter").getAttribute("aria-valuenow")).toBe("28.999999999999996");
  });

  it("clears the previous thread when the composer changes scope", async () => {
    const ui = await mount();
    await ui.findByRole("switch");
    await ui.behavior.setComposerScope({ kind: "thread", threadId: "thr_b" });
    fireEvent.click(await ui.findByRole("switch"));
    await waitFor(() => expect(ui.inspection.rpcCalls.some(c => c.method === "set_enabled" && (c.input as { threadId: string }).threadId === "thr_b")).toBe(true));
  });

  it("shows unknown usage honestly and caps the visual meter at 500k", async () => {
    const ui = await mount({ state: { usedTokens: null } });
    await ui.findByText(/usage unavailable/i);
    expect(ui.queryByRole("meter")).toBeNull();
    await ui.behavior.emitRealtime("state-changed", { ...initial, usedTokens: 620_000, autoHandoff: true, stage: "preparing" });
    expect(ui.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
    expect(fill(ui).style.width).toBe("100%");
    expect(ui.getByText(/Preparing handoff/)).toBeTruthy();
  });

  it("uses percentage boundaries including red and dark red", async () => {
    const ui = await mount({ state: { usedTokens: 99_000 } });
    await ui.findByRole("meter");
    expect(fill(ui).style.background).toContain("--primary");
    expect(fill(ui).style.width).toBe(`${99_000 / 500_000 * 100}%`);
    for (const [usedTokens, color] of [[100_000, YELLOW], [149_999, YELLOW], [150_000, ORANGE], [199_999, ORANGE], [200_000, "rgb(239, 68, 68)"], [324_999, "rgb(239, 68, 68)"], [325_000, "rgb(153, 27, 27)"]] as const) {
      await ui.behavior.emitRealtime("state-changed", { ...initial, usedTokens });
      expect(fill(ui).style.background).toBe(color);
    }
  });

  it("marks where a thread that is on hands off by itself", async () => {
    const ui = await mount({ state: { autoHandoff: true } });
    await ui.findByRole("meter");
    expect(target(ui)?.style.left).toBe(`${150_000 / 500_000 * 100}%`);
    expect(ui.getByRole("meter").getAttribute("aria-valuetext")).toContain("hands off at 30%");
    await ui.behavior.emitRealtime("state-changed", { ...initial, autoHandoff: false });
    expect(target(ui)).toBeNull();
    expect(ui.getByRole("meter").getAttribute("aria-valuetext")).not.toContain("hands off");
  });

  it("uses the provider window and handles a missing window", async () => {
    const ui = await mount({ state: { autoHandoff: true, contextWindow: 1_000_000, usedTokens: 300_000 } });
    await ui.findByRole("meter");
    expect(fill(ui).style.width).toBe("30%");
    expect(fill(ui).style.background).toBe(ORANGE);
    await ui.behavior.emitRealtime("state-changed", { ...initial, contextWindow: null, limit: null });
    expect(ui.queryByRole("meter")).toBeNull();
    expect(ui.getByText("Context window unavailable")).toBeTruthy();
  });

  it("says it is handing off once switched on, until the notes request goes out", async () => {
    const ui = await mount({ state: { autoHandoff: true, requested: true } });
    expect((await ui.findByRole("status")).textContent).toContain("Handing off at the next safe stopping point");
    expect(target(ui)).toBeNull();
    await ui.behavior.emitRealtime("state-changed", { ...initial, autoHandoff: true, requested: true, stage: "preparing" });
    expect(ui.getByRole("status").textContent).toContain("Preparing handoff");
    await ui.behavior.emitRealtime("state-changed", { ...initial, autoHandoff: false, requested: false });
    expect(ui.queryByRole("status")).toBeNull();
  });

  it("links to the continuation after handoff", async () => {
    const ui = await mount({ state: { stage: "handed-off", nextThreadId: "thr_next", next: "confirmed" } });
    await ui.findByText(/Context handed off/);
    fireEvent.click(ui.getByRole("button", { name: /Open part 2/ }));
    expect(ui.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_next" });
  });

  it("says the next part is starting until it confirms the notes", async () => {
    const ui = await mount({ state: { stage: "handed-off", nextThreadId: "thr_next", next: "starting" } });
    expect((await ui.findByRole("status")).textContent).toContain("Part 2 is starting");
    expect(ui.queryByText(/Context handed off/)).toBeNull();
    expect(ui.getByRole("button", { name: /Open part 2/ })).toBeTruthy();
  });

  it("warns, without claiming a handoff, when the next part failed to start", async () => {
    const ui = await mount({ state: { stage: "handed-off", nextThreadId: "thr_next", next: "failed" } });
    const alert = await ui.findByRole("alert");
    expect(alert.textContent).toContain("Part 2 failed to start");
    expect(alert.textContent).toContain("archive it to cancel");
    expect(ui.queryByText(/Context handed off/)).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: /Open part 2/ }));
    expect(ui.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_next" });
  });

  it("says when the next part stopped before confirming, and how to cancel", async () => {
    const ui = await mount({ state: { stage: "handed-off", nextThreadId: "thr_next", next: "stalled" } });
    const alert = await ui.findByRole("alert");
    expect(alert.textContent).toContain("Part 2 stopped before confirming your notes");
    expect(alert.textContent).toContain("archive it to cancel");
    expect(ui.queryByText(/Context handed off/)).toBeNull();
  });

  it("shows when the next part is being started", async () => {
    const ui = await mount({ state: { stage: "preparing", autoHandoff: true, creating: true, usedTokens: 160_000 } });
    expect((await ui.findByRole("status")).textContent).toContain("Starting part 2");
  });

  it("ignores a state without the continuation fields", async () => {
    const ui = await mount();
    await ui.findByRole("meter");
    const { next: _next, creating: _creating, stuck: _stuck, requested: _requested, ...old } = initial;
    await ui.behavior.emitRealtime("state-changed", { ...old, usedTokens: 10_000 });
    expect(ui.getByRole("meter").getAttribute("aria-valuenow")).toBe("24");
  });
});
