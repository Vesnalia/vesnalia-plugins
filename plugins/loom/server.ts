// Loom: wiring only. Behavior lives in src/.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { createAliaPort, createHostPort } from "./src/alia-port";
import { createCli } from "./src/cli";
import { MIGRATIONS } from "./src/db/schema";
import { Store } from "./src/db/store";
import { Engine } from "./src/engine";
import type { AliaPort, HostPort } from "./src/ports";
import { Projects } from "./src/projects";
import { SETTINGS } from "./src/record";
import { registerRpc, watchChanges } from "./src/rpc";
import { registerTools } from "./src/tools";

export interface PluginDeps {
  port?: (alia: AliaPluginApi) => AliaPort;
  host?: (alia: AliaPluginApi) => HostPort;
  now?: () => number;
  /** How often the engine loop runs. */
  tickMs?: number;
}

const TICK_MS = 15_000;
const errText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createLoomPlugin(deps: PluginDeps = {}) {
  return async function loom(alia: AliaPluginApi): Promise<void> {
    const db = alia.storage.database();
    alia.storage.migrate(db, MIGRATIONS);
    const now = deps.now ?? Date.now;
    const store = new Store(db, now);
    // Nothing in this process has started a run yet, so every open run belongs to an earlier one.
    store.endOpenRuns("Loom restarted before this step finished.");
    const port = deps.port ? deps.port(alia) : createAliaPort(alia);
    const settings = alia.settings.define(SETTINGS);
    let done = await settings.get();
    settings.onChange((next) => {
      done = next;
    });
    const host = deps.host ? deps.host(alia) : createHostPort(alia);
    const projects = new Projects({ store, alia: port, now, host, plannerInstructions: () => done.plannerInstructions });
    const engine = new Engine({ store, alia: port, now, host, projects, settings: () => done });
    let disposed = false;
    const stopWatching = watchChanges(alia, store);
    alia.onDispose(async () => {
      disposed = true;
      stopWatching();
      await engine.dispose();
    });

    registerTools(alia, projects, engine);
    registerRpc(alia, { projects, engine, store, now });
    alia.cli.register(createCli(projects, engine, store, now));

    // A failing handler never throws into VesnALIA, and a handler that outlives a reload stays quiet.
    const safe = (name: string, fn: () => void | Promise<void>) => {
      if (disposed) return;
      const failed = (error: unknown) => {
        if (!disposed) alia.log.warn(`${name}: ${errText(error)}`);
      };
      try {
        const result = fn();
        if (result instanceof Promise) result.catch(failed);
      } catch (error) {
        failed(error);
      }
    };
    alia.events.on("thread.idle", ({ thread, lastAssistantText }) => safe("thread.idle", () => engine.onThreadIdle(thread.id, lastAssistantText ?? null)));
    alia.events.on("thread.failed", ({ thread }) => safe("thread.failed", () => engine.onThreadFailed(thread.id)));
    alia.events.on("thread.archived", ({ thread }) => safe("thread.archived", () => engine.onThreadGone(thread.id, "archived")));
    alia.events.on("thread.deleted", ({ thread }) => safe("thread.deleted", () => engine.onThreadGone(thread.id, "deleted")));
    alia.events.on("turn.failed", (event) => safe("turn.failed", () => engine.onTurnFailed(event)));

    // alia.sdk and host calls work from here on, so reconciliation waits for the service rather than running at load.
    alia.background.service("engine", {
      async start(signal) {
        try {
          const result = await engine.reconcile();
          alia.log.info(`reconciled: ${result.adopted} spawn(s) adopted, ${result.rolledBack} rolled back, ${result.rechecked} check run(s) restarted`);
        } catch (error) {
          alia.log.error(`reconcile failed: ${errText(error)}`);
        }
        while (!signal.aborted) {
          await engine.tick().catch((error) => safe("tick", () => Promise.reject(error)));
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, deps.tickMs ?? TICK_MS);
            signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
          });
        }
      },
    });
  };
}

export default createLoomPlugin();
