// alia-plugin-meetings — a Fireflies-style notetaker for Zoom.
//
// This server entry keeps the meeting registry (SQLite), serves the Meetings
// page (RPC, realtime, HTTP audio/screenshots/downloads), the `alia meetings`
// CLI and the agent tools, and runs the scheduler that starts bots, follows
// them and notifies threads. The bots themselves run on the primary machine
// as detached processes managed by the host entry (host.ts); see
// docs/dev/DESIGN.md.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { hostContract } from "./src/shared/contract.js";
import { CHANNEL_BOT_CHANGED, CHANNEL_GOOGLE_CHANGED } from "./src/shared/rpc-contract.js";
import { registerCli } from "./src/server/cli.js";
import { Repository, openDatabase } from "./src/server/db.js";
import { registerHttp } from "./src/server/http.js";
import { registerRpc } from "./src/server/rpc.js";
import { MeetingsService, type ServiceOptions } from "./src/server/service.js";
import { defineSettings } from "./src/server/settings.js";
import { registerTools } from "./src/server/tools.js";
import { registerAgentTransports } from "./src/server/mcp.js";

export type { RpcContract } from "./src/shared/rpc-contract.js";

export interface PluginOptions extends ServiceOptions {
  /** Tests: receive the service to drive the scheduler deterministically. */
  readonly onService?: (service: MeetingsService) => void;
}

/** The plugin factory; options exist for tests (clock, polling, ICS fetching, Google endpoints). */
export function createMeetingsPlugin(options: PluginOptions = {}) {
  return async function plugin(alia: AliaPluginApi): Promise<void> {
    const settings = defineSettings(alia);
    const repo = new Repository(openDatabase(alia));
    const host = alia.hosts.experimental_client({ contract: hostContract });
    const service = new MeetingsService(alia, settings, repo, host, options);
    options.onService?.(service);

    registerRpc(alia, service);
    registerHttp(alia, service);
    registerAgentTransports(alia, service, service.notetaker.tokens);
    registerCli(alia, service);
    registerTools(alia, service);

    settings.onChange((next, prev) => {
      service.wake();
      // Auto-join, filter and feed changes apply to already scheduled calendar bots right away.
      service.calendar.settingsChanged(next, prev);
      if (next.botName !== prev.botName || next.showAvatar !== prev.showAvatar) alia.realtime.publish(CHANNEL_BOT_CHANGED, {});
      if (next.googleClientId !== prev.googleClientId || next.googleClientSecret !== prev.googleClientSecret) {
        service.google.settingsChanged(next, prev);
        alia.realtime.publish(CHANNEL_GOOGLE_CHANGED, {});
      }
    });
    const offWorkerExit = host.experimental_onWorkerExit(() => service.wake());
    alia.onDispose(() => {
      offWorkerExit();
      service.dispose();
    });

    // Starts due meetings, follows running ones (2 s while active, 15 s idle),
    // reconciles everything once on load and syncs calendars.
    alia.background.service("scheduler", { start: (signal) => service.runScheduler(signal) });
    alia.background.service("completion-recovery", {
      start: async (signal) => {
        while (!signal.aborted) {
          await service.notetaker.resumeDeliveries();
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, 60_000);
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
        }
      },
    });
  };
}

export default createMeetingsPlugin();
