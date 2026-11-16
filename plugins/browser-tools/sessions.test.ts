import { createFakePluginHost, makeThreadResponse, type ExperimentalFakeHostRpcCall } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { BrowserToolError, type SessionRecord, type SnapshotPayload } from "./contracts.js";
import { SessionManager } from "./sessions.js";
import { LIMITS } from "./limits.js";
import { FakeDesktop } from "./test/fake-desktop.js";

const HOST = "host_1";
const THREAD = "thr_1";
const INSTANCE = "inst_1";
const GENERATION = "gen_1";
const signal = () => new AbortController().signal;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

let snapshotCounter = 0;
const snapshotPayload = (): SnapshotPayload => ({
  snapshotId: `abcd1234.${++snapshotCounter}`,
  text: '- generic "Snapshot"',
  refs: [],
  url: "about:blank",
  title: "",
  truncated: { text: false, nodes: false, depth: false, refs: false, droppedNodes: 0 },
});

const makeHost = (id: string) => ({
  createdAt: 1,
  id,
  lastRejectedProtocolVersion: null,
  lastSeenAt: 1,
  lifecycle: {
    message: null,
    pendingLog: "",
    phase: "active" as const,
    suspendedAt: null,
    teardown: null,
  },
  machineProviderId: null,
  maxPermissionMode: "full" as const,
  name: `Host ${id}`,
  status: "connected" as const,
  type: "persistent" as const,
  updatedAt: 1,
});

const scope = { hostId: HOST, instanceId: INSTANCE, generation: GENERATION, threadId: THREAD };

function makeRig(options: { idleMs?: number } = {}) {
  const desktop = new FakeDesktop();
  const hostCalls: ExperimentalFakeHostRpcCall[] = [];
  const impls = new Map<string, (input: Record<string, unknown>) => unknown | Promise<unknown>>();
  const driver = async (call: ExperimentalFakeHostRpcCall) => {
    hostCalls.push(call);
    const impl = impls.get(call.method);
    if (impl) return impl(call.input as Record<string, unknown>);
    switch (call.method) {
      case "open":
        return { ok: true, data: { snapshot: snapshotPayload() } };
      case "navigate":
        return {
          ok: true,
          data: { action: { ok: true }, snapshot: snapshotPayload(), snapshotError: null },
        };
      case "snapshot":
        return { ok: true, data: { snapshot: snapshotPayload() } };
      case "click":
      case "type":
      case "press":
        return {
          ok: true,
          data: { action: { ok: true }, snapshot: snapshotPayload(), snapshotError: null },
        };
      case "screenshot":
        return {
          ok: true,
          data: {
            data: "aGk=",
            mimeType: "image/jpeg",
            width: 1,
            height: 1,
            mode: "viewport",
            reduced: false,
            truncated: false,
            bytes: 3,
          },
        };
      case "evaluate":
        return { ok: true, data: { value: 1, truncated: false, notice: null } };
      case "console":
        return { ok: true, data: { entries: [], nextCursor: 0, dropped: 0 } };
      case "close":
        return null;
      default:
        throw new Error(`unhandled host method ${call.method}`);
    }
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "browser-tools",
    sdk: {
      experimental_desktopBrowsers: {
        listInstances: (input) => desktop.listInstances(input),
        listTabs: (input) => desktop.listTabs(input),
        createTab: (input) => desktop.createTab(input),
        acquireControl: (input) => desktop.acquireControl(input),
        openConnection: (input) => desktop.openConnection(input),
        releaseControl: (input) => desktop.releaseControl(input),
        revealTab: (input) => desktop.revealTab(input),
        closeTab: (input) => desktop.closeTab(input),
        captureTab: (input) => desktop.captureTab(input),
        listImportSources: (input) => desktop.listImportSources(input),
        importCookies: (input) => desktop.importCookies(input),
        subscribe: (input) => desktop.subscribe(input),
      },
      hosts: { list: async () => [makeHost(HOST)] },
    },
    experimental_callHostRpc: driver,
  });
  harness.sdk.stub("threads.get", async () => makeThreadResponse({ id: THREAD }));
  const manager = new SessionManager(bb, {
    operationBudgetMs: 2_000,
    navigateBudgetMs: 2_000,
    readyTimeoutMs: 1_000,
    idleMs: options.idleMs ?? 60_000,
    cleanupRetryDelaysMs: [10, 10, 10],
  });
  manager.markReady();
  return { bb, harness, desktop, manager, hostCalls, impls };
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    throw new Error(`expected rejection with ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserToolError);
    expect((error as BrowserToolError).code).toBe(code);
  }
};

describe("SessionManager", () => {
  it("opens a session with one ref-counted watcher and no hot-path KV writes", async () => {
    const rig = makeRig();
    const setSpy = vi.spyOn(rig.bb.storage.kv, "set");
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    expect(opened.session.borrowed).toBe(false);
    expect(rig.desktop.activeSubscriptions).toBe(1);
    expect(setSpy).toHaveBeenCalledTimes(3);

    setSpy.mockClear();
    for (let index = 0; index < 5; index += 1) {
      await rig.manager.snapshot({ sessionId: opened.session.sessionId }, THREAD, signal());
    }
    await rig.manager.click(
      { sessionId: opened.session.sessionId, ref: "abcd1234.1:e1" },
      THREAD,
      signal(),
    );
    expect(setSpy).toHaveBeenCalledTimes(0);

    await rig.manager.close({ closeTab: false }, THREAD, signal());
    expect(rig.desktop.activeSubscriptions).toBe(0);
  });

  it("rejects an open whose thread does not exist", async () => {
    const rig = makeRig();
    rig.harness.sdk.stub("threads.get", async () => {
      throw new Error("thread not found");
    });
    await expect(rig.manager.open({ allowPersonal: false }, THREAD, signal())).rejects.toThrow();
    expect(rig.desktop.calls).not.toContain("createTab");
    rig.harness.sdk.stub("threads.get", async () => makeThreadResponse({ id: THREAD }));
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    expect(opened.session.sessionId).toBeTruthy();
  });

  it("refuses an aborted caller signal before touching the desktop", async () => {
    const rig = makeRig();
    const controller = new AbortController();
    controller.abort();
    await expectCode(
      rig.manager.open({ allowPersonal: false }, THREAD, controller.signal),
      "SESSION_STOPPED",
    );
    expect(rig.desktop.calls).toEqual([]);
  });

  it("rolls back create, acquire, connection, host, and storage failures", async () => {
    {
      const rig = makeRig();
      rig.desktop.createTabError = new Error("create failed");
      await expect(rig.manager.open({ allowPersonal: false }, THREAD, signal())).rejects.toThrow();
      expect(rig.desktop.calls).not.toContain("acquireControl");
      expect(await rig.manager.list(THREAD)).toEqual([]);
    }
    {
      const rig = makeRig();
      rig.desktop.acquireError = new Error("acquire failed");
      await expect(rig.manager.open({ allowPersonal: false }, THREAD, signal())).rejects.toThrow();
      expect(rig.desktop.closedTabs).toHaveLength(0);
      expect(rig.desktop.leases.size).toBe(0);
    }
    {
      const rig = makeRig();
      rig.desktop.connectionError = new Error("connection failed");
      await expect(rig.manager.open({ allowPersonal: false }, THREAD, signal())).rejects.toThrow();
      expect(rig.desktop.leases.size).toBe(0);
      expect(rig.desktop.closedTabs).toHaveLength(0);
    }
    {
      const rig = makeRig();
      rig.impls.set("open", () => ({
        ok: false,
        error: { code: "TARGET_UNAVAILABLE", message: "no page" },
      }));
      await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "TARGET_UNAVAILABLE");
      expect(rig.desktop.leases.size).toBe(0);
      expect(rig.desktop.closedTabs).toHaveLength(0);
      expect(rig.hostCalls.map((call) => call.method)).toContain("close");
    }
    {
      const rig = makeRig();
      const setSpy = vi.spyOn(rig.bb.storage.kv, "set").mockRejectedValueOnce(new Error("disk"));
      await expect(rig.manager.open({ allowPersonal: false }, THREAD, signal())).rejects.toThrow();
      setSpy.mockRestore();
      expect(rig.desktop.closedTabs).toHaveLength(0);
      expect(rig.desktop.leases.size).toBe(0);
    }
  });

  it("cancels an acquire that finishes after the thread stops", async () => {
    const rig = makeRig();
    const gate = deferred<void>();
    rig.desktop.acquireDelay = gate.promise;
    const opening = rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await new Promise((resolve) => setTimeout(resolve, 20));
    const rejected = expectCode(opening, "SESSION_STOPPED");
    let stopped = false;
    const stopping = rig.manager.onThreadStopped(THREAD).then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(stopped).toBe(false);
    gate.resolve();
    await Promise.all([stopping, rejected]);
    expect(await rig.manager.list(THREAD)).toEqual([]);
    expect(rig.desktop.leases.size).toBe(0);
    expect(rig.desktop.closedTabs).toHaveLength(0);
  });

  it("never publishes ready after a host open resolves post-stop", async () => {
    const rig = makeRig();
    const gate = deferred<unknown>();
    rig.impls.set("open", () => gate.promise);
    const opening = rig.manager.open({ allowPersonal: false }, THREAD, signal());
    for (let attempt = 0; attempt < 50 && !rig.hostCalls.some((call) => call.method === "open"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const rejected = expectCode(opening, "SESSION_STOPPED");
    let stopped = false;
    const stopping = rig.manager.onThreadStopped(THREAD).then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(stopped).toBe(false);
    gate.resolve({ ok: true, data: { snapshot: snapshotPayload() } });
    await Promise.all([stopping, rejected]);
    expect(await rig.manager.list(THREAD)).toEqual([]);
    expect(rig.desktop.leases.size).toBe(0);
  });

  it("stops on watcher control loss without deleting the tab", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const tab = [...rig.desktop.tabs.values()].find(
      (candidate) => candidate.tabId === opened.session.tabId,
    );
    expect(tab?.control).not.toBeNull();
    if (tab) tab.control = null;
    rig.desktop.fireChange(scope);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await rig.manager.list(THREAD)).toEqual([]);
    expect(rig.desktop.closedTabs).toEqual([]);
    expect(rig.hostCalls.map((call) => call.method)).toContain("close");
  });

  it("verifies ownership on watcher errors before stopping", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    rig.desktop.fireError(scope);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await rig.manager.list(THREAD)).toHaveLength(1);

    const tab = [...rig.desktop.tabs.values()].find(
      (candidate) => candidate.tabId === opened.session.tabId,
    );
    if (tab) tab.control = null;
    rig.desktop.fireError(scope);
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    expect(await rig.manager.list(THREAD)).toEqual([]);
    expect(rig.desktop.closedTabs).toEqual([]);
  });

  it("stops an expired session on sweep and retains its tab", async () => {
    const rig = makeRig();
    rig.desktop.leaseExpiresAt = Date.now() + 30;
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rig.manager.sweepNow();
    expect(await rig.manager.list(THREAD)).toEqual([]);
    await expectCode(
      rig.manager.snapshot({ sessionId: opened.session.sessionId }, THREAD, signal()),
      "SESSION_NOT_FOUND",
    );
    expect(rig.desktop.closedTabs).toEqual([]);
  });

  it("stops an idle session on sweep and retains its tab", async () => {
    const rig = makeRig({ idleMs: 20 });
    await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rig.manager.sweepNow();
    expect(await rig.manager.list(THREAD)).toEqual([]);
    expect(rig.desktop.closedTabs).toEqual([]);
  });

  it("does not let a stale generation stop a replacement session", async () => {
    const rig = makeRig();
    const first = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    rig.desktop.instances = [{ instanceId: INSTANCE, generation: "gen_2", label: "BB window 1" }];
    const second = await rig.manager.open(
      { instanceId: INSTANCE, allowPersonal: false },
      THREAD,
      signal(),
    );
    const firstTab = [...rig.desktop.tabs.values()].find(
      (candidate) => candidate.tabId === first.session.tabId,
    );
    if (firstTab) firstTab.control = null;
    rig.desktop.fireChange({ ...scope, generation: GENERATION });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const remaining = await rig.manager.list(THREAD);
    expect(remaining.map((session) => session.sessionId)).toEqual([second.session.sessionId]);
    expect(rig.desktop.closedTabs).toEqual([]);
  });

  it("stops host-worker-exit sessions without deleting tabs", async () => {
    const rig = makeRig();
    rig.manager.bindHostSignals();
    await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await rig.harness.behavior.experimental_emitHostWorkerExit(HOST);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await rig.manager.list(THREAD)).toEqual([]);
    expect(rig.desktop.closedTabs).toEqual([]);
    expect(rig.desktop.leases.size).toBe(0);
  });

  it("reconciles prior records without deleting tabs and prunes old completed records", async () => {
    const rig = makeRig();
    const tab = rig.desktop.addTab(THREAD, "https://example.com/");
    const leaseId = "lease_seeded";
    const expiresAt = Date.now() + 60_000;
    tab.control = { controllerLabel: "old", expiresAt, leaseId };
    rig.desktop.leases.set(leaseId, { tabIds: [tab.tabId], expiresAt, scope });
    const record: SessionRecord = {
      version: 1,
      id: "s_seeded",
      threadId: THREAD,
      hostId: HOST,
      phase: "ready",
      createdAt: 1,
      expiresAt,
      lastUsedAt: 1,
      stoppedAt: null,
      desktop: {
        instanceId: INSTANCE,
        generation: GENERATION,
        leaseId,
        tabId: tab.tabId,
        borrowed: false,
        profileId: null,
        pendingClose: false,
      },
      cleanup: { hostConnectionClosed: false, leaseReleased: false, tabClosed: false },
    };
    await rig.bb.storage.kv.set(`sessions/${THREAD}/${record.id}`, record);
    const oldRecord: SessionRecord = {
      ...record,
      id: "s_old",
      phase: "stopped",
      stoppedAt: Date.now() - 25 * 60 * 60_000,
      cleanup: { hostConnectionClosed: true, leaseReleased: true, tabClosed: false },
      desktop: null,
    };
    await rig.bb.storage.kv.set(`sessions/${THREAD}/${oldRecord.id}`, oldRecord);

    await rig.manager.reconcile();
    expect(rig.desktop.leases.size).toBe(0);
    expect(rig.desktop.closedTabs).toEqual([]);
    expect(rig.hostCalls.map((call) => call.method)).toContain("close");
    expect(await rig.bb.storage.kv.get(`sessions/${THREAD}/${oldRecord.id}`)).toBeUndefined();
    const updated = (await rig.bb.storage.kv.get(`sessions/${THREAD}/${record.id}`)) as SessionRecord;
    expect(updated.phase).toBe("stopped");
    expect(updated.cleanup.hostConnectionClosed).toBe(true);
    expect(updated.cleanup.leaseReleased).toBe(true);
  });

  it("bounds sessions per thread and frees capacity on close", async () => {
    const rig = makeRig();
    const opened = [];
    for (let index = 0; index < 4; index += 1) {
      opened.push((await rig.manager.open({ allowPersonal: false }, THREAD, signal())).session.sessionId);
    }
    await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "SESSION_LIMIT");
    await rig.manager.close({ sessionId: opened[0]!, closeTab: false }, THREAD, signal());
    const replacement = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    expect(replacement.session.sessionId).toBeTruthy();
  });

  it("closes only explicitly requested plugin-created tabs", async () => {    {
      const rig = makeRig();
      const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
      const closed = await rig.manager.close({ closeTab: true }, THREAD, signal());
      expect(closed.tabClosed).toBe(true);
      expect(rig.desktop.closedTabs).toEqual([opened.session.tabId]);
    }
    {
      const rig = makeRig();
      const tab = rig.desktop.addTab(THREAD, "https://example.com/");
      tab.profile = { kind: "personal" };
      await rig.manager.open(
        { tabId: tab.tabId, allowPersonal: true, hostId: HOST, instanceId: INSTANCE },
        THREAD,
        signal(),
      );
      await expectCode(rig.manager.close({ closeTab: true }, THREAD, signal()), "UNSUPPORTED_CAPABILITY");
      await rig.manager.close({ closeTab: false }, THREAD, signal());
      expect(rig.desktop.closedTabs).toEqual([]);
    }
    {
      const rig = makeRig();
      const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
      const tab = [...rig.desktop.tabs.values()].find(
        (candidate) => candidate.tabId === opened.session.tabId,
      );
      if (tab) tab.control = { controllerLabel: "someone else", expiresAt: Date.now() + 60_000, leaseId: "other" };
      const closed = await rig.manager.close({ closeTab: true }, THREAD, signal());
      expect(closed.tabClosed).toBe(false);
      expect(rig.desktop.closedTabs).toEqual([]);
    }
  });

  it("allows a new open after a thread stop", async () => {
    const rig = makeRig();
    await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await rig.manager.onThreadStopped(THREAD);
    expect(await rig.manager.list(THREAD)).toEqual([]);
    const reopened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    expect(reopened.session.sessionId).toBeTruthy();
  });

  it("allows a new open after a watcher error verifies ownership", async () => {
    const rig = makeRig();
    await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    rig.desktop.fireError(scope);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await rig.manager.list(THREAD)).toHaveLength(1);
    const second = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    expect(second.session.sessionId).toBeTruthy();
  });

  it("cancels an open awaiting thread authorization", async () => {
    const rig = makeRig();
    const gate = deferred<ReturnType<typeof makeThreadResponse>>();
    rig.harness.sdk.stub("threads.get", () => gate.promise);
    const opening = rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await new Promise((resolve) => setTimeout(resolve, 20));
    await rig.manager.onThreadStopped(THREAD);
    gate.resolve(makeThreadResponse({ id: THREAD }));
    await expectCode(opening, "SESSION_STOPPED");
    expect(rig.desktop.calls).not.toContain("createTab");
    expect(rig.desktop.leases.size).toBe(0);
  });

  it("releases admission once when a failed open's cleanup retries", async () => {
    const rig = makeRig();
    rig.desktop.acquireError = new Error("acquire failed");
    rig.desktop.closeTabError = new Error("close failed");
    await expect(rig.manager.open({ allowPersonal: false }, THREAD, signal())).rejects.toThrow();
    rig.desktop.acquireError = null;
    rig.desktop.closeTabError = null;
    await new Promise((resolve) => setTimeout(resolve, 60));
    for (let index = 0; index < 4; index += 1) {
      await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    }
    await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "SESSION_LIMIT");
    expect(rig.desktop.closedTabs).toEqual([]);
  });

  it("never retries tab destruction after rollback", async () => {
    const rig = makeRig();
    rig.desktop.acquireError = new Error("acquire failed");
    rig.desktop.closeTabError = new Error("close failed");
    await expect(rig.manager.open({ allowPersonal: false }, THREAD, signal())).rejects.toThrow();
    expect(rig.desktop.closedTabs).toEqual([]);
    rig.desktop.closeTabError = null;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rig.desktop.closedTabs).toHaveLength(0);
  });

  it("does not unwatch a newer session when an old cleanup retry runs", async () => {
    const rig = makeRig();
    rig.impls.set("close", () => {
      throw new Error("host close failed");
    });
    const first = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await rig.manager.close({ sessionId: first.session.sessionId, closeTab: false }, THREAD, signal());
    expect(rig.desktop.activeSubscriptions).toBe(0);

    const second = await rig.manager.open(
      { instanceId: INSTANCE, allowPersonal: false },
      THREAD,
      signal(),
    );
    expect(rig.desktop.activeSubscriptions).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rig.desktop.activeSubscriptions).toBe(1);

    const tab = [...rig.desktop.tabs.values()].find(
      (candidate) => candidate.tabId === second.session.tabId,
    );
    if (tab) tab.control = null;
    rig.desktop.fireChange({ ...scope, threadId: THREAD });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await rig.manager.list(THREAD)).toEqual([]);
  });

  it("fails the open when the initial navigation snapshot fails", async () => {
    const rig = makeRig();
    rig.impls.set("navigate", () => ({
      ok: true,
      data: {
        action: { ok: true },
        snapshot: null,
        snapshotError: { code: "TARGET_UNAVAILABLE", message: "snapshot failed" },
      },
    }));
    await expectCode(
      rig.manager.open({ url: "https://example.com/", allowPersonal: false }, THREAD, signal()),
      "TARGET_UNAVAILABLE",
    );
    expect(await rig.manager.list(THREAD)).toEqual([]);
  });
  it.each(["thread", "dispose"])("R2 fences final persistence on %s stop", async (kind) => {
    const rig = makeRig();
    const gate = deferred<void>();
    const original = rig.bb.storage.kv.set.bind(rig.bb.storage.kv);
    let writes = 0;
    vi.spyOn(rig.bb.storage.kv, "set").mockImplementation(async (...args) => {
      if (++writes === 3) await gate.promise;
      return original(...args);
    });
    const opening = rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await vi.waitFor(() => expect(writes).toBe(3));
    const rejected = expectCode(opening, "SESSION_STOPPED");
    const stopping = kind === "thread" ? rig.manager.onThreadStopped(THREAD) : rig.manager.dispose();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(stopped).toBe(false);
    gate.resolve();
    await stopping;
    await rejected;
    expect(await rig.manager.list(THREAD)).toEqual([]);
    expect(rig.desktop.activeSubscriptions).toBe(0);
    expect(rig.desktop.leases.size).toBe(0);
    const keys = await rig.bb.storage.kv.list("sessions/");
    const record = await rig.bb.storage.kv.get(keys[0]!) as SessionRecord;
    expect(record.phase).toBe("stopped");
    expect(record.cleanup.leaseReleased).toBe(true);
  });

  it("R1 retains takeover before poll and permanently withdraws pending deletion", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const tab = rig.desktop.tabs.get(opened.session.tabId)!;
    tab.control = null;
    expect((await rig.manager.close({ closeTab: true }, THREAD, signal())).tabClosed).toBe(false);
    await rig.manager.reconcile();
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(rig.desktop.closedTabs).toEqual([]);
    await rig.manager.dispose();
  });

  it("R1 failed open after takeover never deletes the created tab", async () => {
    const rig = makeRig();
    rig.impls.set("open", () => {
      [...rig.desktop.tabs.values()][0]!.control = null;
      return { ok: false, error: { code: "TARGET_UNAVAILABLE", message: "lost" } };
    });
    await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "TARGET_UNAVAILABLE");
    expect(rig.desktop.closedTabs).toEqual([]);
  });

  it("R3 retains late acquired identity across failed release and restart", async () => {
    const rig = makeRig();
    const gate = deferred<void>();
    rig.desktop.acquireDelay = gate.promise;
    rig.desktop.releaseError = new Error("offline");
    const opening = rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await vi.waitFor(() => expect(rig.desktop.calls).toContain("acquireControl"));
    const rejected = expectCode(opening, "SESSION_STOPPED");
    let stopped = false;
    const stopping = rig.manager.onThreadStopped(THREAD).then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(stopped).toBe(false);
    gate.resolve();
    await Promise.all([stopping, rejected]);
    const keys = await rig.bb.storage.kv.list("sessions/");
    const record = await rig.bb.storage.kv.get(keys[0]!) as SessionRecord;
    expect(record.desktop?.leaseId).not.toBe("");
    expect(record.cleanup.leaseReleased).toBe(false);
    await rig.manager.dispose();
    rig.desktop.releaseError = null;
    const restarted = new SessionManager(rig.bb);
    await restarted.reconcile();
    expect(rig.desktop.leases.size).toBe(0);
    expect(rig.desktop.closedTabs).toEqual([]);
    await restarted.dispose();
  });

  it("R4 does not confuse absent server registry with desktop release", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    rig.desktop.desktopReleaseError = new Error("desktop offline");
    await rig.manager.close({ closeTab: false }, THREAD, signal());
    await new Promise(resolve => setTimeout(resolve, 40));
    const record = await rig.bb.storage.kv.get(`sessions/${THREAD}/${opened.session.sessionId}`) as SessionRecord;
    expect(rig.desktop.leases.size).toBe(0);
    expect(rig.desktop.tabs.get(opened.session.tabId)?.control).not.toBeNull();
    expect(record.cleanup.leaseReleased).toBe(false);
    await rig.manager.dispose();
  });

  it("R5 accounts for 64 unresolved startup records", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const seed = await rig.bb.storage.kv.get(`sessions/${THREAD}/${opened.session.sessionId}`) as SessionRecord;
    await rig.manager.close({ closeTab: false }, THREAD, signal());
    rig.impls.set("close", () => { throw new Error("offline"); });
    for (let i = 0; i < 64; i++) {
      const record = { ...seed, id: `s_prior_${i}`, threadId: `thr_prior_${i}`, cleanup: { ...seed.cleanup } };
      await rig.bb.storage.kv.set(`sessions/${record.threadId}/${record.id}`, record);
    }
    await rig.manager.reconcile();
    await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "SESSION_LIMIT");
    await rig.manager.dispose();
  });

  it("R5 bounds repeated unresolved close cycles", async () => {
    const rig = makeRig();
    rig.impls.set("close", () => { throw new Error("offline"); });
    for (let i = 0; i < 64; i++) {
      await rig.manager.open({ allowPersonal: false }, THREAD, signal());
      await rig.manager.close({ closeTab: false }, THREAD, signal());
    }
    await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "SESSION_LIMIT");
    await rig.manager.dispose();
  });

  it("R9 suspends commands during ownership verification and resumes", async () => {
    const rig = makeRig();
    await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const gate = deferred<void>();
    rig.desktop.listTabsDelay = gate.promise;
    rig.desktop.fireError(scope);
    const before = rig.hostCalls.length;
    await expectCode(rig.manager.click({ ref: "abcd1234.1:e1" }, THREAD, signal()), "TARGET_UNAVAILABLE");
    expect(rig.hostCalls.length).toBe(before);
    gate.resolve();
    await new Promise(resolve => setTimeout(resolve, 20));
    await rig.manager.click({ ref: "abcd1234.1:e1" }, THREAD, signal());
    await rig.manager.dispose();
  });

  it("R1 withdraws deletion on other-controller takeover even after their release and restart", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const tab = rig.desktop.tabs.get(opened.session.tabId)!;
    tab.control = { leaseId: "human", controllerLabel: "Human", expiresAt: Date.now() + 60000 };
    rig.impls.set("close", () => { throw new Error("worker offline"); });
    await rig.manager.close({ closeTab: true }, THREAD, signal());
    tab.control = null;
    await new Promise(resolve => setTimeout(resolve, 40));
    await rig.manager.dispose();
    rig.impls.delete("close");
    const restarted = new SessionManager(rig.bb);
    await restarted.reconcile();
    expect(rig.desktop.closedTabs).toEqual([]);
    await restarted.dispose();
  });

  it("R1 restart discards legacy pendingClose rather than inferring authorization", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const key = `sessions/${THREAD}/${opened.session.sessionId}`;
    const seed = await rig.bb.storage.kv.get(key) as SessionRecord;
    await rig.manager.dispose();
    seed.desktop!.pendingClose = true;
    await rig.bb.storage.kv.set(key, seed);
    const restarted = new SessionManager(rig.bb, { cleanupRetryDelaysMs: [10] });
    await restarted.reconcile();
    await new Promise(resolve => setTimeout(resolve, 40));
    expect((await rig.bb.storage.kv.get(key) as SessionRecord).desktop?.pendingClose).toBe(false);
    expect(rig.desktop.closedTabs).toEqual([]);
    await restarted.dispose();
  });

  it("R3 captures delayed create identity before cancellation cleanup", async () => {
    const rig = makeRig();
    const gate = deferred<void>();
    rig.desktop.createTabDelay = gate.promise;
    const opening = rig.manager.open({ allowPersonal: false }, THREAD, signal());
    await vi.waitFor(() => expect(rig.desktop.calls).toContain("createTab"));
    const rejected = expectCode(opening, "SESSION_STOPPED");
    let stopped = false;
    const stopping = rig.manager.onThreadStopped(THREAD).then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(stopped).toBe(false);
    gate.resolve();
    await Promise.all([stopping, rejected]);
    const keys = await rig.bb.storage.kv.list("sessions/");
    const record = await rig.bb.storage.kv.get(keys[0]!) as SessionRecord;
    expect(record.desktop?.tabId).toBe([...rig.desktop.tabs.keys()][0]);
    expect(rig.desktop.closedTabs).toEqual([]);
    expect(rig.desktop.calls).not.toContain("acquireControl");
  });

  it("R5 retains cleanup evidence through failed storage writes and retries persistence", async () => {
    const rig = makeRig();
    const opened = await rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const spy = vi.spyOn(rig.bb.storage.kv, "set").mockRejectedValue(new Error("storage offline"));
    await rig.manager.close({ closeTab: false }, THREAD, signal());
    expect(rig.harness.logEntries.some(entry => entry.message.includes("could not be persisted"))).toBe(true);
    spy.mockRestore();
    const key = `sessions/${THREAD}/${opened.session.sessionId}`;
    await vi.waitFor(async () => expect((await rig.bb.storage.kv.get(key) as SessionRecord).phase).toBe("stopped"));
    await rig.manager.dispose();
  });

  it("thread stop timeout preserves cancellation until a later successful drain", async () => {
    const rig = makeRig();
    const gate = deferred<void>();
    rig.desktop.acquireDelay = gate.promise;
    const opening = rig.manager.open({ allowPersonal: false }, THREAD, signal());
    const rejected = expectCode(opening, "SESSION_STOPPED");
    await vi.waitFor(() => expect(rig.desktop.calls).toContain("acquireControl"));
    vi.useFakeTimers();
    try {
      const stopping = expectCode(rig.manager.onThreadStopped(THREAD), "TARGET_UNAVAILABLE");
      await vi.advanceTimersByTimeAsync(LIMITS.cleanup.disposeDrainMs);
      await stopping;
      await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "SESSION_STOPPED");
      gate.resolve();
      await rejected;
      expect(rig.desktop.leases.size).toBe(0);
      // A timeout reports failure, not permission to start another session.
      await expectCode(rig.manager.open({ allowPersonal: false }, THREAD, signal()), "SESSION_STOPPED");
      await rig.manager.onThreadStopped(THREAD);
      expect((await rig.manager.open({ allowPersonal: false }, THREAD, signal())).session.sessionId).toBeTruthy();
      await rig.manager.dispose();
    } finally {
      gate.resolve();
      vi.useRealTimers();
    }
  });

});
