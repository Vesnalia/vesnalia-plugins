import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

function alia(...args) {
  return execFileSync("alia", args, { encoding: "utf8" }).trim();
}

const inventory = JSON.parse(alia("plugin", "list", "--json"));
const installed = inventory.plugins.find((plugin) => plugin.id === "touchbar");
assert.equal(installed?.status, "running");
assert.equal(installed?.cliCommand?.name, "touchbar");

const snapshot = JSON.parse(alia("touchbar", "snapshot"));
assert.equal(snapshot.schemaVersion, 1);
assert.ok(snapshot.threads.length <= 24);
assert.equal(typeof snapshot.summary.active, "number");
assert.match(alia("touchbar", "card", "summary"), /^ALIA /u);

const rejected = spawnSync("alia", ["touchbar", "stop", "definitely-not-a-thread"], {
  encoding: "utf8",
});
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /not found/u);

console.log("Touch Bar live VesnALIA smoke passed.");
