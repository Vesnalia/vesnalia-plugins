import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@vesnalia/plugin-sdk/testing";
import plugin from "./server";

describe("Miku server bridge", () => {
  it("registers lifecycle listeners and the optional Tasks watcher", async () => {
    const { alia, harness } = createFakePluginHost({ pluginId: "miku" });
    await plugin(alia);

    expect(harness.registrations.services.map((service) => service.name)).toEqual([
      "brain",
      "task-events",
    ]);
    expect(harness.registrations.threadEventHandlers).toMatchObject({
      "thread.created": 1,
      "thread.active": 1,
      "thread.idle": 1,
      "thread.failed": 1,
      "thread.archived": 1,
      "thread.deleted": 1,
      "interaction.pending": 1,
      "message.queued": 1,
      "message.dispatched": 1,
      "turn.failed": 1,
    });

    await harness.dispose();
  });

  it("publishes a scoped companion event after a thread completes", async () => {
    const { alia, harness } = createFakePluginHost({ pluginId: "miku" });
    await plugin(alia);

    await harness.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_done", projectId: "proj_demo" }),
      lastAssistantText: "Finished",
    });

    expect(harness.realtimeSignals.at(-1)).toMatchObject({
      channel: "companion-events",
      payload: {
        type: "thread-idle",
        threadId: "thr_done",
        projectId: "proj_demo",
      },
    });

    await harness.dispose();
  });

  it("serves the animation test bench with local auth", async () => {
    const { alia, harness } = createFakePluginHost({ pluginId: "miku" });
    await plugin(alia);

    const response = await harness.fetchHttp("GET", "/test-bench");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Miku animation test bench");

    await harness.dispose();
  });

  it("creates a provider-configured hidden brain thread", async () => {
    const brainThread = makeThreadResponse({
      id: "thr_brain",
      projectId: "proj_demo",
      providerId: "codex",
      title: "Miku's hidden brain",
      visibility: "hidden",
      originPluginId: "miku",
      status: "idle",
    });
    const { alia, harness } = createFakePluginHost({
      pluginId: "miku",
      settings: { brainProject: "proj_demo" },
      sdk: {
        threads: {
          spawn: async () => brainThread,
          wait: async () => ({
            matched: true,
            target: { kind: "status", status: "idle" },
            thread: brainThread,
            threadId: brainThread.id,
          }),
          stop: async () => ({ ok: true }),
        },
      },
    });
    await plugin(alia);

    const result = await harness.behavior.callRpc("brain.create", {
      projectId: "proj_demo",
      selection: {
        providerId: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "high",
        serviceTier: "fast",
        permissionMode: "full",
      },
    });

    expect(result).toMatchObject({ thread: { id: "thr_brain" } });
    expect(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0]).toMatchObject({
      projectId: "proj_demo",
      providerId: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "full",
      visibility: "hidden",
    });
    expect(harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);

    await harness.dispose();
  });
});
