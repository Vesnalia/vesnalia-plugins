import { describe, expect, it } from "vitest";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { resolveProjectCwd } from "../adopt/adopt-core";
import { runAdoptCli } from "../adopt/cli";

// A VesnALIA that throws on any touch: these paths must fail before reaching the sdk.
const untouchedAlia = new Proxy({} as AliaPluginApi, {
  get(_target, property) {
    throw new Error(`VesnALIA.${String(property)} was touched before validation finished`);
  },
});

describe("adopt cli validation", () => {
  it("rejects an unknown --effort level before doing any work", async () => {
    const result = await runAdoptCli(
      untouchedAlia,
      ["session", "--cwd", "/tmp", "--effort", "bogus"],
      {},
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--effort must be one of");
    expect(result.stderr).toContain("xhigh");
  });

  it("rejects an unknown subcommand with the help text", async () => {
    const result = await runAdoptCli(untouchedAlia, ["definitely-not-a-command"], {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown adopt command "definitely-not-a-command"');
  });

  it("requires a directory when neither cwd nor machine is known", async () => {
    const result = await runAdoptCli(untouchedAlia, ["list"], {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--cwd");
  });
});

describe("resolveProjectCwd", () => {
  const alia = {
    sdk: {
      projects: {
        list: async () => [
          {
            id: "proj_1",
            name: "Aurora",
            sources: [
              { hostId: "host_a", path: "/Users/dev/Git/aurora", isDefault: true },
              { hostId: "host_b", path: "/Users/mini/Git/aurora", isDefault: false },
            ],
          },
        ],
      },
    },
  } as unknown as AliaPluginApi;

  it("prefers the default source when no host is named", async () => {
    expect(await resolveProjectCwd(alia, "proj_1")).toBe("/Users/dev/Git/aurora");
  });

  it("only counts sources on the named host", async () => {
    expect(await resolveProjectCwd(alia, "proj_1", "host_b")).toBe("/Users/mini/Git/aurora");
  });

  it("returns null when the project has no source on that host", async () => {
    expect(await resolveProjectCwd(alia, "proj_1", "host_c")).toBeNull();
  });
});
