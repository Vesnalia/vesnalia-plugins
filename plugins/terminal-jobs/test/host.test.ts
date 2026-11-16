import path from "node:path";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it } from "vitest";
import hostEntry from "../host.js";

describe("terminal job host entry", () => {
  it("reports the bundled runner command through the strict host contract", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    const readiness = await harness.experimental_call("runner.readiness", null);
    const { artifactPath, ...details } = readiness;
    expect(details).toEqual({
      protocolVersion: 1,
      supported: process.platform !== "win32",
      execPath: process.execPath,
      nodeVersion: process.version,
      platform: process.platform,
    });
    expect(path.isAbsolute(artifactPath)).toBe(true);
    await harness.experimental_dispose();
  });

  it("uses only public SDK and package-local imports", async () => {
    const result = await experimental_scanPublicSdkOnly(path.resolve(import.meta.dirname, ".."), {
      allow: [/^vitest(?:\/config)?$/u, /^better-sqlite3$/u],
    });
    expect(result.violations).toEqual([]);
    expect(result.privateDependencies).toEqual([]);
  });
});
