import type { TestContext } from "node:test";
import { defineCli } from "@vesnalia/plugin-sdk";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import { MONITOR_DEFAULTS, type MonitorConfig } from "../src/core/document.ts";
import { monitorCommands } from "../src/plugin/monitor-cli.ts";
import { startMonitor, type MonitorDeps } from "../src/plugin/monitor.ts";

export const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function testDeps(overrides: Partial<MonitorDeps> = {}): MonitorDeps {
  return {
    settings: () => ({ ...MONITOR_DEFAULTS }),
    hosts: async () => [],
    serverHostId: async () => null,
    boxes: async () => [],
    hostSnapshot: async () => {
      throw new Error("no host entry in this test");
    },
    runInBox: async () => {
      throw new Error("no box in this test");
    },
    encoderRoom: async () => null,
    log: { warn: () => undefined },
    ...overrides,
  };
}

export async function startTestMonitor(t: TestContext, options: { config?: Partial<MonitorConfig>; deps?: Partial<MonitorDeps> } = {}) {
  let config: MonitorConfig = { ...MONITOR_DEFAULTS, ...options.config };
  const { alia, harness } = createFakePluginHost({ pluginId: "alia-box" });
  const monitor = startMonitor(alia, testDeps({ settings: () => config, ...options.deps }));
  alia.cli.register(defineCli({ name: "box", summary: "Boxes for VesnALIA threads.", commands: monitorCommands(alia, monitor) }));
  t.after(() => harness.lifecycle.dispose());
  const setConfig = (patch: Partial<MonitorConfig>) => {
    config = { ...config, ...patch };
    monitor.configure(config);
  };
  return { alia, harness, monitor, setConfig };
}
