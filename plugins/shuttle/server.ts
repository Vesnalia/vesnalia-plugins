// Shuttle: wiring only. Behavior lives in src/.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { sleep, type Runner } from "./src/adapters/exec";
import { createAliaPort } from "./src/alia-port";
import { createCli } from "./src/cli";
import { errText } from "./src/ctx";
import { MIGRATIONS } from "./src/db/schema";
import { Store } from "./src/db/store";
import type { AliaPort } from "./src/ports";
import { registerRpc } from "./src/rpc";
import { SETTINGS, toSettings, type Settings } from "./src/settings";
import { Shuttle } from "./src/shuttle";
import { registerTools } from "./src/tools";

export interface PluginDeps {
  port?: (alia: AliaPluginApi) => AliaPort;
  runner?: Runner;
  now?: () => number;
  tickMs?: number;
}

const TICK_MS = 30_000;

/** Settles when `work` settles or `signal` aborts, whichever is first, and leaves no listener on the signal. */
function untilAborted(signal: AbortSignal, work: Promise<unknown>): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done, { once: true });
    work.then(done, done);
  });
}

export function createShuttlePlugin(deps: PluginDeps = {}) {
  return async function shuttle(alia: AliaPluginApi): Promise<void> {
    const db = alia.storage.database();
    alia.storage.migrate(db, MIGRATIONS);
    const now = deps.now ?? Date.now;
    const store = new Store(db, now);
    const settingsHandle = alia.settings.define(SETTINGS);
    let settings: Settings = toSettings(await settingsHandle.get());
    const setSettings: AliaPort["setSettings"] = async (patch) => {
      settings = toSettings(await settingsHandle.experimental_set(patch));
    };
    const port = deps.port ? deps.port(alia) : createAliaPort(alia, setSettings);
    const lifetime = new AbortController();
    const app = new Shuttle({ store, port, now, settings: () => settings, runner: deps.runner, lifetime: lifetime.signal });
    port.beforePublish?.(() => {
      if (!disposed) app.warmIndexes();
    });
    let disposed = false;
    let ticking: Promise<void> | null = null;
    alia.onDispose(async () => {
      disposed = true;
      lifetime.abort();
      await ticking;
    });
    settingsHandle.onChange((next, prev) => {
      settings = toSettings(next);
      if (next.pauseAutomations !== prev.pauseAutomations) app.clearTimedPause();
      // Turning auto agent on gives the PRs without one their agents now, not at the next sync.
      if (settings.autoAgent && prev.autoAgent !== true && !disposed) app.autoAgent().catch((error: unknown) => alia.log.warn(`auto agent: ${errText(error)}`));
      port.publish();
    });

    app.resumePosts();
    app.resumeMerges();
    registerRpc(alia, app);
    registerTools(alia, app);
    alia.cli.register(createCli(app));

    const safe = (name: string, fn: () => unknown) => {
      if (disposed) return;
      try {
        const result = fn();
        if (result instanceof Promise) result.catch((error: unknown) => !disposed && alia.log.warn(`${name}: ${errText(error)}`));
      } catch (error) {
        alia.log.warn(`${name}: ${errText(error)}`);
      }
    };
    alia.events.on("thread.idle", ({ thread, lastAssistantText }) => safe("thread.idle", () => app.onThreadIdle(thread.id, thread.parentThreadId, lastAssistantText)));
    alia.events.on("thread.active", ({ thread }) => safe("thread.active", () => app.onThreadActive(thread.id, thread.parentThreadId)));
    alia.events.on("interaction.pending", ({ thread }) => safe("interaction.pending", () => app.onInteractionPending(thread.id)));
    alia.events.on("thread.failed", ({ thread, error }) => safe("thread.failed", () => app.onThreadFailed(thread.id, { error, environmentId: thread.environmentId })));
    alia.events.on("thread.archived", ({ thread }) => safe("thread.archived", () => app.onThreadArchived(thread.id)));
    alia.events.on("thread.deleted", ({ thread }) => safe("thread.deleted", () => app.onThreadDeleted(thread.id)));

    const unsubscribers = [
      alia.sdk.subscribe({
        event: "project:changed",
        callback(event) {
          if (event.changes.some((change) => change !== "threads-changed")) safe("projects changed", () => app.invalidateProjects());
        },
      }),
      alia.sdk.subscribe({
        event: "realtime:connection",
        callback(event) {
          if (event.state === "connected") safe("projects reconnected", () => app.invalidateProjects());
        },
      }),
    ];
    alia.onDispose(() => { for (const unsubscribe of unsubscribers) unsubscribe(); });

    // VesnALIA gives a stopping service 5 s and then loads no new version until a manual reload, so start returns as soon as VesnALIA
    // aborts it, even while a tick waits on VesnALIA; dispose, which VesnALIA runs next, waits for that tick.
    alia.background.service("sync", {
      async start(signal) {
        while (!signal.aborted) {
          const tick = app.tick(signal).catch((error: unknown) => alia.log.warn(`sync: ${errText(error)}`));
          ticking = tick;
          void tick.finally(() => {
            if (ticking === tick) ticking = null;
          });
          await untilAborted(signal, tick);
          await sleep(deps.tickMs ?? TICK_MS, signal);
        }
      },
    });
  };
}

export default createShuttlePlugin();
