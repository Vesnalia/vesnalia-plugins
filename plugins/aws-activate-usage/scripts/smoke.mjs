import assert from "node:assert/strict";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import plugin from "../dist/server.js";

const host = createFakePluginHost({ pluginId: "aws-activate-usage" });
await plugin(host.alia);

const registrations = host.harness.inspection.registrations;
assert.deepEqual(registrations.rpcMethods.sort(), ["aws_login", "credits_summary", "ui_preferences"]);
assert.equal(registrations.cli?.name, "aws-activate-usage");

await host.harness.lifecycle.dispose();
console.log("Plugin registration smoke test passed.");
