import type { PluginCliContext } from "@get-bb/plugin-sdk";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server.js";
import { RUNNER_ARGUMENT } from "../src/host-contract.js";
import { JobStore } from "../src/store.js";

const ready = {
  protocolVersion: 1,
  supported: true,
  execPath: process.execPath,
  artifactPath: "/tmp/terminal jobs/dist/host.js",
  nodeVersion: process.version,
  platform: process.platform,
};

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    id: "term_target",
    title: "job title",
    hostId: "host_target",
    threadId: "thr_owner",
    environmentId: "env_target",
    initialCwd: "/workspace",
    status: "running",
    exitCode: null,
    closeReason: null,
    ...overrides,
  };
}

async function load(options: {
  readiness?: unknown | (() => unknown);
  remove?: (args: unknown) => unknown;
} = {}): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    pluginId: "terminal-jobs",
    experimental_callHostRpc: async () => {
      if (typeof options.readiness === "function") return options.readiness();
      return options.readiness ?? ready;
    },
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, environmentId: "env_target" }),
        send: async () => ({ ok: true, delivery: "sent" }),
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => ({
          id: environmentId,
          hostId: "host_target",
          path: "/workspace",
        }),
      },
      terminals: {
        create: async () => terminal(),
        get: async () => terminal({ status: "exited", exitCode: 0, closeReason: "process-exit" }),
      },
      files: {
        read: async () => {
          throw Object.assign(new Error("missing"), { status: 404 });
        },
        remove: async (args: unknown) => options.remove?.(args) ?? { ok: true },
      },
    } as never,
  });
  await plugin(host.bb);
  return host;
}

async function run(host: FakePluginHost, extra: string[] = [], ctx: PluginCliContext = { threadId: "thr_owner" }) {
  return host.harness.behavior.runCli(
    [
      "run",
      "--title",
      "demo",
      "--artifact-root",
      "/tmp/jobs",
      "--json",
      ...extra,
      "--",
      "printf",
      "%s",
      "secret argv",
    ],
    ctx,
  );
}

async function watch(host: FakePluginHost, name: string) {
  const result = await host.harness.behavior.runCli([
    "watch",
    `term_${name}`,
    "--notify-thread",
    "thr_owner",
    "--log",
    `/tmp/${name}.log`,
    "--json",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { jobId: string };
}

function settle(host: FakePluginHost, jobId: string, ageDays = 2): void {
  host.bb.storage.database().prepare(
    `UPDATE jobs SET terminal_state = 'exited', outcome_state = CASE source WHEN 'watch' THEN 'not-applicable' ELSE 'missing' END,
       delivery_state = 'delivered', accepted_delivery_kind = 'sent', delivered_at = 1,
       reservation_token = NULL, next_attempt_at = NULL, updated_at = ? WHERE job_id = ?`,
  ).run(Date.now() - ageDays * 86_400_000, jobId);
}

function rowCount(host: FakePluginHost): number {
  return (host.bb.storage.database().prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;
}

describe("host runner readiness", () => {
  it("targets the resolved host before persistence and launches the bundled artifact once", async () => {
    const host = await load();
    const signal = new AbortController().signal;
    const result = await run(host, [], { threadId: "thr_owner", signal });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(host.harness.inspection.experimental_hostRpcCalls).toMatchObject([
      { method: "runner.readiness", input: null, hostId: "host_target" },
    ]);
    expect(host.harness.inspection.experimental_hostRpcCalls[0]?.signal).toBe(signal);
    expect(host.harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
    const args = host.harness.inspection.sdk.callsTo("terminals.create")[0]![0] as {
      start: { command: string };
    };
    expect(args.start.command).toContain(`'${process.execPath}' '/tmp/terminal jobs/dist/host.js'`);
    expect(args.start.command).toContain(`'${RUNNER_ARGUMENT}'`);
    expect(rowCount(host)).toBe(1);
    await host.harness.lifecycle.dispose();
  });

  it.each([
    [{ ...ready, supported: false, platform: "win32" }, "unsupported"],
    [{ ...ready, protocolVersion: 2 }, "protocol 2"],
    [{ ...ready, nodeVersion: "v21.9.0" }, "Node v21.9.0"],
    [{ ...ready, execPath: "relative/node" }, "absolute POSIX"],
    [{ ...ready, artifactPath: "/tmp/bad\npath" }, "control characters"],
  ] as const)("rejects incompatible readiness before creating a row: %s", async (readiness, message) => {
    const host = await load({ readiness });
    const result = await run(host);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
    expect(rowCount(host)).toBe(0);
    expect(host.harness.inspection.sdk.callsTo("terminals.create")).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("reports a transport failure before persistence", async () => {
    const host = await load({
      readiness: () => {
        throw new Error("host offline");
      },
    });
    const result = await run(host);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("readiness failed: host offline");
    expect(rowCount(host)).toBe(0);
    expect(host.harness.inspection.sdk.callsTo("terminals.create")).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("does not call host readiness for watch", async () => {
    const host = await load({
      readiness: () => {
        throw new Error("must not run");
      },
    });
    await watch(host, "existing");
    expect(host.harness.inspection.experimental_hostRpcCalls).toEqual([]);
    await host.harness.lifecycle.dispose();
  });
});

describe("bounded list", () => {
  it("lists newest first without argv and skips a malformed row without changing it", async () => {
    const host = await load();
    const first = await run(host);
    const second = await run(host);
    const firstId = JSON.parse(first.stdout).jobId as string;
    const secondId = JSON.parse(second.stdout).jobId as string;
    const db = host.bb.storage.database();
    db.prepare("UPDATE jobs SET created_at = 1, scope_json = '{}' WHERE job_id = ?").run(firstId);
    db.prepare("UPDATE jobs SET created_at = 2 WHERE job_id = ?").run(secondId);

    const result = await host.harness.behavior.runCli(["list", "--limit", "20", "--json"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.jobs.map((job: { jobId: string }) => job.jobId)).toEqual([secondId]);
    expect(value.skipped).toEqual([{ jobId: firstId, error: "invalid stored scope" }]);
    expect(result.stdout).not.toContain("secret argv");
    expect(db.prepare("SELECT scope_json FROM jobs WHERE job_id = ?").get(firstId)).toEqual({ scope_json: "{}" });
    await host.harness.lifecycle.dispose();
  });

  it.each(["0", "-1", "1.5", "word", "Infinity", "9007199254740992", "201"])(
    "rejects list limit %s",
    async (limit) => {
      const host = await load();
      const result = await host.harness.behavior.runCli(["list", "--limit", limit]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("from 1 through 200");
      await host.harness.lifecycle.dispose();
    },
  );
});

describe("explicit prune", () => {
  it("previews without mutation and deletes run artifacts before the claimed row", async () => {
    const removes: unknown[] = [];
    const host = await load({ remove: (args) => { removes.push(args); return { ok: true }; } });
    const created = await run(host);
    const jobId = JSON.parse(created.stdout).jobId as string;
    settle(host, jobId);

    const preview = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--json",
    ]);
    expect(JSON.parse(preview.stdout).results).toEqual([{ jobId, action: "would-delete" }]);
    expect(removes).toEqual([]);
    expect(rowCount(host)).toBe(1);

    const deletion = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(deletion.stdout).results).toEqual([{ jobId, action: "deleted" }]);
    expect(removes).toEqual([
      { hostId: "host_target", rootPath: "/tmp/jobs", path: `/tmp/jobs/${jobId}`, recursive: true },
    ]);
    expect(rowCount(host)).toBe(0);
    await host.harness.lifecycle.dispose();
  });

  it("selects the oldest eligible rows first and applies the limit", async () => {
    const host = await load();
    const older = JSON.parse((await run(host)).stdout).jobId as string;
    const newer = JSON.parse((await run(host)).stdout).jobId as string;
    settle(host, older, 3);
    settle(host, newer, 2);
    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--limit", "1", "--json",
    ]);
    expect(JSON.parse(result.stdout).results).toEqual([{ jobId: older, action: "would-delete" }]);
    await host.harness.lifecycle.dispose();
  });

  it("deletes a watched row without removing its caller-owned log directory", async () => {
    const removes: unknown[] = [];
    const host = await load({ remove: (args) => { removes.push(args); return { ok: true }; } });
    const created = await watch(host, "watched");
    settle(host, created.jobId);
    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(result.stdout).results).toEqual([{ jobId: created.jobId, action: "deleted" }]);
    expect(removes).toEqual([]);
    expect(rowCount(host)).toBe(0);
    await host.harness.lifecycle.dispose();
  });

  it("cannot select active, unsettled, or too-new rows", async () => {
    const host = await load();
    const active = JSON.parse((await run(host)).stdout).jobId as string;
    const unsettled = JSON.parse((await run(host)).stdout).jobId as string;
    const tooNew = JSON.parse((await run(host)).stdout).jobId as string;
    const db = host.bb.storage.database();
    db.prepare("UPDATE jobs SET updated_at = ? WHERE job_id = ?").run(Date.now() - 2 * 86_400_000, active);
    settle(host, unsettled);
    db.prepare("UPDATE jobs SET outcome_state = 'unchecked' WHERE job_id = ?").run(unsettled);
    settle(host, tooNew, 0);

    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(result.stdout).results).toEqual([]);
    expect(rowCount(host)).toBe(3);
    await host.harness.lifecycle.dispose();
  });

  it("atomically reclaims a prior generation claim before remote removal", async () => {
    let jobId = "";
    const priorToken = "generation_prior:prune_prior";
    const host = await load({
      remove: () => {
        const store = new JobStore(host.bb.storage.database());
        expect(store.get(jobId)?.pruneClaimToken).not.toBeNull();
        expect(store.get(jobId)?.pruneClaimToken).not.toBe(priorToken);
        expect(store.retry(jobId, Date.now())).toBeNull();
        return { ok: true };
      },
    });
    jobId = JSON.parse((await run(host)).stdout).jobId as string;
    settle(host, jobId);
    host.bb.storage.database().prepare(
      "UPDATE jobs SET delivery_state = 'abandoned', accepted_delivery_kind = NULL, delivered_at = NULL, prune_claim_token = ? WHERE job_id = ?",
    ).run(priorToken, jobId);

    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(result.stdout).results).toEqual([{ jobId, action: "deleted" }]);
    expect(rowCount(host)).toBe(0);
    await host.harness.lifecycle.dispose();
  });

  it("restores a prior generation claim when reclaimed removal fails", async () => {
    const priorToken = "generation_prior:prune_prior";
    const host = await load({
      remove: () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      },
    });
    const jobId = JSON.parse((await run(host)).stdout).jobId as string;
    settle(host, jobId);
    host.bb.storage.database().prepare(
      "UPDATE jobs SET delivery_state = 'abandoned', accepted_delivery_kind = NULL, delivered_at = NULL, prune_claim_token = ? WHERE job_id = ?",
    ).run(priorToken, jobId);

    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(result.stdout).results).toEqual([
      { jobId, action: "kept", error: "permission denied" },
    ]);
    const stored = new JobStore(host.bb.storage.database()).get(jobId);
    expect(stored?.pruneClaimToken).toBe(priorToken);
    expect(stored?.deliveryState).toBe("abandoned");
    const retry = await host.harness.behavior.runCli(["retry-notification", jobId]);
    expect(retry.exitCode).toBe(1);
    expect(retry.stderr).toContain("claimed for pruning");
    await host.harness.lifecycle.dispose();
  });

  it("blocks retry while remote removal holds the durable prune claim", async () => {
    let removalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { removalStarted = resolve; });
    const held = new Promise<{ ok: true }>((resolve) => { release = () => resolve({ ok: true }); });
    const host = await load({
      remove: () => {
        removalStarted();
        return held;
      },
    });
    const created = await run(host);
    const jobId = JSON.parse(created.stdout).jobId as string;
    settle(host, jobId);
    host.bb.storage.database().prepare(
      "UPDATE jobs SET delivery_state = 'abandoned', accepted_delivery_kind = NULL, delivered_at = NULL WHERE job_id = ?",
    ).run(jobId);

    const pruning = host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    await started;
    const service = host.harness.behavior.runService("reconciler");
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.controller.abort();
    await service.done;
    const retry = await host.harness.behavior.runCli(["retry-notification", jobId]);
    expect(retry.exitCode).toBe(1);
    expect(retry.stderr).toContain("claimed for pruning");
    const concurrentPrune = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(concurrentPrune.stdout).results).toEqual([]);
    release();
    await pruning;
    expect(rowCount(host)).toBe(0);
    await host.harness.lifecycle.dispose();
  });

  it.each([
    ["artifact_root", "relative"],
    ["job_directory", "/tmp/jobs/other"],
    ["launch_path", "/tmp/jobs/other-launch.json"],
    ["log_path", "/tmp/jobs/other-output.log"],
    ["outcome_path", "/tmp/jobs/other-outcome.json"],
    ["marker", "[terminal-job:other]"],
  ] as const)("keeps a row with corrupt %s", async (column, badValue) => {
    const removes: unknown[] = [];
    const host = await load({ remove: (args) => { removes.push(args); return { ok: true }; } });
    const created = await run(host);
    const jobId = JSON.parse(created.stdout).jobId as string;
    settle(host, jobId);
    host.bb.storage.database().prepare(`UPDATE jobs SET ${column} = ? WHERE job_id = ?`).run(badValue, jobId);
    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(result.stdout).results).toEqual([
      { jobId, action: "kept", error: expect.any(String) },
    ]);
    expect(removes).toEqual([]);
    expect(rowCount(host)).toBe(1);
    await host.harness.lifecycle.dispose();
  });

  it("treats missing artifacts as removed but retains rows after other removal failures", async () => {
    let mode: "missing" | "denied" = "missing";
    const host = await load({
      remove: () => {
        if (mode === "missing") throw Object.assign(new Error("gone"), { code: "not_found" });
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      },
    });
    const missing = JSON.parse((await run(host)).stdout).jobId as string;
    settle(host, missing);
    await host.harness.behavior.runCli(["prune", "--older-than-days", "1", "--delete"]);
    expect(new JobStore(host.bb.storage.database()).get(missing)).toBeNull();

    mode = "denied";
    const denied = JSON.parse((await run(host)).stdout).jobId as string;
    settle(host, denied);
    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(result.stdout).results).toEqual([
      { jobId: denied, action: "kept", error: "permission denied" },
    ]);
    expect(new JobStore(host.bb.storage.database()).get(denied)?.pruneClaimToken).toBeNull();
    await host.harness.lifecycle.dispose();
  });

  it("skips malformed eligible rows without mutation", async () => {
    const host = await load();
    const created = await run(host);
    const jobId = JSON.parse(created.stdout).jobId as string;
    settle(host, jobId);
    host.bb.storage.database().prepare("UPDATE jobs SET scope_json = '{}' WHERE job_id = ?").run(jobId);
    const result = await host.harness.behavior.runCli([
      "prune", "--older-than-days", "1", "--delete", "--json",
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      results: [],
      skipped: [{ jobId, error: "invalid stored scope" }],
    });
    expect(host.bb.storage.database().prepare("SELECT scope_json FROM jobs WHERE job_id = ?").get(jobId)).toEqual({ scope_json: "{}" });
    await host.harness.lifecycle.dispose();
  });

  it.each(["0", "-1", "1.5", "word", "Infinity", "9007199254740992", "36501"])(
    "rejects prune age %s",
    async (age) => {
      const host = await load();
      const result = await host.harness.behavior.runCli(["prune", "--older-than-days", age]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("from 1 through 36500");
      await host.harness.lifecycle.dispose();
    },
  );

  it.each(["0", "-1", "1.5", "word", "Infinity", "9007199254740992", "201"])(
    "rejects prune limit %s",
    async (limit) => {
      const host = await load();
      const result = await host.harness.behavior.runCli([
        "prune", "--older-than-days", "1", "--limit", limit,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("from 1 through 200");
      await host.harness.lifecycle.dispose();
    },
  );
});
