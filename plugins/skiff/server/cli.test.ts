import { describe, expect, it } from "vitest";
import { USAGE, runCli } from "./cli";
import { fakeSkiff } from "./fakes";

const deps = () => {
  const skiff = fakeSkiff([
    { name: "alia-one", state: "running", ip: "192.168.64.5", owner: "alia", slot: "" },
    { name: "mine", state: "running", ip: "192.168.64.6", owner: "", slot: "" },
  ]);
  return { skiff: skiff.skiff, reconcile: async () => ({ tracked: ["alia-one"], tunnels: ["alia-one"] }) };
};

describe("alia skiff CLI", () => {
  it("prints usage without a command and for unknown commands", async () => {
    expect(await runCli([], deps())).toEqual({ exitCode: 0, stdout: USAGE });
    expect(await runCli(["nope"], deps())).toEqual({ exitCode: 1, stderr: USAGE });
  });

  it("lists only VMs owned by VesnALIA", async () => {
    const result = await runCli(["vms", "--json"], deps());
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual([
      { name: "alia-one", state: "running", ip: "192.168.64.5", owner: "alia", slot: "" },
    ]);
    expect((await runCli(["vms"], deps())).stdout).toContain("alia-one");
  });

  it("runs reconcile on request", async () => {
    const result = await runCli(["reconcile"], deps());
    expect(result).toEqual({ exitCode: 0, stdout: "tracked: alia-one\ntunnels: alia-one" });
  });

  it("turns errors into exit code 1", async () => {
    const d = deps();
    const result = await runCli(["reconcile"], { ...d, reconcile: async () => { throw new Error("boom"); } });
    expect(result).toEqual({ exitCode: 1, stderr: "boom" });
  });
});
