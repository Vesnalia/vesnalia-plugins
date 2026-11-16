import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { registerCli } from "./src/cli";
import { Companions } from "./src/companion";
import { CompanionMarks } from "./src/marks";
import { rpcContract } from "./src/contract";
import { FlareService, startsTurnWithOnlyFlareNotes } from "./src/service";
import { SETTING_DESCRIPTORS, readSettings } from "./src/settings";
import { registerProvider } from "./src/provider";
import { FlareStore, MIGRATIONS } from "./src/store";
import { registerTools } from "./src/tools";

export const NUDGE_INTERVAL_MS = 30_000;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

export default function flare(alia: AliaPluginApi): void {
  const settings = alia.settings.define(SETTING_DESCRIPTORS);
  const db = alia.storage.database();
  alia.storage.migrate(db, MIGRATIONS);
  // Only this plugin writes its database, so a long wait means something is wrong; a flare must never sit behind it.
  db.pragma("busy_timeout = 500");
  const store = new FlareStore(db);
  const flares = new FlareService(alia, store, async () => readSettings(await settings.get()), Date.now, new Companions(alia, store));
  registerProvider(alia);

  const marks = new CompanionMarks(alia);
  alia.rpc.register(rpcContract, {
    banner: ({ threadId }) => flares.banner(threadId),
    marks: async ({ threadId }) => {
      const companion = store.companionOf(threadId);
      if (companion === null) return { companionThreadId: null, marks: {} };
      return { companionThreadId: companion, marks: Object.fromEntries(await marks.read(companion)) };
    },
    feed: ({ threadId, children }) => flares.feed(threadId, children),
    dismiss: ({ threadId, through }) => {
      flares.dismiss(threadId, through);
      return { ok: true as const };
    },
  });
  registerTools(alia, flares);
  registerCli(alia, flares);

  alia.events.on("thread.active", ({ thread }) => flares.onActive(thread));
  alia.events.on("thread.idle", ({ thread }) => flares.onIdle(thread));
  alia.events.on("thread.failed", ({ thread, error }) => flares.onFailed(thread, error));
  alia.events.on("thread.deleted", ({ thread }) => flares.onDeleted(thread));

  // Reminders and a child's flares reach an agent as a steer, and a steer that finds no running turn would start
  // one, for example after it waited in the queue behind a question. Flare's notes alone never start a turn.
  alia.experimental_hooks.on("message.dispatch", (ctx) => {
    try {
      if (startsTurnWithOnlyFlareNotes(ctx, alia.pluginId)) {
        return { action: "reject", message: "Flare dropped a background note for the agent because this thread's turn had already ended." };
      }
    } catch (error) {
      alia.log.warn(`The dispatch check failed, so the message went ahead: ${String(error)}`);
    }
    return { action: "proceed" };
  });

  alia.background.service("turns", {
    async start(signal) {
      await flares.reconcile().catch((error: unknown) => alia.log.warn(`Could not match runs to running threads: ${String(error)}`));
      while (!signal.aborted) {
        await pause(NUDGE_INTERVAL_MS, signal);
        if (signal.aborted) break;
        await flares.nudge().catch((error: unknown) => alia.log.warn(`Reminders failed: ${String(error)}`));
      }
    },
  });

  alia.background.schedule("prune", "17 3 * * *", async () => {
    const removed = await flares.prune((await settings.get()).keepDays);
    if (removed > 0) alia.log.info(`Deleted ${removed} old flares`);
  });

  alia.onDispose(() => flares.settled());
}
