import { describe, expect, it } from "vitest";
import { fakeSkiff, fakeTunnels } from "./fakes";
import { PROVIDER_ID } from "./machine";
import { reconcile, sleep, type TrackedHost } from "./reconcile";

function host(id: string, phase: string, status: "connected" | "disconnected" = "connected", providerId = PROVIDER_ID): TrackedHost {
  return { id, machineProviderId: providerId, status, lifecycle: { phase } };
}

describe("reconcile", () => {
  it("keeps tracked VMs, opens tunnels for active ones, closes the rest and collects forgotten VMs", async () => {
    const skiff = fakeSkiff([
      { name: "alia-active", state: "running", ip: "", owner: "alia", slot: "" },
      { name: "alia-suspended", state: "stopped", ip: "", owner: "alia", slot: "" },
      { name: "alia-forgotten", state: "running", ip: "", owner: "alia", slot: "" },
      { name: "mine", state: "running", ip: "", owner: "", slot: "" },
    ]);
    const tunnels = fakeTunnels();
    tunnels.tunnels.ensure("alia-stale");
    const resources: Record<string, unknown> = {
      h1: { vm: "alia-active" },
      h2: { vm: "alia-suspended" },
      h3: null,
    };
    const logs: string[] = [];
    const result = await reconcile({
      listHosts: async () => [
        host("h1", "active"),
        host("h2", "suspended"),
        host("h3", "creating"),
        host("h4", "destroyed"),
        host("h5", "active", "connected", "manual"),
      ],
      getResource: async (id) => (resources[id] as never) ?? null,
      skiff: skiff.skiff,
      tunnels: tunnels.tunnels,
      log: (message) => logs.push(message),
    });
    expect(result).toEqual({ tracked: ["alia-active", "alia-suspended"], tunnels: ["alia-active"] });
    expect(tunnels.events).toEqual(["ensure alia-stale", "stop alia-stale", "ensure alia-active"]);
    expect([...skiff.vms.keys()]).toEqual(["alia-active", "alia-suspended", "mine"]);
    expect(logs).toEqual([]);
  });

  it("logs a gc failure instead of throwing", async () => {
    const skiff = fakeSkiff();
    skiff.failures.set("gc", new Error("container service down"));
    const logs: string[] = [];
    await reconcile({
      listHosts: async () => [],
      getResource: async () => null,
      skiff: skiff.skiff,
      tunnels: fakeTunnels().tunnels,
      log: (message) => logs.push(message),
    });
    expect(logs).toEqual(["skiff gc failed: container service down"]);
  });
});

describe("sleep", () => {
  it("wakes on abort", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = sleep(60_000, controller.signal);
    controller.abort();
    await pending;
    expect(Date.now() - started).toBeLessThan(1000);
    await sleep(1000, controller.signal); // already aborted: resolves at once
  });
});
