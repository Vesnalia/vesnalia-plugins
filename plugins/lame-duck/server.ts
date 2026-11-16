import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { lameDuckContract, type LameDuckStatus } from "./contract.js";

export default async function lameDuckPlugin(alia: AliaPluginApi): Promise<void> {
  const stored = await alia.storage.kv.get<unknown>("paused");
  let paused =
    stored === undefined || stored === null ? false : z.boolean().parse(stored);
  let saving = Promise.resolve();

  async function status(): Promise<LameDuckStatus> {
    await saving;
    const [running, held] = await Promise.all([
      alia.sdk.threads.listRunning(),
      alia.sdk.threads.queue.list({ waitHolder: "plugin:lame-duck" }),
    ]);
    return {
      paused,
      heldCount: held.length,
      runningCount: running.length,
      drained: paused && running.length === 0,
    };
  }

  async function setPaused(next: boolean): Promise<LameDuckStatus> {
    const write = saving.then(async () => {
      await alia.storage.kv.set("paused", next);
      paused = next;
    });
    saving = write.catch(() => {});
    await write;
    alia.realtime.publish("status-changed", {});
    if (!next) await alia.experimental_hooks.recheck("message.dispatch");
    return status();
  }

  alia.experimental_hooks.on("message.dispatch", async () => {
    await saving;
    return paused
      ? {
          action: "wait",
          reason: "Lame duck mode: sends paused until resumed",
        }
      : { action: "proceed" };
  });

  alia.rpc.register(lameDuckContract, {
    status,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  });

  alia.cli.register({
    name: "lame-duck",
    summary: "Pause sends, drain running threads, and resume queued work",
    commands: [
      {
        name: "status",
        summary: "Show whether sends are paused and threads have drained",
        usage: "alia lame-duck status [--json]",
      },
      {
        name: "pause",
        summary: "Persistently pause sends while running turns finish",
        usage: "alia lame-duck pause [--json]",
      },
      {
        name: "resume",
        summary: "Resume sends and recheck queued work",
        usage: "alia lame-duck resume [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...extra] = argv.filter((arg) => arg !== "--json");
      if (
        extra.length > 0 ||
        !["status", "pause", "resume"].includes(command ?? "")
      ) {
        return {
          exitCode: 1,
          stderr: "Usage: VesnALIA lame-duck <status|pause|resume> [--json]",
        };
      }
      const view =
        command === "pause"
          ? await setPaused(true)
          : command === "resume"
            ? await setPaused(false)
            : await status();
      return {
        exitCode: 0,
        stdout: json
          ? JSON.stringify(view)
          : `${view.paused ? "Sends paused" : "Sends enabled"}. ${view.runningCount} running threads. ${view.heldCount} sends held.${view.drained ? " Drained; ready for server maintenance." : ""}`,
      };
    },
  });

  for (const event of [
    "message.queued",
    "message.dispatched",
    "message.cancelled",
    "thread.active",
    "thread.idle",
    "thread.failed",
    "thread.archived",
    "thread.deleted",
  ] as const) {
    alia.events.on(event, () => {
      alia.realtime.publish("status-changed", {});
    });
  }
}
