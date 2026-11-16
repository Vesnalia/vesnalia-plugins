import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.ts";

test("dispatch blocks attachment secrets, preserves text checks and handles read failures", async () => {
  const secret = "ghp_" + "q".repeat(36);
  let content = "safe file";
  let fail = false;
  let reads = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "token-guard",
    sdk: { projects: { attachments: { read: async ({ projectId }) => {
      assert.equal(projectId, "project-test");
      reads++;
      if (fail) throw new Error(`untrusted error ${secret}`);
      return { bytes: new TextEncoder().encode(content), mimeType: "text/plain", sizeBytes: content.length };
    } } } },
  });
  try {
    await plugin(bb);
    const hook = harness.registrations.hooks["message.dispatch"]!;
    const context = makeMessageDispatchHookContext({ project: { id: "project-test" }, input: {
      text: "проверь файл", blocks: [{ type: "localFile", path: "uploads/file.txt" }],
    } });
    assert.equal((await hook(context)).action, "proceed");
    content = secret;
    const blocked = await hook(context);
    assert.equal(blocked.action, "reject");
    assert.ok(!JSON.stringify(blocked).includes(secret));
    assert.equal((await harness.behavior.callRpc("state", null) as { blocked: number }).blocked, 1);
    fail = true;
    const unreadable = await hook(context);
    assert.equal(unreadable.action, "reject");
    assert.ok(!JSON.stringify(unreadable).includes(secret));
    const priorReads = reads;
    const textBlocked = await hook({ ...context, input: { ...context.input, text: secret } });
    assert.equal(textBlocked.action, "reject");
    assert.equal(reads, priorReads);
    assert.equal((await hook({ ...context, initiator: "system" })).action, "proceed");
  } finally { await harness.lifecycle.dispose(); }
});

test("disabled guard does not register a dispatch hook", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "token-guard", settings: { enabled: false } });
  try {
    await plugin(bb);
    assert.equal(harness.registrations.hooks["message.dispatch"], null);
  } finally { await harness.lifecycle.dispose(); }
});
