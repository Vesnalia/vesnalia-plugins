// alia-autoresearch — server entry. Wiring only; behavior lives in src/.
//
// Order matters for reconciliation: register every handler (tools, CLI,
// events, rpc) first, then reconcile running studies from the background service
// once the load commits (host RPC and alia.sdk are available there).
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { createAliaPort } from "./src/alia-port.ts";
import { studyCli } from "./src/cli.ts";
import { DEFAULT_CONFIG, HostMutex, type Ctx, type EngineConfig } from "./src/context.ts";
import { MIGRATIONS } from "./src/db/schema.ts";
import { Store } from "./src/db/store.ts";
import { Engine } from "./src/engine.ts";
import { hostContract, hostSignals } from "./src/host/contract.ts";
import { ProgressBus } from "./src/host/runner.ts";
import { errText } from "./src/pipeline.ts";
import type { AliaPort } from "./src/ports.ts";
import { seededRng } from "./src/stats.ts";
import { registerRpc } from "./src/rpc.ts";
import { registerTools } from "./src/tools.ts";

export interface PluginDeps {
  /** Override the VesnALIA adapter (tests). */
  port?: (alia: AliaPluginApi) => AliaPort;
  config?: Partial<EngineConfig>;
  seed?: number;
  now?: () => number;
  /** Tests: receive the engine (to seed or inspect state). */
  onEngine?: (engine: Engine) => void;
}

export function createAutoresearchPlugin(deps: PluginDeps = {}) {
  return async function plugin(alia: AliaPluginApi): Promise<void> {
    const db = alia.storage.database();
    alia.storage.migrate(db, MIGRATIONS);
    const now = deps.now ?? Date.now;
    const store = new Store(db, now);
    const client = alia.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
    // Host job progress streams back as signals; runners subscribe by job id.
    const progress = new ProgressBus();
    client.experimental_onSignal("progress", ({ payload }) => progress.emit(payload.key, payload.message));
    const rawPort = deps.port ? deps.port(alia) : createAliaPort(alia, client, progress);
    // After dispose (reload, disable, shutdown) the old instance logs nothing: work still in flight stops quietly.
    const port: AliaPort = new Proxy(rawPort, {
      get(target, key) {
        if (key === "log") return (level: "info" | "warn" | "error", message: string) => (ctx.disposed ? undefined : target.log(level, message));
        const v = Reflect.get(target, key, target) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const ctx: Ctx = {
      store,
      alia: port,
      now,
      rng: seededRng(deps.seed ?? (now() & 0xffffffff)),
      benchLock: new HostMutex(),
      config: { ...DEFAULT_CONFIG, ...deps.config },
    };
    const engine = new Engine(ctx);
    deps.onEngine?.(engine);
    // Stop the old instance before VesnALIA closes its database (see Engine.dispose).
    alia.onDispose(async () => await engine.dispose());

    registerTools(alia, engine);
    registerRpc(alia, engine);
    alia.cli.register(studyCli(engine));

    const safe = (name: string, fn: () => void | Promise<void>) => {
      if (ctx.disposed) return;
      try {
        const r = fn();
        if (r instanceof Promise) r.catch((e) => ctx.alia.log("warn", `${name}: ${errText(e)}`));
      } catch (e) {
        ctx.alia.log("warn", `${name}: ${errText(e)}`);
      }
    };
    alia.events.on("thread.idle", ({ thread }) => safe("thread.idle", () => engine.onThreadIdle(thread.id)));
    alia.events.on("thread.active", ({ thread }) => safe("thread.active", () => engine.onThreadActive(thread.id)));
    alia.events.on("thread.failed", ({ thread }) => safe("thread.failed", () => engine.onThreadFailed(thread.id)));
    alia.events.on("thread.archived", ({ thread }) => safe("thread.archived", () => engine.onThreadGone(thread.id, "archived")));
    alia.events.on("thread.deleted", ({ thread }) => safe("thread.deleted", () => engine.onThreadGone(thread.id, "deleted")));
    alia.events.on("turn.failed", (event) => safe("turn.failed", () => engine.onTurnFailed(event)));
    // Live view: what each worker's agent is doing (tool items only), at most once a second per thread.
    alia.events.on("experimental_thread.events", ({ thread, sequence }) => safe("thread.events", () => engine.onThreadEvents(thread.id, sequence)));
    // Quiet bench: a new worker turn on a machine that is measuring waits until the measurement ends.
    // Fail-open: an error here must never block a dispatch.
    alia.experimental_hooks.on("message.dispatch", (hook) => {
      try {
        return engine.dispatchDecision({
          threadId: hook.thread.id,
          attempt: hook.attempt,
          hostId: hook.host?.id ?? hook.environment?.hostId ?? null,
          spawnedByPlugin: hook.thread.originPluginId === alia.pluginId || hook.originPluginId === alia.pluginId,
        });
      } catch (e) {
        ctx.alia.log("warn", `message.dispatch: ${errText(e)}`);
        return { action: "proceed" };
      }
    });
    client.experimental_onWorkerExit(({ hostId }) => {
      // In-flight host calls and jobs died with the worker: measurements on
      // that host restart from scratch (partial samples discarded).
      if (ctx.disposed) return;
      alia.log.warn(`host worker exited on ${hostId}`);
      engine.onHostWorkerExit(hostId);
    });

    alia.background.service("engine", {
      async start(signal) {
        try {
          const r = await engine.reconcile();
          alia.log.info(`reconciled: ${r.requeued} measurement(s) requeued, ${r.workers} worker(s) checked, ${r.calibrations} calibration(s) restarted`);
        } catch (e) {
          alia.log.error(`reconcile failed: ${errText(e)}`);
        }
        while (!signal.aborted) {
          await engine.tick().catch((e) => ctx.alia.log("warn", `tick: ${errText(e)}`));
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, ctx.config.tickMs);
            signal.addEventListener("abort", () => {
              clearTimeout(t);
              resolve();
            }, { once: true });
          });
        }
      },
    });
  };
}

export default createAutoresearchPlugin();
