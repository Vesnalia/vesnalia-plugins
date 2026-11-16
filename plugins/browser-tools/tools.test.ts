import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { makePluginAgentConfigurationContext, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { makePluginRig, snapshotPayload, startLifecycleService, deferred, THREAD } from "./test/plugin-rig.js";

const TOOL_NAMES = [
  "browser_open",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_screenshot",
  "browser_evaluate",
  "browser_console",
  "browser_close",
];

const contentText = (result: PluginAgentToolResult): string => {
  if (typeof result === "string") return result;
  return result.content
    .map((part) => (part.type === "text" ? part.text : `<image:${part.mimeType}>`))
    .join("\n");
};

const isError = (result: PluginAgentToolResult): boolean =>
  typeof result !== "string" && result.isError === true;

describe("browser tools registration", () => {
  it("registers all ten tools and advertises the selection from context", async () => {
    const rig = makePluginRig();
    await rig.ready;
    const registered = rig.harness.inspection.registrations.agentTools.map((tool) => tool.name).sort();
    expect(registered).toEqual([...TOOL_NAMES].sort());

    const standard = await rig.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    expect(standard.tools.map((tool) => tool.name).sort()).toEqual(
      TOOL_NAMES.filter((name) => name !== "browser_evaluate").sort(),
    );
    expect(standard.skills).toEqual(["browser-tools"]);
    const browserNotice = standard.tools.find((tool) => tool.name === "browser_open")?.instructions;
    expect(browserNotice).toContain("You can control a real browser");
    expect(browserNotice).toContain("browser-tools skill");
    expect(browserNotice).toContain("UI bugs");
    expect(standard.tools.filter((tool) => tool.instructions)).toHaveLength(1);

    const sideChat = await rig.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        origin: { kind: "fork", pluginId: "side-chat" },
      }),
    );
    expect(sideChat.tools).toEqual([]);
    expect(sideChat.skills).toEqual([]);

    const ordinaryFork = await rig.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        origin: { kind: "fork", pluginId: "other-plugin" },
      }),
    );
    expect(ordinaryFork.tools).toHaveLength(TOOL_NAMES.length - 1);
    expect(ordinaryFork.tools.find((tool) => tool.name === "browser_open")?.instructions).toBe(browserNotice);
  });

  it("advertises evaluate only after the setting is enabled", async () => {
    const rig = makePluginRig();
    await rig.ready;
    await rig.harness.behavior.setSettings({ enableEvaluate: true });
    const configured = await rig.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    expect(configured.tools.map((tool) => tool.name)).toContain("browser_evaluate");
  });

  it("uses the trusted thread context for sessions", async () => {
    const rig = makePluginRig();
    await rig.ready;
    const result = await rig.harness.behavior.callAgentTool(
      "browser_open",
      { allowPersonal: false },
      { threadId: "thr_trusted" },
    );
    expect(isError(result)).toBe(false);
    expect(contentText(result)).toContain("Session s_");
    const threadCalls = rig.harness.sdk.callsTo("threads.get");
    expect(threadCalls).toHaveLength(1);
    expect((threadCalls[0]![0] as { threadId: string }).threadId).toBe("thr_trusted");
  });

  it("rejects evaluate at execution time while disabled and runs it when enabled", async () => {
    const rig = makePluginRig();
    await rig.ready;
    const disabled = await rig.harness.behavior.callAgentTool("browser_evaluate", {
      expression: "1 + 1",
    });
    expect(isError(disabled)).toBe(true);
    expect(contentText(disabled)).toContain("EVALUATE_DISABLED");

    await rig.harness.behavior.setSettings({ enableEvaluate: true });
    await rig.harness.behavior.callAgentTool("browser_open", { allowPersonal: false });
    const enabled = await rig.harness.behavior.callAgentTool("browser_evaluate", {
      expression: "1 + 1",
    });
    expect(isError(enabled)).toBe(false);
    expect(contentText(enabled)).toContain("Evaluation result:");
  });

  it("returns screenshots as image content parts", async () => {
    const rig = makePluginRig();
    await rig.ready;
    await rig.harness.behavior.callAgentTool("browser_open", { allowPersonal: false });
    const result = await rig.harness.behavior.callAgentTool("browser_screenshot", {});
    expect(isError(result)).toBe(false);
    const parts = typeof result === "string" ? [] : result.content;
    expect(parts.some((part) => part.type === "image" && part.mimeType === "image/jpeg")).toBe(true);
    expect(contentText(result)).toContain("Viewport screenshot");
  });

  it("reports clear errors for missing, omitted, and ambiguous session selection", async () => {
    const rig = makePluginRig();
    await rig.ready;
    const missing = await rig.harness.behavior.callAgentTool("browser_snapshot", {});
    expect(contentText(missing)).toContain("SESSION_NOT_FOUND");

    const first = await rig.harness.behavior.callAgentTool("browser_open", { allowPersonal: false });
    const second = await rig.harness.behavior.callAgentTool("browser_open", { allowPersonal: false });
    expect(isError(first)).toBe(false);
    expect(isError(second)).toBe(false);

    const ambiguous = await rig.harness.behavior.callAgentTool("browser_snapshot", {});
    expect(contentText(ambiguous)).toContain("INVALID_INPUT");

    const firstSessionId = /Session (s_[^ ]+)/.exec(contentText(first))?.[1];
    expect(firstSessionId).toBeTruthy();
    const targeted = await rig.harness.behavior.callAgentTool("browser_snapshot", {
      sessionId: firstSessionId,
    });
    expect(isError(targeted)).toBe(false);
  });

  it("presents classified host failures as structured tool errors", async () => {
    const rig = makePluginRig();
    await rig.ready;
    await rig.harness.behavior.callAgentTool("browser_open", { allowPersonal: false });
    rig.impls.set("click", () => ({
      ok: false,
      error: { code: "STALE_REF", message: "The referenced element changed" },
    }));
    const result = await rig.harness.behavior.callAgentTool("browser_click", {
      ref: "abcd1234.1:e1",
    });
    expect(isError(result)).toBe(true);
    expect(contentText(result)).toBe("STALE_REF: The referenced element changed");
  });

  it("keeps snapshot output inside the shared budget", async () => {
    const rig = makePluginRig();
    await rig.ready;
    await rig.harness.behavior.callAgentTool("browser_open", { allowPersonal: false });
    rig.impls.set("snapshot", () => ({
      ok: true,
      data: { snapshot: { ...snapshotPayload(), text: "x".repeat(59_000) } },
    }));
    const result = await rig.harness.behavior.callAgentTool("browser_snapshot", {});
    expect(contentText(result).length).toBeLessThan(60_100);
  });

  it("runs the registered lifecycle service for readiness", async () => {
    const rig = makePluginRig();
    const service = startLifecycleService(rig.harness);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await rig.harness.behavior.callAgentTool("browser_open", { allowPersonal: false });
    expect(isError(result)).toBe(false);
    service.controller.abort();
    await service.done;
    await rig.ready;
    expect(THREAD).toBe("thr_1");
  });
  it.each(["STALE_REF", "ACTION_OUTCOME_UNKNOWN"])("R10 presents nested %s as native failure with lifecycle consequences", async (code) => {
    const rig = makePluginRig();
    const manager = await rig.ready;
    await rig.harness.behavior.callAgentTool("browser_open", {}, { threadId: THREAD });
    rig.impls.set("click", () => ({ ok: true, data: {
      action: { ok: false, error: { code, message: "action failed" } }, snapshot: null, snapshotError: null,
    } }));
    const result = await rig.harness.behavior.callAgentTool("browser_click", { ref: "abcd1234.1:e1" }, { threadId: THREAD });
    expect(isError(result)).toBe(true);
    expect(contentText(result)).toContain(code);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect((await manager.list(THREAD)).length).toBe(code === "ACTION_OUTCOME_UNKNOWN" ? 0 : 1);
    await manager.dispose();
  });

  it("R10 preserves successful action with failed snapshot", async () => {
    const rig = makePluginRig();
    const manager = await rig.ready;
    await rig.harness.behavior.callAgentTool("browser_open", {});
    rig.impls.set("click", () => ({ ok: true, data: {
      action: { ok: true }, snapshot: null,
      snapshotError: { code: "TARGET_UNAVAILABLE", message: "snapshot unavailable" },
    } }));
    const result = await rig.harness.behavior.callAgentTool("browser_click", { ref: "abcd1234.1:e1" });
    expect(isError(result)).toBe(false);
    expect(contentText(result)).toContain("Action succeeded, but");
    await manager.dispose();
  });

  it("thread lifecycle event waits for acquired-resource cleanup", async () => {
    const rig = makePluginRig();
    const manager = await rig.ready;
    const gate = deferred<void>();
    rig.desktop.acquireDelay = gate.promise;
    const opening = manager.open({ allowPersonal: false }, THREAD, new AbortController().signal);
    const rejected = expect(opening).rejects.toMatchObject({ code: "SESSION_STOPPED" });
    await vi.waitFor(() => expect(rig.desktop.calls).toContain("acquireControl"));
    let stopped = false;
    const stopping = rig.harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: THREAD }),
    }).then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    const stoppedBeforeAcquire = stopped;
    gate.resolve();
    await Promise.all([stopping, rejected]);
    expect(stoppedBeforeAcquire).toBe(false);
    expect(rig.desktop.leases.size).toBe(0);
    await manager.dispose();
  });

});
