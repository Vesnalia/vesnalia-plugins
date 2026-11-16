import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { SessionManager } from "./sessions.js";
import { registerBrowserTools } from "./tools.js";

export async function createBrowserTools(alia: AliaPluginApi): Promise<SessionManager> {
  const manager = new SessionManager(alia);
  manager.bindHostSignals();
  registerBrowserTools(alia, manager);

  alia.background.service("lifecycle", {
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
    alia.events.on(event, ({ thread }) => manager.onThreadStopped(thread.id));
  }

  alia.onDispose(async () => {
    await manager.dispose();
  });

  return manager;
}

export default createBrowserTools;
