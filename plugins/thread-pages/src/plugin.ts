// The composition root: settings → kv sweep → provider → serving → core → CLI (DESIGN §A). The only file that
// imports everything.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { registerCli } from "./cli.ts";
import { mountPages, type MountPages, type PagesServer } from "./core.ts";
import { sweepForeignKv } from "./migrate.ts";
import { createAliaProvider, type AliaProvider } from "./provider/index.ts";
import { createAliaServingHost } from "./serving/index.ts";
import { defineSettings, type LiveSettings } from "./settings.ts";

/** The host's spelling of the five command roles (04 §Command roles; DESIGN §B.6, DR-23): `alia pages <role>`; and `{root}`, the page's folder, which on VesnALIA is the thread's storage (04 §The text, U54). */
export const COMMANDS = { init: "alia pages init", guide: "alia pages guide", status: "alia pages status", home: "alia pages home", grants: "alia pages grants", root: "your thread storage, `$ALIA_THREAD_STORAGE`" } as const;

export interface PluginOptions {
  /** The core's `mountPages` (tests inject a fake). */
  mount?: MountPages;
  now?: () => number;
}

export interface Plugin {
  server: PagesServer;
  provider: AliaProvider;
  settings: LiveSettings;
}

export async function createPlugin(alia: AliaPluginApi, options: PluginOptions = {}): Promise<Plugin> {
  const settings = await defineSettings(alia);
  await sweepForeignKv(alia, alia.log, options.now); // 1.9 → 1.10: the old plugin's rows go before the core opens its stores (DESIGN §E)
  const provider = createAliaProvider(alia, {
    instructionEnabled: () => settings.current().agentInstructions,
    ...(options.now ? { now: options.now } : {}),
  });
  const serving = createAliaServingHost(alia);
  const server = await (options.mount ?? mountPages)(serving, provider.provider, {
    settings: () => settings.pages(),
    commands: { ...COMMANDS },
    routeStrategy: "exact",
    ...(options.now ? { now: options.now } : {}),
  });
  registerCli(alia, { handlers: provider.handlers, log: alia.log });
  const reinject = () => {
    server.reinject().catch((error: unknown) => alia.log.warn(`instruction: reinject failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  settings.onChange(reinject);
  alia.events.on("thread.deleted", async ({ thread }) => {
    provider.forget(thread.id);
    await server.forgetSession(thread.id); // DR-8: storage, grants, offline copy go with the session
  });
  alia.onDispose(() => server.close());
  // VesnALIA says `plugins-changed` after its startup load pass and every plugin install, update, enable, disable, reload and
  // remove: a contributor that starts, stops or changes after the mount reaches the instruction at once. Released
  // before the server closes (dispose hooks run last-in first-out).
  const unsubscribe = alia.sdk.subscribe({
    event: "system:changed",
    callback: (event) => {
      if (event.changes.includes("plugins-changed")) reinject();
    },
  });
  alia.onDispose(unsubscribe);
  return { server, provider, settings };
}
