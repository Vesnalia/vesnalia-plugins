import assert from "node:assert/strict";
import { test } from "node:test";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { AliaReviewer } from "./alia-reviewer.ts";

type TurnCompletedData = { status: "completed" | "failed" | "interrupted"; error?: { message: string } };
type EventRow = { type: string; data: TurnCompletedData };
type SpawnRequest = { projectId: string };

function aliaFixture(event: EventRow | null, output = "NO FINDINGS") {
  const calls: { spawn: SpawnRequest[]; stop: string[]; archive: string[]; output: string[] } = { spawn: [], stop: [], archive: [], output: [] };
  const alia = {
    sdk: {
      threads: {
        spawn: async (request: SpawnRequest) => { calls.spawn.push(request); return { id: "worker-1" }; },
        events: { wait: async () => event },
        output: async ({ threadId }: { threadId: string }) => { calls.output.push(threadId); return { output }; },
        stop: async ({ threadId }: { threadId: string }) => { calls.stop.push(threadId); },
        archive: async ({ threadId }: { threadId: string }) => { calls.archive.push(threadId); },
      },
    },
  };
  return { alia: alia as unknown as AliaPluginApi, calls };
}
test("VesnALIA reviewer binds a spawned worker to the run project and persists its ID before waiting", async () => {

  const { alia, calls } = aliaFixture({ type: "turn/completed", data: { status: "completed" } });
  const reviewer = new AliaReviewer(alia, async () => 1_000);
  const workers: string[] = [];
  const result = await reviewer.complete([{ role: "user", content: "review this" }], new AbortController().signal, {
    projectId: "project-1", environmentId: null, provider: null, model: null,
    onWorkerThread: (id) => workers.push(id),
  });
  assert.deepEqual(workers, ["worker-1"]);
  assert.equal(calls.spawn[0]?.projectId, "project-1");
  assert.equal(result.ok, true);
  assert.deepEqual(calls.output, ["worker-1"]);
  assert.deepEqual(calls.stop, []);
  assert.deepEqual(calls.archive, ["worker-1"]);
});
test("VesnALIA reviewer rejects a failed terminal turn, never reads output, then stops and archives it", async () => {

  const { alia, calls } = aliaFixture({ type: "turn/completed", data: { status: "failed", error: { message: "provider failed" } } });
  const reviewer = new AliaReviewer(alia, async () => 1_000);
  const result = await reviewer.complete([{ role: "user", content: "review this" }], new AbortController().signal, {
    projectId: "project-1", environmentId: null, provider: null, model: null,
  });
  assert.deepEqual(result, { ok: false, kind: "failed", error: "provider failed" });
  assert.deepEqual(calls.output, []);
  assert.deepEqual(calls.stop, ["worker-1"]);
  assert.deepEqual(calls.archive, ["worker-1"]);
});
