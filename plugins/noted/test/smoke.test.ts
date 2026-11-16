import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import plugin from "../server";

describe("noted plugin", () => {
  it("loads and disposes cleanly", async () => {
    const { alia, harness } = createFakePluginHost({ pluginId: "noted" });
    await plugin(alia);
    expect(JSON.stringify(harness.logEntries)).toContain("noted loaded");
    await harness.lifecycle.dispose();
    expect(JSON.stringify(harness.logEntries)).toContain("noted disposed");
  });
});
