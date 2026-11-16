import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";

const connectedHost = {
  id: "host-1",
  name: "Development machine",
  status: "connected" as const,
  type: "persistent" as const,
  createdAt: 1,
  updatedAt: 1,
  lastSeenAt: 1,
  lastRejectedProtocolVersion: null,
  maxPermissionMode: "full" as const,
};

describe("provider authentication server", () => {
  it("lists machines and routes status inspection to the selected host", async () => {
    const callHost = vi.fn(({ method }: { method: string }) => {
      if (method === "inspect") {
        return {
          kind: "signed-in",
          identity: "person@example.com",
          organization: "Example",
          subscription: "max",
        };
      }
      if (method === "getAttempt") return null;
      throw new Error(`Unexpected method: ${method}`);
    });
    const { alia, harness } = createFakePluginHost({
      pluginId: "provider-authentication",
      sdk: {
        hosts: {
          list: async () => [connectedHost],
          get: async () => connectedHost,
        },
      },
      experimental_callHostRpc: callHost,
    });
    await plugin(alia);

    await expect(harness.behavior.callRpc("listMachines")).resolves.toEqual({
      machines: [
        { id: "host-1", name: "Development machine", status: "connected" },
      ],
    });
    await expect(
      harness.behavior.callRpc("getOverview", { hostId: "host-1" }),
    ).resolves.toEqual({
      status: {
        kind: "signed-in",
        identity: "person@example.com",
        organization: "Example",
        subscription: "max",
      },
      attempt: null,
    });
    expect(
      harness.inspection.experimental_hostRpcCalls.every(
        (call) => call.hostId === "host-1",
      ),
    ).toBe(true);
    await harness.lifecycle.dispose();
  });

  it("starts, submits, and cancels attempts without retaining authorization codes", async () => {
    const callHost = vi.fn(({ method, input }: { method: string; input: unknown }) => {
      const values = input as { attemptId?: string };
      if (method === "begin") {
        return {
          id: values.attemptId,
          providerId: "claude-code",
          state: "awaiting-code",
          consentUrl:
            "https://claude.com/cai/oauth/authorize?response_type=code&state=x&code_challenge=y",
          error: null,
        };
      }
      if (method === "submitCode") {
        return {
          id: values.attemptId,
          providerId: "claude-code",
          state: "succeeded",
          consentUrl: null,
          error: null,
        };
      }
      if (method === "cancel") {
        return {
          id: values.attemptId,
          providerId: "claude-code",
          state: "cancelled",
          consentUrl: null,
          error: null,
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const { alia, harness } = createFakePluginHost({
      sdk: { hosts: { get: async () => connectedHost } },
      experimental_callHostRpc: callHost,
    });
    await plugin(alia);

    const attempt = (await harness.behavior.callRpc("beginAuthentication", {
      hostId: "host-1",
      providerId: "claude-code",
    })) as { id: string };
    await harness.behavior.callRpc("submitAuthorizationCode", {
      hostId: "host-1",
      providerId: "claude-code",
      attemptId: attempt.id,
      code: "one-time-code#state",
    });
    const submittedCall = harness.inspection.experimental_hostRpcCalls.find(
      (call) => call.method === "submitCode",
    );
    expect(submittedCall?.hostId).toBe("host-1");
    expect(harness.inspection.realtimeSignals).not.toContainEqual(
      expect.objectContaining({ payload: expect.stringContaining("one-time-code") }),
    );
    await harness.lifecycle.dispose();
  });

  it("reports an offline machine without starting a host worker", async () => {
    const offlineHost = { ...connectedHost, status: "disconnected" as const };
    const callHost = vi.fn();
    const { alia, harness } = createFakePluginHost({
      sdk: { hosts: { get: async () => offlineHost } },
      experimental_callHostRpc: callHost,
    });
    await plugin(alia);

    await expect(
      harness.behavior.callRpc("getOverview", { hostId: "host-1" }),
    ).resolves.toEqual({
      status: { kind: "unavailable", message: "This machine is offline." },
      attempt: null,
    });
    expect(callHost).not.toHaveBeenCalled();
    await harness.lifecycle.dispose();
  });

  it("publishes a safe invalidation when host attempt state changes", async () => {
    const { alia, harness } = createFakePluginHost();
    await plugin(alia);

    await harness.behavior.experimental_emitHostSignal(
      "host-1",
      "attemptChanged",
      { attemptId: "attempt-1", state: "awaiting-code" },
    );
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "provider-authentication.changed",
      payload: { hostId: "host-1" },
    });
    await harness.lifecycle.dispose();
  });
});
