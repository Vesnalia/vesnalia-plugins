import { test, expect } from "vitest";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import plugin from "../server";

test("ping returns ok", async () => {
  const { alia, harness } = createFakePluginHost({ pluginId: "guided-review" });
  await plugin(alia);
  const res = await harness.behavior.callRpc("ping", null);
  expect(res).toEqual({ ok: true });
});
