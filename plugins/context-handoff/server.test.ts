import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin, {
  cleanCheckpointArg,
  cleanDocsDir,
  notesDir,
  parseTokenLimit,
  MAX_START_ATTEMPTS,
  readState,
  RESUME_MARKER,
  SUCCESS_MARKER,
  timing,
} from "./server";

const disposals: (() => Promise<void>)[] = [];
const realTiming = { ...timing };
beforeEach(() => {
  // Short waits; the 60s start hold stays real unless a test changes it.
  Object.assign(timing, { startWaitMs: 100, pollMs: 5, archiveGraceMs: 0, errorGraceMs: 30 });
});
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  Object.assign(timing, realTiming);
});

/** What BB's SDK throws for an HTTP error reply (BbHttpError). */
function httpError(status: number, message: string) {
  return Object.assign(new Error(`HTTP ${status}: ${message}`), { name: "BbHttpError", status });
}

const THREAD_ID = "thr_source";
const NEXT_ID = "thr_next";
const ENV_ID = "env_test";
const CHECKPOINT = "ck_0123456789ab";
/** A notes request in progress, as `prepare` saves it. */
const PREPARING = { stage: "preparing", checkpointId: CHECKPOINT };

type Metadata = Record<string, unknown>;
type Thread = ReturnType<typeof makeThreadResponse>;

interface Options {
  usedTokens?: number | null;
  contextWindow?: number | null;
  thread?: Parameters<typeof makeThreadResponse>[0];
  metadata?: Metadata;
  workspacePath?: string | null;
  settings?: Record<string, string | boolean>;
  sendFails?: boolean;
  /**
   * "refused": no reply, nothing created (uncertain). "rejected": BB answers
   * 400, nothing created. "lost": created, but the reply is lost.
   */
  spawnFails?: false | "refused" | "rejected" | "lost";
  /** Status the new thread reaches after spawn (which answers "pending"). */
  spawnStatus?: Thread["status"];
  /** Queued messages on the new thread, e.g. a provider retry. */
  spawnQueued?: number;
  /** BB removes the new thread right after spawn answers (failed first dispatch). */
  spawnRemoved?: boolean;
  /** State of the new thread's queued messages ("scheduled" = a pending retry). */
  queueState?: string;
  /** Runs after BB created the thread but before spawn answers. */
  duringSpawn?: (id: string) => Promise<void>;
  /** Runs when spawn is called, before BB creates anything. */
  beforeSpawn?: () => Promise<void>;
  /** Runs when threads are listed (the plugin's search for a continuation). */
  beforeList?: () => Promise<void>;
  executionFails?: boolean;
  pendingInteraction?: boolean;
  beforeUsage?: () => Promise<void>;
  beforeExecution?: () => Promise<void>;
  beforeStateRead?: (read: number) => Promise<void>;
}

async function loadHost(options: Options = {}) {
  const metadata = new Map<string, Metadata>([
    [THREAD_ID, { enabled: true, ...(options.metadata ?? {}) }],
  ]);
  const sends: { threadId: string; text: string; mode: string }[] = [];
  const spawns: Record<string, unknown>[] = [];
  /** Threads spawn created, as BB would list them. */
  const created = new Map<string, Thread>();
  /** Soft-deleted thread ids: their own routes answer 404. */
  const deleted = new Set<string>();
  const live = (threadId: string) => {
    if (deleted.has(threadId)) throw httpError(404, "Thread not found");
  };
  let stateReads = 0;
  const usage = {
    window: options.contextWindow === undefined ? 500_000 : options.contextWindow,
    tokens: options.usedTokens === undefined ? 160_000 : options.usedTokens,
  };
  const failures = {
    send: options.sendFails ?? false,
    spawn: options.spawnFails ?? false,
    save: false,
    /** Refuse only the metadata writes this matches. */
    saveWhen: null as null | ((threadId: string, set: Metadata) => boolean),
    /** Thread listing fails (e.g. times out). */
    list: false,
  };
  const thread = makeThreadResponse({
    id: THREAD_ID,
    projectId: "proj_test",
    environmentId: ENV_ID,
    providerId: "claude-code",
    title: "Build the thing",
    parentThreadId: null,
    visibility: "visible",
    archivedAt: null,
    sectionId: "sec_1",
    ...options.thread,
  });
  const workspacePath =
    options.workspacePath === undefined ? null : options.workspacePath;
  /** A thread created by this plugin; BB seeds its metadata in the same write. */
  function addThread(seed: Metadata, status: Thread["status"] = "active", queued = 0, projectId = "proj_test"): string {
    const id = created.size === 0 ? NEXT_ID : `${NEXT_ID}_${created.size + 1}`;
    created.set(id, {
      ...makeThreadResponse({
        id, projectId, originPluginId: "context-handoff",
        parentThreadId: null, visibility: "visible", archivedAt: null,
        createdAt: 1_000 + created.size, status,
      }),
      queuedMessageCount: queued,
    });
    metadata.set(id, { ...seed });
    return id;
  }
  const { bb, harness } = createFakePluginHost({
    pluginId: "context-handoff",
    ...(options.settings ? { settings: options.settings } : {}),
    sdk: {
      threads: {
        interactions: { list: async () => options.pendingInteraction ? [{ id: "question_1", type: "user_question" }] : [] },
        get: async ({ threadId }: { threadId: string }) => {
          live(threadId);
          return created.get(threadId) ?? { ...thread, id: threadId };
        },
        queuedMessages: {
          list: async ({ threadId }: { threadId: string }) =>
            Array.from({ length: created.get(threadId)?.queuedMessageCount ?? 0 }, (_, i) => ({ id: `q_${i}`, state: options.queueState ?? "scheduled" })),
        },
        experimental_listPluginMetadata: async ({ threadIds }: { threadIds: string[] }) => ({
          // Includes archived and deleted threads, as BB documents.
          threads: threadIds.filter(id => metadata.has(id)).map(id => ({ threadId: id, metadata: metadata.get(id)! })),
        }),
        list: async (args: { projectId?: string; originPluginId?: string; archived?: boolean; limit?: number; offset?: number }) => {
          await options.beforeList?.();
          if (failures.list) throw new Error("request timed out");
          const rows = [...created.values()].filter(row => !deleted.has(row.id) &&
            (args.projectId === undefined || row.projectId === args.projectId) &&
            (args.originPluginId === undefined || row.originPluginId === args.originPluginId) &&
            (args.archived === undefined || (row.archivedAt !== null) === args.archived));
          const offset = args.offset ?? 0;
          // BB's list rows carry queuedWork, not queuedMessageCount.
          return rows.slice(offset, offset + (args.limit ?? 50)).map(({ queuedMessageCount: _count, ...row }) => row);
        },
        context: async () => {
          await options.beforeUsage?.();
          return ({
          usage:
            usage.tokens === null
              ? null
              : {
                  estimated: false,
                  modelContextWindow: usage.window,
                  usedTokens: usage.tokens,
                },
          });
        },
        getPluginMetadata: async (args: { threadId: string }) => {
          live(args.threadId);
          await options.beforeStateRead?.(++stateReads);
          return metadata.get(args.threadId) ?? {};
        },
        updatePluginMetadata: async (args: {
          threadId: string;
          set?: Metadata;
          remove?: string[];
        }) => {
          live(args.threadId);
          if (failures.save || failures.saveWhen?.(args.threadId, args.set ?? {})) throw new Error("save refused");
          const next = { ...(metadata.get(args.threadId) ?? {}), ...args.set };
          for (const key of args.remove ?? []) delete next[key];
          metadata.set(args.threadId, next);
          return next;
        },
        send: async (args: {
          threadId: string;
          mode: string;
          input: { type: string; text: string }[];
        }) => {
          if (failures.send) throw new Error("send refused");
          sends.push({ threadId: args.threadId, text: args.input[0]!.text, mode: args.mode });
          return { delivery: "sent" };
        },
        spawn: async (args: { projectId: string; parentThreadId?: string; pluginMetadata?: Metadata }) => {
          await options.beforeSpawn?.();
          if (failures.spawn === "refused") throw new Error("connection reset");
          if (failures.spawn === "rejected") throw httpError(400, "Unknown environment provider");
          spawns.push(args as unknown as Record<string, unknown>);
          const id = addThread(args.pluginMetadata ?? {}, options.spawnStatus ?? "active", options.spawnQueued ?? 0, args.projectId);
          created.get(id)!.parentThreadId = args.parentThreadId ?? null;
          await options.duringSpawn?.(id);
          if (failures.spawn === "lost") throw new Error("connection reset");
          if (options.spawnRemoved) deleted.add(id);
          // BB answers while the new thread is still pending.
          return { ...created.get(id)!, status: "pending" as const };
        },
        defaultExecutionOptions: async () => {
          await options.beforeExecution?.();
          if (options.executionFails) throw new Error("no options");
          return {
            model: "claude-opus-5-5",
            permissionMode: "auto",
            reasoningLevel: "high",
            serviceTier: "default",
            source: "client/turn/start",
          };
        },
      },
      environments: {
        get: async () => ({ id: ENV_ID, path: workspacePath }),
      },
    },
  } as unknown as Parameters<typeof createFakePluginHost>[0]);
  await plugin(bb);
  disposals.push(() => harness.lifecycle.dispose());
  /** Delete a thread as BB does once its storage is gone: row and metadata. */
  function purge(threadId: string) {
    deleted.add(threadId);
    metadata.delete(threadId);
  }
  return { harness, metadata, sends, spawns, created, deleted, addThread, purge, usage, failures, thread };
}

type Host = Awaited<ReturnType<typeof loadHost>>;

/** Reload the plugin: in-memory guards are lost, saved metadata is kept. */
async function reload(host: Host) {
  const replacement = await host.harness.lifecycle.reload(plugin);
  host.harness = replacement.harness;
  disposals.push(() => replacement.harness.lifecycle.dispose());
}

const ready = (host: Host) => host.harness.behavior.runCli(["ready"], { threadId: THREAD_ID });
const resume = (host: Host, id: string, threadId = NEXT_ID) =>
  host.harness.behavior.runCli(["resume", id], { threadId });
const output = (result: { stdout?: string; stderr?: string }) => `${result.stdout ?? ""}${result.stderr ?? ""}`;
const view = (host: Host) => host.harness.behavior.callRpc("state", { threadId: THREAD_ID });

/** Make an earlier start attempt look older than the hold. */
function ageAttempt(host: Host) {
  host.metadata.get(THREAD_ID)!.handoffOpAt = Date.now() - timing.startHoldMs - 1_000;
}

/** A thread from start attempt `op` that BB finished creating only now. */
function lateThread(host: Host, op: string) {
  return host.addThread({ enabled: true, stage: "watching", chainId: THREAD_ID, part: 2, previousThreadId: THREAD_ID, createdByOp: op });
}

async function remove(host: Host, threadId: string) {
  host.deleted.add(threadId);
  await host.harness.behavior.emitThreadEvent("thread.deleted", { thread: host.created.get(threadId) ?? makeThreadResponse({ id: threadId }) });
  await settle();
}

async function archive(host: Host, threadId: string, emit = true) {
  const row = { ...host.created.get(threadId)!, archivedAt: Date.now() };
  host.created.set(threadId, row);
  if (emit) {
    await host.harness.behavior.emitThreadEvent("thread.archived", { thread: row });
    await settle();
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function idle(host: Host, overrides = {}) {
  await host.harness.behavior.emitThreadEvent("thread.idle", {
    thread: makeThreadResponse({
      id: THREAD_ID,
      parentThreadId: null,
      visibility: "visible",
      archivedAt: null,
      ...overrides,
    }),
    lastAssistantText: "done",
  });
  await settle();
}

function notesWorkspace(files: string[], chainId = THREAD_ID): string {
  const workspace = mkdtempSync(join(tmpdir(), "handoff-"));
  const dir = join(workspace, ".handoff", chainId);
  mkdirSync(dir, { recursive: true });
  for (const file of files) writeFileSync(join(dir, file), "# notes");
  return workspace;
}

describe("context-handoff.parseTokenLimit", () => {
  it("reads plain numbers, k and m suffixes", () => {
    expect(parseTokenLimit("150000")).toBe(150_000);
    expect(parseTokenLimit("150K")).toBe(150_000);
    expect(parseTokenLimit(" 1.5m ")).toBe(1_500_000);
    expect(parseTokenLimit("1.5k")).toBe(1_500);
  });

  it("rejects empty, zero, tiny, negative and malformed values", () => {
    for (const raw of ["", "0", "0.0001", "-5k", "lots", "1e5", "200,000"]) {
      expect(parseTokenLimit(raw)).toBeNull();
    }
  });
});

describe("context-handoff.cleanDocsDir", () => {
  it("keeps a relative folder and strips trailing slashes", () => {
    expect(cleanDocsDir("notes/")).toBe("notes");
    expect(cleanDocsDir("notes\\")).toBe("notes");
    expect(cleanDocsDir("docs/handoff")).toBe("docs/handoff");
  });

  it("falls back to .handoff for empty, absolute or escaping paths", () => {
    for (const raw of ["", "  ", "/etc", "C:\\x", "../escape", "a/../../b"]) {
      expect(cleanDocsDir(raw)).toBe(".handoff");
    }
  });
});

describe("context-handoff.readState", () => {
  it("defaults new threads to off for independent comparisons", () => {
    expect(readState(THREAD_ID, {})).toEqual({
      enabled: false,
      stage: "watching",
      preparingAtTokens: null,
      preparingAt: null,
      chainId: THREAD_ID,
      part: 1,
      previousThreadId: null,
      nextThreadId: null,
      checkpointId: null,
      handoffOp: null,
      handoffOpAt: null,
      nextConfirmed: false,
      createdByOp: null,
      parentCheckpointId: null,
      confirmed: true,
      abandoned: false,
      handoffAttempts: 0,
      legacyRequest: false,
      requested: false,
    });
  });

  it("only counts a switch-on request while the switch is on", () => {
    expect(readState(THREAD_ID, { enabled: true, requested: true }).requested).toBe(true);
    expect(readState(THREAD_ID, { enabled: false, requested: true }).requested).toBe(false);
    expect(readState(THREAD_ID, { enabled: true, requested: "yes" }).requested).toBe(false);
  });

  it("sends a notes request from before checkpoint ids again", () => {
    expect(readState(THREAD_ID, { stage: "preparing" }).stage).toBe("watching");
    expect(readState(THREAD_ID, PREPARING).stage).toBe("preparing");
  });

  it("treats links and continuations from before confirmation as confirmed", () => {
    expect(readState(THREAD_ID, { nextThreadId: NEXT_ID }).nextConfirmed).toBe(true);
    expect(readState(THREAD_ID, { nextThreadId: NEXT_ID, handoffOp: "op_1" }).nextConfirmed).toBe(false);
    expect(readState(THREAD_ID, { nextThreadId: NEXT_ID, handoffOp: "op_1", nextConfirmed: true }).nextConfirmed).toBe(true);
    expect(readState(NEXT_ID, { part: 2, previousThreadId: THREAD_ID }).confirmed).toBe(true);
    expect(readState(NEXT_ID, { part: 2, previousThreadId: THREAD_ID, createdByOp: "op_1" }).confirmed).toBe(false);
    expect(readState(NEXT_ID, { part: 2, previousThreadId: THREAD_ID, createdByOp: "op_1", confirmed: true }).confirmed).toBe(true);
    expect(readState(NEXT_ID, { part: 2, confirmed: true, abandoned: true }).confirmed).toBe(false);
  });

  it("reads a checkpoint id from the id alone, a pasted line or quotes", () => {
    for (const raw of [CHECKPOINT, `Checkpoint: ${CHECKPOINT}`, `\`${CHECKPOINT}\``, ` ${CHECKPOINT.toUpperCase()} `]) {
      expect(cleanCheckpointArg(raw)).toBe(CHECKPOINT);
    }
    expect(cleanCheckpointArg(undefined)).toBe("");
  });

  it("ignores untrusted values it cannot use", () => {
    const state = readState(THREAD_ID, {
      mode: "chaos",
      stage: "exploded",
      chainId: "../../etc",
      part: 1.5,
      snoozeUntilTokens: "lots",
      nextThreadId: "x".repeat(65),
    });
    expect(state.enabled).toBe(false);
    expect(state.stage).toBe("watching");
    expect(state.chainId).toBe(THREAD_ID);
    expect(state.part).toBe(1);
    expect(state.nextThreadId).toBeNull();
  });

  it("treats a recorded next thread as handed off, and only then", () => {
    expect(
      readState(THREAD_ID, { stage: "watching", nextThreadId: NEXT_ID }).stage,
    ).toBe("handed-off");
    expect(readState(THREAD_ID, { stage: "handed-off" }).stage).toBe(
      "watching",
    );
  });
});

describe("context-handoff.notesDir", () => {
  it("is relative without a workspace path and absolute with one", () => {
    expect(notesDir(".handoff", "thr_a", null)).toBe(".handoff/thr_a");
    expect(notesDir(".handoff", "thr_a", "/work/repo")).toBe(
      "/work/repo/.handoff/thr_a",
    );
  });
});

describe("context-handoff.automatic", () => {
  it("starts preparing at 150k and does nothing below it", async () => {
    const host = await loadHost({ usedTokens: 149_999 });
    await idle(host);
    expect(host.sends).toEqual([]);
    host.usage.tokens = 150_000;
    await idle(host);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]!.text).toContain("HANDOFF.md");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "preparing" });
  });

  it("asks a running agent to finish a safe unit without stopping its tools", async () => {
    const host = await loadHost({ thread: { status: "active" } });
    await host.harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread: host.thread, sequence: 1,
    });
    await settle();
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]!.mode).toBe("queue-if-active");
    expect(host.spawns).toEqual([]);
  });

  it("keeps two threads independent, including after reloading the plugin", async () => {
    const host = await loadHost();
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    await host.harness.behavior.callRpc("set_enabled", { threadId: "thr_comparison", enabled: true });
    const replacement = await host.harness.lifecycle.reload(plugin);
    host.harness = replacement.harness;
    disposals.push(() => replacement.harness.lifecycle.dispose());
    await idle(host);
    await idle(host, { id: "thr_comparison" });
    expect(host.sends.map(s => s.threadId)).toEqual(["thr_comparison"]);
    expect(host.metadata.get(THREAD_ID)!.enabled).toBe(false);
  });

  it("shows the meter but sends nothing for a new thread without a preference", async () => {
    const host = await loadHost();
    host.metadata.set(THREAD_ID, {});
    await idle(host);
    const state = await host.harness.behavior.callRpc("state", { threadId: THREAD_ID });
    expect(state).toMatchObject({ autoHandoff: false, usedTokens: 160_000, limit: 150_000 });
    expect(host.sends).toEqual([]);
  });

  it.each([
    { metadata: { enabled: false } },
    { settings: { enabled: false } },
    { usedTokens: null },
    { thread: { parentThreadId: "thr_parent" } },
    { thread: { visibility: "hidden" as const } },
    { thread: { archivedAt: 1 } },
    { pendingInteraction: true },
    { thread: { status: "error" as const } },
  ])("leaves disabled or unsafe threads alone: %j", async (options) => {
    const host = await loadHost(options);
    await idle(host, options.thread ?? {});
    expect(host.sends).toEqual([]);
    expect(host.spawns).toEqual([]);
  });

  it("reminds once after 20k more tokens, without repeatedly interrupting", async () => {
    const host = await loadHost();
    await idle(host);
    await idle(host);
    expect(host.sends).toHaveLength(1);
    host.usage.tokens = 180_000;
    await idle(host);
    expect(host.sends).toHaveLength(2);
    expect(host.sends[1]!.text).toContain("Reminder");
  });

  it("recovers when sending the preparation request fails", async () => {
    const host = await loadHost({ sendFails: true });
    await idle(host);
    expect(host.metadata.get(THREAD_ID)!.stage).toBe("watching");
    host.failures.send = false;
    await idle(host);
    expect(host.sends).toHaveLength(1);
  });

  it("uses a changed threshold", async () => {
    const host = await loadHost({ usedTokens: 90_000 });
    host.usage.window = 300_000;
    await idle(host);
    expect(host.sends).toHaveLength(1);
  });
});

describe("context-handoff.toggle", () => {
  it("honors global Off during the last state read before dispatch", async () => {
    let release!: () => void;
    let reading = false;
    const held = new Promise<void>(resolve => { release = resolve; });
    const host = await loadHost({ beforeStateRead: async read => {
      if (read === 3) { reading = true; await held; }
    } });
    const check = idle(host);
    await waitFor(() => reading);
    await host.harness.behavior.setSettings({ enabled: false });
    release();
    await check;
    expect(host.sends).toEqual([]);
    expect(host.metadata.get(THREAD_ID)!.stage).not.toBe("preparing");
  });

  it("lets Off cancel a check that is still reading context", async () => {
    let release!: () => void;
    let reading = false;
    const held = new Promise<void>(resolve => { release = resolve; });
    const host = await loadHost({ beforeUsage: async () => {
      if (!reading) { reading = true; await held; }
    } });
    const check = idle(host);
    await waitFor(() => reading);
    const reply = await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    release();
    await check;
    expect(reply).toMatchObject({ ok: true, view: { autoHandoff: false } });
    expect(host.metadata.get(THREAD_ID)!.enabled).toBe(false);
    expect(host.metadata.get(THREAD_ID)!.stage).not.toBe("preparing");
    expect(host.sends).toEqual([]);
  });

  it.each(["thread", "global"])("honors %s Off while preparing to spawn", async which => {
    let release!: () => void;
    let reading = false;
    const held = new Promise<void>(resolve => { release = resolve; });
    const host = await loadHost({ metadata: PREPARING, beforeExecution: async () => {
      reading = true;
      await held;
    } });
    const ready = host.harness.behavior.runCli(["ready", THREAD_ID]);
    await waitFor(() => reading);
    if (which === "thread") await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    else await host.harness.behavior.setSettings({ enabled: false });
    release();
    expect((await ready).exitCode).toBe(1);
    expect(host.spawns).toEqual([]);
  });

  it("turning off cancels preparation and blocks a late ready command", async () => {
    const host = await loadHost({ metadata: PREPARING });
    const reply = await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    expect(reply).toMatchObject({ ok: true, view: { autoHandoff: false, stage: "watching" } });
    const ready = await host.harness.behavior.runCli(["ready", THREAD_ID]);
    expect(ready.exitCode).toBe(1);
    expect(host.spawns).toEqual([]);
    await idle(host);
    expect(host.sends).toEqual([]);
  });

  it("a repeated On for a thread that is already on sends nothing", async () => {
    const host = await loadHost({ usedTokens: 110_000 });
    const reply = await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
    expect(reply).toMatchObject({ ok: true, view: { autoHandoff: true, requested: false } });
    expect(host.metadata.get(THREAD_ID)!.enabled).toBe(true);
    await settle();
    expect(host.sends).toEqual([]);
    await waitFor(() => host.harness.inspection.realtimeSignals.length > 0);
  });

  it("reports a failed save instead of claiming the switch changed", async () => {
    const host = await loadHost();
    host.failures.save = true;
    await expect(host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false })).rejects.toThrow();
    expect(host.metadata.get(THREAD_ID)!.enabled).toBe(true);
  });

  it("rejects a nonboolean preference", async () => {
    const host = await loadHost();
    await expect(host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: "false" })).rejects.toThrow();
  });

  it("preserves explicit legacy choices while new switches take precedence", () => {
    expect(readState(THREAD_ID, { mode: "off" }).enabled).toBe(false);
    expect(readState(THREAD_ID, { mode: "build" }).enabled).toBe(true);
    expect(readState(THREAD_ID, { mode: "planning" }).enabled).toBe(true);
    expect(readState(THREAD_ID, { mode: "planning", enabled: false }).enabled).toBe(false);
  });
});

describe("context-handoff.ready", () => {
  it("continues with the same workspace, provider, settings and enabled switch", async () => {
    const host = await loadHost({ metadata: PREPARING });
    const result = await host.harness.behavior.runCli(["ready"], { threadId: THREAD_ID });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(SUCCESS_MARKER);
    expect(host.spawns).toHaveLength(1);
    expect(host.spawns[0]).toMatchObject({
      environment: { type: "reuse", environmentId: ENV_ID },
      providerId: "claude-code", model: "claude-opus-5-5", permissionMode: "auto",
      reasoningLevel: "high", serviceTier: "default", sectionId: "sec_1",
      title: "Build the thing (part 2)",
      pluginMetadata: { enabled: true, chainId: THREAD_ID, part: 2, previousThreadId: THREAD_ID },
    });
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID });
  });

  it("keeps the chain across successive handoffs", async () => {
    const host = await loadHost({
      thread: { title: "Build the thing (part 2)" },
      metadata: { ...PREPARING, chainId: "thr_first", part: 2 },
    });
    await host.harness.behavior.runCli(["ready", THREAD_ID]);
    expect(host.spawns[0]).toMatchObject({ title: "Build the thing (part 3)", pluginMetadata: { chainId: "thr_first", part: 3 } });
  });

  it("refuses missing or stale notes, then accepts freshly written notes", async () => {
    const workspace = notesWorkspace([]);
    const host = await loadHost({ workspacePath: workspace, metadata: { ...PREPARING, preparingAt: Date.now() } });
    expect((await host.harness.behavior.runCli(["ready", THREAD_ID])).exitCode).toBe(1);
    for (const file of ["PLAN.md", "HANDOFF.md"]) writeFileSync(join(workspace, ".handoff", THREAD_ID, file), `Checkpoint: ${CHECKPOINT}
# Current work`);
    host.metadata.get(THREAD_ID)!.preparingAt = Date.now() + 60_000;
    expect((await host.harness.behavior.runCli(["ready", THREAD_ID])).exitCode).toBe(1);
    expect(host.spawns).toEqual([]);
    host.metadata.get(THREAD_ID)!.preparingAt = Date.now() - 1_000;
    expect((await host.harness.behavior.runCli(["ready", THREAD_ID])).exitCode).toBe(0);
    expect(host.spawns).toHaveLength(1);
  });

  it("requires a threshold-triggered request and respects both off switches", async () => {
    for (const options of [{}, { metadata: { ...PREPARING, enabled: false } }, { metadata: PREPARING, settings: { enabled: false } }]) {
      const host = await loadHost(options);
      expect((await host.harness.behavior.runCli(["ready", THREAD_ID])).exitCode).toBe(1);
      expect(host.spawns).toEqual([]);
    }
  });

  it("starts only one continuation when ready calls overlap or repeat", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await Promise.all([host.harness.behavior.runCli(["ready", THREAD_ID]), host.harness.behavior.runCli(["ready", THREAD_ID])]);
    await host.harness.behavior.runCli(["ready", THREAD_ID]);
    await idle(host);
    expect(host.spawns).toHaveLength(1);
    expect(host.sends).toEqual([]);
  });

  it("does not duplicate a continuation when recording it fails", async () => {
    const host = await loadHost({ metadata: PREPARING });
    host.failures.saveWhen = (_id, set) => "nextThreadId" in set;
    expect((await host.harness.behavior.runCli(["ready", THREAD_ID])).stdout).toContain(SUCCESS_MARKER);
    await host.harness.behavior.runCli(["ready", THREAD_ID]);
    await idle(host);
    expect(host.spawns).toHaveLength(1);
  });

  it("retries a refused start only after the hold, once a search finds no thread", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    const first = await ready(host);
    expect(first.exitCode).toBe(1);
    expect(output(first)).toContain("not yet certain whether the thread was created");
    host.failures.spawn = false;
    const held = await ready(host);
    expect(held.exitCode).toBe(1);
    expect(output(held)).toContain("may still be finishing");
    expect(host.spawns).toEqual([]);
    ageAttempt(host);
    expect((await ready(host)).exitCode).toBe(0);
    expect(host.spawns).toHaveLength(1);
  });

  it("refuses to start work for archived threads or unresolved questions", async () => {
    for (const options of [{ thread: { archivedAt: 1 } }, { pendingInteraction: true }]) {
      const host = await loadHost({ ...options, metadata: PREPARING });
      expect((await host.harness.behavior.runCli(["ready", THREAD_ID])).exitCode).toBe(1);
      expect(host.spawns).toEqual([]);
    }
  });

  it("restricts agents to their own thread", async () => {
    const host = await loadHost({ metadata: PREPARING });
    expect((await host.harness.behavior.runCli(["ready", "thr_other"], { threadId: THREAD_ID })).exitCode).toBe(1);
    expect(host.spawns).toEqual([]);
  });
});

describe("context-handoff.instructions", () => {
  it("adds no instructions to the comparison thread when off", async () => {
    const host = await loadHost();
    const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata: { enabled: false, part: 2 } }));
    expect(config.instructions).toBeNull();
  });

  it("points an enabled continuation to its saved goal and next step", async () => {
    const host = await loadHost();
    const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata: { enabled: true, chainId: "thr_first", part: 2 } }));
    expect(config.instructions).toContain("thr_first/PLAN.md");
    expect(config.instructions).toContain("thr_first/HANDOFF.md");
    expect(config.instructions).not.toContain("resume");
  });

  it("asks a new continuation to confirm its checkpoint until it has", async () => {
    const host = await loadHost();
    const context = (extra: Metadata) => makePluginAgentConfigurationContext({ pluginMetadata: { enabled: true, chainId: "thr_first", part: 2, createdByOp: "op_1", ...extra } });
    expect((await host.harness.behavior.resolveAgentConfiguration(context({}))).instructions).toContain("bb context-handoff resume");
    expect((await host.harness.behavior.resolveAgentConfiguration(context({ confirmed: true }))).instructions).not.toContain("resume");
  });
});

describe("context-handoff.checkpoint", () => {
  it("asks for a Checkpoint line and keeps its id in the reminder", async () => {
    const host = await loadHost();
    await idle(host);
    const id = host.metadata.get(THREAD_ID)!.checkpointId as string;
    expect(id).toMatch(/^ck_[0-9a-f]{12}$/);
    expect(host.sends[0]!.text).toContain(`Checkpoint: ${id}`);
    host.usage.tokens = 180_000;
    await idle(host);
    expect(host.sends[1]!.text).toContain(`Checkpoint: ${id}`);
  });

  it("refuses notes without this request's checkpoint id", async () => {
    const workspace = notesWorkspace(["PLAN.md", "HANDOFF.md"]);
    const host = await loadHost({ workspacePath: workspace, metadata: { ...PREPARING, preparingAt: Date.now() - 60_000 } });
    const refused = await ready(host);
    expect(refused.exitCode).toBe(1);
    expect(output(refused)).toContain(`Checkpoint: ${CHECKPOINT}`);
    writeFileSync(join(workspace, ".handoff", THREAD_ID, "HANDOFF.md"), `Checkpoint: ${CHECKPOINT}\n\nNext: ship it`);
    expect((await ready(host)).exitCode).toBe(0);
    expect(host.spawns).toHaveLength(1);
  });

  it("gives the new thread a checkpoint step but not the id itself", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    const prompt = host.spawns[0]!.prompt as string;
    expect(prompt).toContain("bb context-handoff resume");
    expect(prompt).not.toContain(CHECKPOINT);
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ previousThreadId: THREAD_ID, createdByOp: host.metadata.get(THREAD_ID)!.handoffOp });
  });
});

describe("context-handoff.no-duplicates", () => {
  it("reuses the thread when the spawn reply is lost", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "lost" });
    const result = await ready(host);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${SUCCESS_MARKER} Part 2 started in @thread:${NEXT_ID}`);
    host.failures.spawn = false;
    expect((await ready(host)).stdout).toContain(`Already handed off to @thread:${NEXT_ID}`);
    expect(host.created.size).toBe(1);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID });
  });

  it("finds an unrecorded continuation after a reload instead of starting another", async () => {
    const host = await loadHost({ metadata: PREPARING });
    host.failures.saveWhen = (id, set) => id === THREAD_ID && "nextThreadId" in set;
    expect((await ready(host)).stdout).toContain(SUCCESS_MARKER);
    expect(host.metadata.get(THREAD_ID)!.nextThreadId).toBeUndefined();
    await reload(host);
    host.failures.saveWhen = null;
    const again = await ready(host);
    expect(again.stdout).toContain(`Part 2 started in @thread:${NEXT_ID}`);
    expect(host.created.size).toBe(1);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID });
  });

  it("an idle check links an unrecorded continuation instead of asking for notes again", async () => {
    const host = await loadHost({ metadata: PREPARING });
    host.failures.saveWhen = (id, set) => id === THREAD_ID && "nextThreadId" in set;
    await ready(host);
    await reload(host);
    host.failures.saveWhen = null;
    host.usage.tokens = 200_000;
    await idle(host);
    expect(host.sends).toEqual([]);
    expect(host.created.size).toBe(1);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID });
  });

  it("waits rather than starting a second thread while an earlier attempt may be finishing", async () => {
    const host = await loadHost({ metadata: { ...PREPARING, handoffOp: "op_other_process", handoffOpAt: Date.now() } });
    const held = await ready(host);
    expect(held.exitCode).toBe(1);
    expect(output(held)).toContain("may still be finishing");
    expect(host.spawns).toEqual([]);
    expect(await view(host)).toMatchObject({ creating: true });
    await idle(host);
    expect(host.sends).toEqual([]);
    ageAttempt(host);
    expect((await ready(host)).exitCode).toBe(0);
    expect(host.spawns).toHaveLength(1);
  });

  it("creates nothing when the start attempt cannot be saved first", async () => {
    const host = await loadHost({ metadata: PREPARING });
    host.failures.saveWhen = (_id, set) => "handoffOp" in set;
    expect((await ready(host)).exitCode).not.toBe(0);
    expect(host.spawns).toEqual([]);
  });
});

describe("context-handoff.usable-continuation", () => {
  it("does not report success when the new thread fails to start", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnStatus: "error" });
    const result = await ready(host);
    expect(result.exitCode).toBe(1);
    expect(output(result)).not.toContain(SUCCESS_MARKER);
    expect(output(result)).toContain("failed to start");
    expect(await view(host)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID, next: "failed" });
    const again = await ready(host);
    expect(again.exitCode).toBe(1);
    expect(output(again)).toContain("failed to start");
    expect(host.created.size).toBe(1);
  });

  it("shows the next part as starting until it confirms the checkpoint from its notes", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    expect(await view(host)).toMatchObject({ next: "starting" });
    const wrong = await resume(host, "ck_ffffffffffff");
    expect(wrong.exitCode).toBe(1);
    expect(output(wrong)).toContain("Not resumed");
    expect(await view(host)).toMatchObject({ next: "starting" });
    const right = await resume(host, `Checkpoint: ${CHECKPOINT}`);
    expect(right.exitCode).toBe(0);
    expect(right.stdout).toContain(RESUME_MARKER);
    expect(await view(host)).toMatchObject({ next: "confirmed" });
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ confirmed: true });
    expect((await resume(host, CHECKPOINT)).stdout).toContain("Already confirmed");
  });

  it("a recovered thread is confirmed even if the earlier thread never recorded it", async () => {
    const host = await loadHost({ metadata: PREPARING });
    host.failures.saveWhen = (id, set) => id === THREAD_ID && "nextThreadId" in set && !("nextConfirmed" in set);
    await ready(host);
    await reload(host);
    expect((await resume(host, CHECKPOINT)).stdout).toContain(RESUME_MARKER);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID, nextConfirmed: true });
  });

  it("refuses confirmation from a thread that is not the recorded continuation", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    host.metadata.set("thr_stray", { enabled: true, part: 2, chainId: THREAD_ID, previousThreadId: THREAD_ID, createdByOp: "op_old" });
    const stray = await resume(host, CHECKPOINT, "thr_stray");
    expect(stray.exitCode).toBe(1);
    expect(output(stray)).toContain(`continued in @thread:${NEXT_ID}`);
    const unrelated = await resume(host, CHECKPOINT, THREAD_ID);
    expect(output(unrelated)).toContain("nothing to confirm");
  });

  it("archiving a part before it confirms cancels the handoff and turns the switch off", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnStatus: "error" });
    await ready(host);
    await archive(host, NEXT_ID);
    expect(await view(host)).toMatchObject({ stage: "watching", nextThreadId: null, next: null, autoHandoff: false });
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ abandoned: true, enabled: false });
    expect(output(await resume(host, CHECKPOINT))).toContain("cancelled");
    // Turned back on later, the next handoff starts a fresh thread.
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
    await idle(host);
    host.metadata.get(THREAD_ID)!.checkpointId = CHECKPOINT;
    expect((await ready(host)).exitCode).toBe(1);
    expect(host.created.size).toBe(2);
  });

  it("catches a missed archive event when the state is read", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    await archive(host, NEXT_ID, false);
    expect(await view(host)).toMatchObject({ stage: "watching", nextThreadId: null, autoHandoff: false });
  });

  it("keeps a confirmed continuation when it is archived later", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    await resume(host, CHECKPOINT);
    await archive(host, NEXT_ID);
    expect(await view(host)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID, next: "confirmed" });
  });
});

describe("context-handoff.review-fixes", () => {
  it("cancels the handoff when an unconfirmed part is deleted, whose routes then answer 404", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    await remove(host, NEXT_ID);
    expect(await view(host)).toMatchObject({ stage: "watching", nextThreadId: null, autoHandoff: false });
    const again = await ready(host);
    expect(output(again)).not.toContain(SUCCESS_MARKER);
  });

  it("notices a deleted part even without the delete event", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    host.deleted.add(NEXT_ID);
    expect(await view(host)).toMatchObject({ stage: "watching", nextThreadId: null, autoHandoff: false });
  });

  it("never tells the agent to carry on while an unresolved attempt could still take over", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    const op = host.metadata.get(THREAD_ID)!.handoffOp as string;
    await host.harness.behavior.setSettings({ enabled: false });
    const held = await ready(host);
    expect(output(held)).toContain("may still be finishing");
    expect(output(held)).toContain("Do not continue the work in this thread meanwhile");
    ageAttempt(host);
    const off = await ready(host);
    expect(output(off)).toContain("Continue in this thread");
    expect(host.metadata.get(THREAD_ID)!.handoffOp).toBeNull();
    // BB finishes creating the first attempt's thread only now: it cannot take over.
    const late = lateThread(host, op);
    const claim = await resume(host, CHECKPOINT, late);
    expect(claim.exitCode).toBe(1);
    expect(host.metadata.get(late)).toMatchObject({ abandoned: true, enabled: false });
    expect(host.metadata.get(THREAD_ID)!.nextThreadId).toBeUndefined();
  });

  it("switching off settles a pending attempt, and switching on never links its thread silently", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    const op = host.metadata.get(THREAD_ID)!.handoffOp as string;
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ handoffOp: null, stage: "watching" });
    const late = lateThread(host, op);
    expect((await resume(host, CHECKPOINT, late)).exitCode).toBe(1);
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
    await idle(host);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "preparing" });
    expect(host.metadata.get(THREAD_ID)!.nextThreadId).toBeUndefined();
    expect(host.sends).toHaveLength(1);
  });

  it("a new notes request retires the previous request's attempt", async () => {
    const host = await loadHost({ metadata: { ...PREPARING, stage: "watching", handoffOp: "op_old", handoffOpAt: Date.now() } });
    const stale = lateThread(host, "op_old");
    await idle(host);
    expect(host.sends).toHaveLength(1);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "preparing", handoffOp: null });
    expect(host.metadata.get(stale)).toMatchObject({ abandoned: true });
  });

  it("only reuses a thread from the current attempt, never older or other-version threads", async () => {
    const host = await loadHost({ metadata: { ...PREPARING, handoffOp: "op_now", handoffOpAt: Date.now() - 120_000 } });
    // A v0.2.0/v0.5.0 thread pointing back here, and one from an earlier attempt.
    host.addThread({ enabled: true, part: 2, chainId: THREAD_ID, previousThreadId: THREAD_ID, workflowId: "wf_1", threadRole: "reviewer" });
    host.addThread({ enabled: true, part: 2, chainId: THREAD_ID, previousThreadId: THREAD_ID, createdByOp: "op_before" });
    host.failures.spawn = "refused";
    const result = await ready(host);
    expect(output(result)).not.toContain(SUCCESS_MARKER);
    expect(host.metadata.get(THREAD_ID)!.nextThreadId).toBeUndefined();
  });

  it("waits for the new thread to start, and treats a queued retry as still starting", async () => {
    const pending = await loadHost({ metadata: PREPARING, spawnStatus: "pending" });
    expect((await ready(pending)).stdout).toContain(SUCCESS_MARKER);
    const retrying = await loadHost({ metadata: PREPARING, spawnStatus: "error", spawnQueued: 1 });
    expect((await ready(retrying)).stdout).toContain(SUCCESS_MARKER);
    expect(await view(retrying)).toMatchObject({ next: "starting" });
  });

  it("reports a part that went idle without confirming as stalled", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnStatus: "idle" });
    const result = await ready(host);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("stopped before confirming");
    expect(await view(host)).toMatchObject({ next: "stalled" });
  });

  it("reports a part BB removed during its start, and frees this thread", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnRemoved: true });
    const result = await ready(host);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("could not start and was removed");
    expect(await view(host)).toMatchObject({ stage: "watching", autoHandoff: false });
  });

  it("an archive undone within BB's grace period keeps the handoff", async () => {
    timing.archiveGraceMs = 80;
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    await archive(host, NEXT_ID);
    host.created.set(NEXT_ID, { ...host.created.get(NEXT_ID)!, archivedAt: null });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await view(host)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID, next: "starting" });
    expect(host.metadata.get(NEXT_ID)!.abandoned).toBeUndefined();
  });

  it("confirms a part whose earlier thread was deleted meanwhile", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    host.deleted.add(THREAD_ID);
    const result = await resume(host, CHECKPOINT);
    expect(result.stdout).toContain(RESUME_MARKER);
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ confirmed: true });
  });

  it("does not wait after BB definitely refused to start the thread", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "rejected" });
    const refused = await ready(host);
    expect(output(refused)).toContain("BB refused to start part 2");
    expect(host.metadata.get(THREAD_ID)!.handoffOp).toBeNull();
    host.failures.spawn = false;
    expect((await ready(host)).stdout).toContain(SUCCESS_MARKER);
  });

  it("stops retrying after repeated uncertain starts and asks to tell the user", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt++) {
      await ready(host);
      ageAttempt(host);
    }
    const capped = await ready(host);
    expect(output(capped)).toContain(`failed ${MAX_START_ATTEMPTS} times`);
    expect(host.metadata.get(THREAD_ID)!.handoffOp).toBeNull();
  });

  it("reminds an agent told to wait to run ready again", async () => {
    timing.startHoldMs = 20;
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    await waitFor(() => host.sends.length > 0, 3_000);
    expect(host.sends[0]!.text).toContain("Run `bb context-handoff ready` again");
  });

  it("refuses to resume a part that has handed off itself", async () => {
    const host = await loadHost();
    host.metadata.set(NEXT_ID, { enabled: true, part: 2, chainId: THREAD_ID, previousThreadId: THREAD_ID, createdByOp: "op_1", confirmed: true, nextThreadId: "thr_part3" });
    const result = await resume(host, CHECKPOINT);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("already handed off to @thread:thr_part3");
  });

  it("answers an out-of-date request without contradicting it", async () => {
    const host = await loadHost({ metadata: { stage: "preparing" } });
    const result = await ready(host);
    expect(output(result)).toContain("older version");
    expect(output(result)).not.toContain("no handoff was requested");
  });

  it("does not ask a cancelled continuation to confirm, even if switched back on", async () => {
    const host = await loadHost();
    const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata: { enabled: true, part: 2, chainId: THREAD_ID, createdByOp: "op_1", abandoned: true } }));
    // No continuation instructions at all: it is an ordinary thread now.
    expect(config.instructions ?? "").not.toContain("resume");
    expect(config.instructions ?? "").not.toContain("continues earlier work");
  });
});

describe("context-handoff.review-round-2", () => {
  it("a switch turned off while BB creates the part cancels it instead of handing off", async () => {
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, duringSpawn: async () => {
      await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    } });
    const result = await ready(host);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("switched off while the next part was starting");
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ abandoned: true, enabled: false });
    expect(await view(host)).toMatchObject({ stage: "watching", nextThreadId: null, next: null, autoHandoff: false });
  });

  it("a link saved after an attempt was cleared is not mistaken for an old confirmed one", () => {
    expect(readState(THREAD_ID, { nextThreadId: NEXT_ID, handoffOp: null, nextConfirmed: false }).nextConfirmed).toBe(false);
  });

  it("after a definite refusal the agent waits for the user, and the attempt cap lets a fresh round run", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "rejected" });
    const refused = await ready(host);
    expect(output(refused)).toContain("Tell the user in one line and wait");
    for (let attempt = 1; attempt < MAX_START_ATTEMPTS; attempt++) await ready(host);
    expect(output(await ready(host))).toContain(`failed ${MAX_START_ATTEMPTS} times`);
    host.failures.spawn = false;
    expect((await ready(host)).stdout).toContain(SUCCESS_MARKER);
  });

  it("an archived part cannot confirm during BB's undo window, and can after an undo", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    host.created.set(NEXT_ID, { ...host.created.get(NEXT_ID)!, archivedAt: Date.now() });
    const archived = await resume(host, CHECKPOINT);
    expect(archived.exitCode).toBe(1);
    expect(output(archived)).toContain("archived");
    expect(host.metadata.get(NEXT_ID)!.abandoned).toBeUndefined();
    host.created.set(NEXT_ID, { ...host.created.get(NEXT_ID)!, archivedAt: null });
    expect((await resume(host, CHECKPOINT)).stdout).toContain(RESUME_MARKER);
  });

  it("confirms against its own record when the earlier thread and its metadata are purged", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ parentCheckpointId: CHECKPOINT });
    host.purge(THREAD_ID);
    expect((await resume(host, "ck_ffffffffffff")).exitCode).toBe(1);
    const result = await resume(host, CHECKPOINT);
    expect(result.stdout).toContain(RESUME_MARKER);
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ confirmed: true });
    expect(host.metadata.get(NEXT_ID)!.abandoned).toBeUndefined();
  });

  it("a part found after a lost reply is judged from the thread, so a queued retry still counts", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "lost", spawnStatus: "error", spawnQueued: 1 });
    expect((await ready(host)).stdout).toContain(SUCCESS_MARKER);
    expect(await view(host)).toMatchObject({ next: "starting" });
  });

  it("a part whose retries are spent counts as failed", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnStatus: "error", spawnQueued: 1, queueState: "failed_exhausted" });
    expect(output(await ready(host))).toContain("failed to start");
    expect(await view(host)).toMatchObject({ next: "failed" });
  });

  it("waits briefly after a failed first turn for BB to queue its retry", async () => {
    timing.errorGraceMs = 400;
    timing.startWaitMs = 400;
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, spawnStatus: "error", duringSpawn: async id => {
      setTimeout(() => host.created.set(id, { ...host.created.get(id)!, queuedMessageCount: 1 }), 60);
    } });
    expect((await ready(host)).stdout).toContain(SUCCESS_MARKER);
  });

  it("an archive that is undone and repeated restarts the undo window", async () => {
    timing.archiveGraceMs = 300;
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    await archive(host, NEXT_ID); // t0: its check fires at about 300ms
    host.created.set(NEXT_ID, { ...host.created.get(NEXT_ID)!, archivedAt: null });
    await new Promise(resolve => setTimeout(resolve, 100));
    await archive(host, NEXT_ID); // about 150ms: the window now ends near 450ms
    await new Promise(resolve => setTimeout(resolve, 200));
    // Past the first archive's window, inside the second one.
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "handed-off", nextThreadId: NEXT_ID });
    await waitFor(() => host.metadata.get(THREAD_ID)!.nextThreadId === null, 1_000);
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ abandoned: true });
  });

  it("shows an unsettled start once the hold has passed", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    expect(await view(host)).toMatchObject({ creating: true, stuck: false });
    ageAttempt(host);
    expect(await view(host)).toMatchObject({ creating: false, stuck: true });
  });

  it("holds after an uncertain spawn from when it failed, not from when it began", async () => {
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    const before = Date.now();
    await ready(host);
    expect(host.metadata.get(THREAD_ID)!.handoffOpAt as number).toBeGreaterThanOrEqual(before);
    expect(output(await ready(host))).toContain("may still be finishing");
  });
});

describe("context-handoff.review-round-3", () => {
  it("a switch turned off while ready waits for the new part to start cancels it", async () => {
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, spawnStatus: "pending", duringSpawn: async () => {
      setTimeout(() => void host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false }), 20);
    } });
    const result = await ready(host);
    expect(output(result)).not.toContain(SUCCESS_MARKER);
    expect(output(result)).toContain("switched off while the next part was starting");
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ abandoned: true });
    expect(await view(host)).toMatchObject({ stage: "watching", nextThreadId: null, autoHandoff: false });
  });

  it("a switch turned off during an uncertain start releases the agent instead of a wait", async () => {
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, spawnFails: "refused", beforeSpawn: async () => {
      await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    } });
    const result = await ready(host);
    expect(output(result)).toContain("Continue in this thread");
    expect(output(result)).not.toContain("Wait at least a minute");
    expect(host.metadata.get(THREAD_ID)!.handoffOp).toBeNull();
  });

  it("an ongoing step never shows as stuck", async () => {
    let host!: Host;
    let seen: unknown;
    host = await loadHost({ metadata: PREPARING, beforeSpawn: async () => {
      timing.startHoldMs = 0;
      seen = await view(host);
    } });
    await ready(host);
    expect(seen).toMatchObject({ creating: true, stuck: false });
  });

  it("a part linked meanwhile from an earlier attempt stands, and the new one is cancelled", async () => {
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, beforeSpawn: async () => {
      Object.assign(host.metadata.get(THREAD_ID)!, { stage: "handed-off", nextThreadId: "thr_other", nextConfirmed: true });
    } });
    const result = await ready(host);
    expect(result.stdout).toContain("Already handed off to @thread:thr_other");
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ abandoned: true });
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ nextThreadId: "thr_other" });
  });

  it("a part archived while it starts is not cancelled during BB's undo window", async () => {
    timing.archiveGraceMs = 30_000;
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, duringSpawn: async id => {
      host.created.set(id, { ...host.created.get(id)!, archivedAt: Date.now() });
    } });
    const result = await ready(host);
    expect(output(result)).toContain("was archived while it was starting");
    expect(host.metadata.get(NEXT_ID)!.abandoned).toBeUndefined();
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ nextThreadId: NEXT_ID });
  });

  it("a confirmed part re-running resume after its earlier thread was purged is not sent back", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    await resume(host, CHECKPOINT);
    host.purge(THREAD_ID);
    const again = await resume(host, "ck_ffffffffffff");
    expect(again.stdout).toContain("Already confirmed");
    expect(again.stdout).toContain("do not restart from HANDOFF.md");
  });

  it("a stray part cannot confirm next to a sibling that already took over a purged thread", async () => {
    const host = await loadHost({ metadata: PREPARING });
    await ready(host);
    await resume(host, CHECKPOINT);
    const stray = host.addThread({ enabled: true, part: 2, chainId: THREAD_ID, previousThreadId: THREAD_ID, createdByOp: "op_late", parentCheckpointId: CHECKPOINT });
    host.purge(THREAD_ID);
    const result = await resume(host, CHECKPOINT, stray);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("another part already took over");
    expect(host.metadata.get(stray)).toMatchObject({ abandoned: true });
  });

  it("keeps the promised reminder across a plugin reload", async () => {
    timing.startHoldMs = 20;
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    await reload(host);
    await waitFor(() => host.sends.length > 0, 3_000);
    expect(host.sends[0]!.text).toContain("Run `bb context-handoff ready` again");
  });

  it("an agent waiting for a reminder is released when the switch is turned off", async () => {
    timing.startHoldMs = 20;
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    await waitFor(() => host.sends.length > 0, 3_000);
    expect(host.sends[0]!.text).toContain("Carry on with the user's work in this thread");
  });
});

describe("context-handoff.review-round-4", () => {
  it("a part that confirmed before an uncertain spawn failure is reported, not called off", async () => {
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, spawnFails: "lost", duringSpawn: async id => {
      await resume(host, CHECKPOINT, id);
      host.failures.list = true;
    } });
    const result = await ready(host);
    expect(result.stdout).toContain(`${SUCCESS_MARKER} Already handed off to @thread:${NEXT_ID}`);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ nextThreadId: NEXT_ID, nextConfirmed: true, enabled: true });
  });

  it("releasing a waiting agent after a global Off also ends the request", async () => {
    timing.startHoldMs = 20;
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    await host.harness.behavior.setSettings({ enabled: false });
    await waitFor(() => host.sends.length > 0, 3_000);
    expect(host.sends[0]!.text).toContain("Carry on with the user's work in this thread");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "watching", checkpointId: null, handoffOp: null });
  });

  it("a switch turned off while a check looks for the part cancels it rather than linking it", async () => {
    let host!: Host;
    let switched = false;
    host = await loadHost({ metadata: { ...PREPARING, handoffOp: "op_found", handoffOpAt: Date.now() }, beforeList: async () => {
      if (switched) return;
      switched = true;
      await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
    } });
    const found = lateThread(host, "op_found");
    await idle(host);
    expect(host.metadata.get(found)).toMatchObject({ abandoned: true });
    expect(host.metadata.get(THREAD_ID)!.nextThreadId).toBeUndefined();
  });

  it("a global Off while the part starts keeps the thread's own switch", async () => {
    let host!: Host;
    host = await loadHost({ metadata: PREPARING, spawnStatus: "pending", duringSpawn: async () => {
      setTimeout(() => void host.harness.behavior.setSettings({ enabled: false }), 20);
    } });
    const result = await ready(host);
    expect(output(result)).toContain("switched off while the next part was starting");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, stage: "watching", nextThreadId: null });
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ abandoned: true });
  });

  it("drops the reminder of a thread that was deleted or archived", async () => {
    timing.startHoldMs = 20;
    const deleted = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(deleted);
    await remove(deleted, THREAD_ID);
    const archived = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(archived);
    archived.thread.archivedAt = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1_500));
    expect(deleted.sends).toEqual([]);
    expect(archived.sends).toEqual([]);
  });

  it("sends one reminder however often the agent runs ready while it waits", async () => {
    timing.startHoldMs = 300;
    const host = await loadHost({ metadata: PREPARING, spawnFails: "refused" });
    await ready(host);
    await ready(host);
    await ready(host);
    await waitFor(() => host.sends.length > 0, 3_000);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(host.sends).toHaveLength(1);
  });
});

describe("context-handoff.switch-on", () => {
  const OFF = { enabled: false };
  const switchOn = (host: Host) => host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
  const switchOff = (host: Host) => host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });

  it("switching on asks an idle thread for its notes at once, at or above 20%", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF });
    const reply = await switchOn(host);
    expect(reply).toMatchObject({ ok: true, result: expect.stringContaining("next safe stopping point"), view: { autoHandoff: true } });
    // No thread event is needed: an idle thread hands off too.
    await waitFor(() => host.sends.length > 0);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]!.mode).toBe("queue-if-active");
    expect(host.sends[0]!.text).toContain("The user switched on handoff for this thread (about 110k tokens used).");
    expect(host.sends[0]!.text).not.toContain("handoff target");
    expect(host.sends[0]!.text).toMatch(/Checkpoint: ck_[0-9a-f]{12}/);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, stage: "preparing", requested: true, preparingAtTokens: 110_000 });
    expect(await view(host)).toMatchObject({ requested: true, stage: "preparing" });
    // Later events do not repeat the request.
    await idle(host);
    expect(host.sends).toHaveLength(1);
  });

  it("asks a running thread after its current turn", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF, thread: { status: "active" } });
    await switchOn(host);
    await waitFor(() => host.sends.length > 0);
    expect(host.sends[0]!.mode).toBe("queue-if-active");
  });

  it("waits for valid usage when switched on with unknown usage", async () => {
    const host = await loadHost({ usedTokens: null, metadata: OFF });
    await switchOn(host);
    await settle();
    expect(host.sends).toEqual([]);
    host.usage.tokens = 150_000;
    await idle(host);
    expect(host.sends).toHaveLength(1);
  });

  it("starts the next part, which waits for the target before handing off again", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF });
    await switchOn(host);
    await waitFor(() => host.sends.length > 0);
    const result = await ready(host);
    expect(output(result)).toContain(SUCCESS_MARKER);
    expect(host.spawns[0]).toMatchObject({ pluginMetadata: { enabled: true, part: 2, previousThreadId: THREAD_ID } });
    expect(host.spawns[0]!.pluginMetadata).not.toHaveProperty("requested");
    expect(await view(host)).toMatchObject({ stage: "handed-off", requested: false });
    await idle(host, { id: NEXT_ID });
    expect(host.sends.filter(s => s.threadId === NEXT_ID)).toEqual([]);
  });

  it("waits while the agent waits for the user, then asks", async () => {
    const options: Options = { usedTokens: 110_000, metadata: OFF, pendingInteraction: true };
    const host = await loadHost(options);
    await switchOn(host);
    await settle();
    expect(host.sends).toEqual([]);
    expect(await view(host)).toMatchObject({ autoHandoff: true, requested: true, stage: "watching" });
    options.pendingInteraction = false;
    await idle(host);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]!.text).toContain("The user switched on handoff");
  });

  it("retries the check when another step holds the thread", async () => {
    let hold = false;
    let holding = false;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF, beforeStateRead: async () => {
      if (!hold) return;
      hold = false;
      holding = true;
      await held;
    } });
    hold = true;
    // A ready that finds no request holds the step lock meanwhile.
    const pending = ready(host);
    await waitFor(() => holding);
    await switchOn(host);
    release();
    expect((await pending).exitCode).toBe(1);
    expect(host.sends).toEqual([]);
    await waitFor(() => host.sends.length > 0, 3_000);
    expect(host.sends[0]!.text).toContain("The user switched on handoff");
  });

  it("switching off withdraws the request, and on again makes a fresh one", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF });
    await switchOn(host);
    await waitFor(() => host.sends.length > 0);
    const first = host.metadata.get(THREAD_ID)!.checkpointId;
    await switchOff(host);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: false, stage: "watching", requested: false });
    expect((await ready(host)).exitCode).toBe(1);
    await idle(host);
    expect(host.sends).toHaveLength(1);
    await switchOn(host);
    await waitFor(() => host.sends.length > 1);
    expect(host.metadata.get(THREAD_ID)!.checkpointId).not.toBe(first);
  });

  it("a cancelled handoff is not requested again by itself, even with the switch kept on", async () => {
    let host!: Host;
    let starting = false;
    host = await loadHost({ usedTokens: 110_000, metadata: OFF, spawnStatus: "pending", duringSpawn: async () => {
      if (starting) setTimeout(() => void host.harness.behavior.setSettings({ enabled: false }), 20);
    } });
    await switchOn(host);
    await waitFor(() => host.sends.length > 0);
    starting = true;
    expect(output(await ready(host))).toContain("switched off while the next part was starting");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, stage: "watching", requested: false });
    await host.harness.behavior.setSettings({ enabled: true });
    await idle(host);
    expect(host.sends).toHaveLength(1);
  });

  it("does nothing for a thread that already handed off", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: { enabled: false, nextThreadId: NEXT_ID, nextConfirmed: true } });
    await switchOn(host);
    await settle();
    expect(host.sends).toEqual([]);
    expect(host.metadata.get(THREAD_ID)!.requested).toBeUndefined();
  });
});

describe("context-handoff.switch-on-review", () => {
  const OFF = { enabled: false };
  const switchOn = (host: Host) => host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
  const switchOff = (host: Host) => host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: false });
  const requestedOn = async (host: Host) => {
    await switchOn(host);
    await waitFor(() => host.sends.length > 0);
  };

  it("a request ended by the global setting is not made again when it comes back on (ready finds it off)", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF });
    await requestedOn(host);
    await host.harness.behavior.setSettings({ enabled: false });
    expect(output(await ready(host))).toContain("Continue in this thread");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, stage: "watching", requested: false });
    await host.harness.behavior.setSettings({ enabled: true });
    await idle(host);
    expect(host.sends).toHaveLength(1);
  });

  it("a request ended by the global setting while BB creates the part is not made again", async () => {
    let host!: Host;
    let starting = false;
    host = await loadHost({ usedTokens: 110_000, metadata: OFF, duringSpawn: async () => {
      if (starting) await host.harness.behavior.setSettings({ enabled: false });
    } });
    await requestedOn(host);
    starting = true;
    expect(output(await ready(host))).toContain("switched off while the next part was starting");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, stage: "watching", requested: false });
    await host.harness.behavior.setSettings({ enabled: true });
    await idle(host);
    expect(host.sends).toHaveLength(1);
  });

  it("a request ended by the global setting while the agent waits for a retry is not made again", async () => {
    timing.startHoldMs = 50;
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF, spawnFails: "refused" });
    await requestedOn(host);
    expect(output(await ready(host))).toContain("Not handed off yet");
    await host.harness.behavior.setSettings({ enabled: false });
    await waitFor(() => host.sends.some(s => s.text.includes("so no new part is starting")), 3_000);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "watching", requested: false });
    await host.harness.behavior.setSettings({ enabled: true });
    const sent = host.sends.length;
    await idle(host);
    expect(host.sends).toHaveLength(sent);
  });

  it("keeps the request when ready finds the agent waiting for the user, and asks again after", async () => {
    const options: Options = { usedTokens: 110_000, metadata: OFF };
    const host = await loadHost(options);
    await requestedOn(host);
    options.pendingInteraction = true;
    expect(output(await ready(host))).toContain("waiting for input");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "watching", requested: true });
    options.pendingInteraction = false;
    await idle(host);
    expect(host.sends).toHaveLength(2);
    expect(host.sends[1]!.text).toContain("The user switched on handoff");
  });

  it("waits for usage at switch-on and measures reminders from the first request", async () => {
    const host = await loadHost({ usedTokens: null, metadata: OFF });
    await switchOn(host);
    await settle();
    expect(host.sends).toEqual([]);
    host.usage.tokens = 250_000;
    await idle(host);
    expect(host.sends).toHaveLength(1);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "preparing", preparingAtTokens: 250_000 });
    host.usage.tokens = 271_000;
    await idle(host);
    expect(host.sends).toHaveLength(2);
    expect(host.sends[1]!.text).toContain("Reminder: This thread is at");
  });

  it("asks a thread whose last turn failed", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF, thread: { status: "error" } });
    await requestedOn(host);
    expect(host.sends[0]!.text).toContain("The user switched on handoff");
  });

  it("tries a request whose send failed again while the banner polls", async () => {
    timing.requestRetryMs = 30;
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF, sendFails: true });
    await switchOn(host);
    await settle();
    expect(host.sends).toEqual([]);
    expect(await view(host)).toMatchObject({ requested: true, stage: "watching" });
    host.failures.send = false;
    await new Promise(resolve => setTimeout(resolve, 40));
    await view(host);
    await waitFor(() => host.sends.length > 0);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ stage: "preparing" });
  });

  it("a pending request survives a reload and the global setting being off, and goes out when polled", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF });
    await host.harness.behavior.setSettings({ enabled: false });
    await switchOn(host);
    await settle();
    expect(host.sends).toEqual([]);
    await reload(host);
    await host.harness.behavior.setSettings({ enabled: true });
    await view(host);
    await waitFor(() => host.sends.length > 0);
    expect(host.sends[0]!.text).toContain("The user switched on handoff");
  });

  it("switching an unconfirmed part off and on again does not ask it for new notes", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: { part: 2, chainId: "thr_first", previousThreadId: "thr_first", createdByOp: "op_1", parentCheckpointId: CHECKPOINT } });
    await switchOff(host);
    const reply = await switchOn(host);
    expect((reply as { result: string }).result).not.toContain("next safe stopping point");
    await settle();
    expect(host.sends).toEqual([]);
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, chainId: "thr_first", part: 2, parentCheckpointId: CHECKPOINT });
    expect(host.metadata.get(THREAD_ID)!.requested).not.toBe(true);
  });

  it("a cancelled part switched on is not prompted into the cancelled work", async () => {
    const host = await loadHost({ usedTokens: 110_000, thread: { status: "error" }, metadata: { enabled: false, abandoned: true, part: 2, chainId: "thr_first", previousThreadId: "thr_first", createdByOp: "op_1" } });
    const reply = await switchOn(host);
    expect((reply as { result: string }).result).not.toContain("next safe stopping point");
    await settle();
    await idle(host);
    expect(host.sends).toEqual([]);
    expect(readState(THREAD_ID, host.metadata.get(THREAD_ID)!)).toMatchObject({ enabled: true, abandoned: true, previousThreadId: "thr_first", chainId: THREAD_ID, requested: false });
    expect(host.metadata.get(THREAD_ID)!.requested).not.toBe(true);
    // No instructions to continue the chain's work, and resume still says it was cancelled.
    const config = await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata: host.metadata.get(THREAD_ID)! as never }));
    expect(config.instructions ?? "").not.toContain("continues earlier work");
    expect(output(await resume(host, CHECKPOINT, THREAD_ID))).toContain("do not continue the earlier work");
    // Its own handoff near the limit uses its own notes folder.
    const workspace = mkdtempSync(join(tmpdir(), "handoff-"));
    const later = await loadHost({ usedTokens: 160_000, workspacePath: workspace, metadata: host.metadata.get(THREAD_ID)! });
    await idle(later);
    expect(later.sends).toHaveLength(1);
    expect(later.sends[0]!.text).toContain(`.handoff/${THREAD_ID}/PLAN.md`);
    expect(later.sends[0]!.text).not.toContain("thr_first/");
  });

  it("Off then On while BB creates the part keeps the new request, which then goes out", async () => {
    let host!: Host;
    let starting = false;
    host = await loadHost({ usedTokens: 110_000, metadata: OFF, duringSpawn: async () => {
      if (!starting) return;
      starting = false;
      await switchOff(host);
      await switchOn(host);
    } });
    await requestedOn(host);
    starting = true;
    expect(output(await ready(host))).toContain("switched off while the next part was starting");
    expect(host.metadata.get(NEXT_ID)).toMatchObject({ abandoned: true });
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, requested: true });
    await waitFor(() => host.sends.length > 1, 3_000);
    expect(host.sends[1]!.text).toContain("The user switched on handoff");
  });

  it("a global Off noticed late in ready ends the request, so it does not come back", async () => {
    let host!: Host;
    let starting = false;
    host = await loadHost({ usedTokens: 110_000, metadata: OFF, beforeExecution: async () => {
      if (starting) await host.harness.behavior.setSettings({ enabled: false });
    } });
    await requestedOn(host);
    starting = true;
    expect(output(await ready(host))).toContain("automatic handoff was switched off");
    expect(host.metadata.get(THREAD_ID)).toMatchObject({ enabled: true, stage: "watching", requested: false });
    await host.harness.behavior.setSettings({ enabled: true });
    host.usage.tokens = 70_000;
    await idle(host);
    expect(host.sends).toHaveLength(1);
    expect(host.spawns).toEqual([]);
  });

  it("tells an agent whose request was withdrawn by Off to carry on, not that it started a handoff itself", async () => {
    const host = await loadHost({ usedTokens: 110_000, metadata: OFF });
    await requestedOn(host);
    await switchOff(host);
    const first = await ready(host);
    expect(first.exitCode).toBe(1);
    expect(output(first)).toContain("handoff was switched off for this thread, so its request was withdrawn");
    expect(output(first)).not.toContain("Do not start a handoff yourself");
    expect(output(await ready(host))).toContain("no handoff was requested");
    expect(host.spawns).toEqual([]);
  });
});

describe("percentage handoff policy", () => {
  it.each([500_000, 1_000_000, 872_000])("waits from below 20% until 30% of %i", async window => {
    const host = await loadHost({ contextWindow: window, usedTokens: window * 0.2 - 1, metadata: { enabled: false } });
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
    await settle();
    expect(host.sends).toHaveLength(0);
    host.usage.tokens = window * 0.3 - 1;
    await idle(host);
    expect(host.sends).toHaveLength(0);
    host.usage.tokens = window * 0.3;
    await idle(host);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]!.mode).toBe("queue-if-active");
  });
  it.each([100_000, 100_001, 400_000])("requests immediately when enabled at %i of 500k", async usedTokens => {
    const host = await loadHost({ usedTokens, metadata: { enabled: false } });
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
    await waitFor(() => host.sends.length === 1);
    expect(host.metadata.get(THREAD_ID)!.requested).toBe(true);
    expect(host.spawns).toEqual([]);
  });
  it.each([null, 0, -1, NaN, Infinity])("waits when the window is invalid: %s", async contextWindow => {
    const host = await loadHost({ contextWindow, usedTokens: 500_000, metadata: { enabled: false } });
    await host.harness.behavior.callRpc("set_enabled", { threadId: THREAD_ID, enabled: true });
    await idle(host);
    expect(host.sends).toEqual([]);
    expect(await view(host)).toMatchObject({ contextWindow: null, limit: null });
  });
  it("does not pile up queued reminders during an active turn", async () => {
    const host = await loadHost({ thread: { status: "active" } });
    await idle(host);
    host.usage.tokens = 300_000;
    await idle(host);
    expect(host.sends).toHaveLength(1);
    expect(host.sends[0]!.text).toContain("including its verification");
  });
  it("keeps parts 2 and 3 beneath the original and automatically on", async () => {
    const host = await loadHost();
    await idle(host);
    expect(output(await ready(host))).toContain(SUCCESS_MARKER);
    expect(host.spawns[0]).toMatchObject({ parentThreadId: THREAD_ID, pluginMetadata: { enabled: true } });
    expect(output(await resume(host, host.metadata.get(THREAD_ID)!.checkpointId as string))).toContain(RESUME_MARKER);
    host.usage.tokens = 149_999;
    await idle(host, host.created.get(NEXT_ID));
    expect(host.sends.filter(s => s.threadId === NEXT_ID)).toHaveLength(0);
    host.usage.tokens = 150_000;
    await idle(host, host.created.get(NEXT_ID));
    expect(host.sends.filter(s => s.threadId === NEXT_ID)).toHaveLength(1);
    expect(output(await host.harness.behavior.runCli(["ready"], { threadId: NEXT_ID }))).toContain(SUCCESS_MARKER);
    expect(host.spawns[1]).toMatchObject({ parentThreadId: THREAD_ID, pluginMetadata: { enabled: true, part: 3, previousThreadId: NEXT_ID } });
  });
});
