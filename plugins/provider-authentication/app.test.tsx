// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@vesnalia/plugin-sdk/testing/app";
import type { AuthAttempt, ProviderStatus } from "./contract";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

const machine = {
  id: "host-1",
  name: "Development machine",
  status: "connected" as const,
};

describe("provider authentication settings", () => {
  it("shows first-time authentication and completes the manual code flow", async () => {
    let status: ProviderStatus = { kind: "signed-out" };
    let attempt: AuthAttempt | null = null;
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listMachines: () => ({ machines: [machine] }),
          getOverview: () => ({ status, attempt }),
          beginAuthentication: () => {
            attempt = {
              id: "attempt-1",
              providerId: "claude-code",
              state: "awaiting-code",
              consentUrl:
                "https://claude.com/cai/oauth/authorize?response_type=code&state=x&code_challenge=y",
              error: null,
            };
            return attempt;
          },
          submitAuthorizationCode: () => {
            status = {
              kind: "signed-in",
              identity: "person@example.com",
              organization: null,
              subscription: "max",
            };
            attempt = {
              id: "attempt-1",
              providerId: "claude-code",
              state: "succeeded",
              consentUrl: null,
              error: null,
            };
            return attempt;
          },
          cancelAuthentication: () => ({
            id: "attempt-1",
            providerId: "claude-code" as const,
            state: "cancelled" as const,
            consentUrl: null,
            error: null,
          }),
        },
      },
    );

    const authenticate = await slot.findByRole("button", { name: "Authenticate" });
    fireEvent.click(authenticate);

    const consentLink = (await slot.findByRole("link", {
      name: "Open Claude consent screen",
    })) as HTMLAnchorElement;
    expect(consentLink.hostname).toBe("claude.com");

    const codeInput = slot.getByLabelText("Authorization code") as HTMLInputElement;
    fireEvent.change(codeInput, { target: { value: "opaque-code#state" } });
    fireEvent.click(slot.getByRole("button", { name: "Submit code" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "submitAuthorizationCode",
        input: {
          hostId: "host-1",
          providerId: "claude-code",
          attemptId: "attempt-1",
          code: "opaque-code#state",
        },
      }),
    );
    await slot.findByText("Claude Code is authenticated on this machine.");
    expect(slot.queryByDisplayValue("opaque-code#state")).toBeNull();
  });

  it("shows reauthentication and account details for a signed-in CLI", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listMachines: () => ({ machines: [machine] }),
          getOverview: () => ({
            status: {
              kind: "signed-in" as const,
              identity: "person@example.com",
              organization: "Example",
              subscription: "max",
            },
            attempt: null,
          }),
        },
      },
    );

    await slot.findByRole("button", { name: "Reauthenticate" });
    slot.getByText("person@example.com");
    slot.getByText("max subscription");
  });

  it("disables authentication when Claude is missing or the machine is offline", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          listMachines: () => ({ machines: [machine] }),
          getOverview: () => ({
            status: { kind: "cli-missing" as const },
            attempt: null,
          }),
        },
      },
    );

    await slot.findByText("Not installed");
    expect(slot.queryByRole("button", { name: "Authenticate" })).toBeNull();
  });
});
