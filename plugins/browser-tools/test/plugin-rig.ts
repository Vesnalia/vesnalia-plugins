import {
  createFakePluginHost,
  makeThreadResponse,
  type ExperimentalFakeHostRpcCall,
} from "@vesnalia/plugin-sdk/testing";
import type { SnapshotPayload } from "../contracts.js";
import browserTools from "../server.js";
import { FakeDesktop } from "./fake-desktop.js";
export const HOST = "host_1";
export const THREAD = "thr_1";
export const INSTANCE = "inst_1";
export const GENERATION = "gen_1";

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

let snapshotCounter = 0;
export const snapshotPayload = (): SnapshotPayload => ({
  snapshotId: `abcd1234.${++snapshotCounter}`,
  text: '- generic "Snapshot"',
  refs: [],
  url: "about:blank",
  title: "",
  truncated: { text: false, nodes: false, depth: false, refs: false, droppedNodes: 0 },
});

export const makeHostEntity = (id: string) => ({
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

export const scope = {
  hostId: HOST,
  instanceId: INSTANCE,
  generation: GENERATION,
  threadId: THREAD,
};

export function makePluginRig(options: { settings?: Record<string, boolean | string> } = {}) {
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
  const { alia, harness } = createFakePluginHost({
    pluginId: "browser-tools",
    settings: options.settings,
    agentSkillIds: ["browser-tools"],
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
      hosts: { list: async () => [makeHostEntity(HOST)] },
    },
    experimental_callHostRpc: driver,
  });
  harness.sdk.stub("threads.get", async () => makeThreadResponse({ id: THREAD }));
  const ready = (async () => {
    const manager = await browserTools(alia);
    manager.markReady();
    return manager;
  })();
  return { alia, harness, desktop, hostCalls, impls, ready };
}

/** Runs the registered lifecycle service once, like the host does after load. */
export function startLifecycleService(harness: ReturnType<typeof makePluginRig>["harness"]) {
  return harness.behavior.runService("lifecycle");
}

export function makeAgentContext(
  overrides: { origin?: { kind: "fork" | null; pluginId: string | null } } = {},
) {
  return {
    thread: { id: THREAD, title: null, parentThreadId: null, sourceThreadId: null },
    project: { id: "proj_1", kind: "standard" as const, name: "Project", gitRemoteUrl: null },
    environment: {
      id: "env_1",
      name: null,
      path: null,
      branchName: null,
      workspaceProvisionType: null,
    },
    host: { id: HOST, name: "Host" },
    provider: {
      id: "codex",
      model: "gpt",
      capabilities: { supportsNativeUserQuestion: false },
    },
    origin: overrides.origin ?? { kind: null, pluginId: null },
  };
}
