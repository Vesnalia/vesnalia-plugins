import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { SessionManager } from "./sessions.js";
import { registerBrowserTools } from "./tools.js";

export async function createBrowserTools(bb: BbPluginApi): Promise<SessionManager> {
  const manager = new SessionManager(bb);
  manager.bindHostSignals();
  registerBrowserTools(bb, manager);

  bb.background.service("lifecycle", {
    async start(signal) {
      await manager.reconcile();
      manager.markReady();
      manager.startSweeper();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });

  for (const event of ["thread.archived", "thread.deleted", "thread.failed"] as const) {
    bb.events.on(event, ({ thread }) => manager.onThreadStopped(thread.id));
  }

  bb.onDispose(async () => {
    await manager.dispose();
  });

  return manager;
}

export default createBrowserTools;
