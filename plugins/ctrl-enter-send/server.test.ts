import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import plugin from "./server.ts";

test("settings accept all send modes and reject invalid saved values", async () => {
  const { alia, harness } = createFakePluginHost({ pluginId: "ctrl-enter-send" });
  try {
    await plugin(alia);
    for (const sendShortcut of ["ctrl-enter", "enter", "shift-enter", null]) {
      await harness.behavior.setSettings({ sendShortcut });
    }
    await assert.rejects(
      harness.behavior.setSettings({ sendShortcut: "alt-enter" }),
    );
    await assert.rejects(harness.behavior.setSettings({ sendShortcut: true }));
  } finally {
    await harness.lifecycle.dispose();
  }
});
