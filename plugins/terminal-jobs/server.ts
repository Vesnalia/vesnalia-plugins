import { randomUUID } from "node:crypto";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { TerminalJobCli } from "./src/cli.js";
import { createServiceLoop, TerminalJobService } from "./src/service.js";
import { terminalJobHostContract } from "./src/host-contract.js";
import { JobStore } from "./src/store.js";

function createWakeSignal() {
  let wakeCurrent: (() => void) | null = null;
  return {
    wake() {
      wakeCurrent?.();
    },
    wait(delayMs: number, signal: AbortSignal): Promise<void> {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          if (wakeCurrent === finish) wakeCurrent = null;
          resolve();
        };
        const timer = setTimeout(finish, delayMs);
        wakeCurrent = finish;
        signal.addEventListener("abort", finish, { once: true });
      });
    },
  };
}

export default function terminalJobsPlugin(alia: AliaPluginApi): void {
  const store = JobStore.open(alia);
  const service = new TerminalJobService(alia, store);
  const wakeSignal = createWakeSignal();
  const generationToken = `generation_${randomUUID()}`;
  const runnerHost = alia.hosts.experimental_client({ contract: terminalJobHostContract });
  const cli = new TerminalJobCli(
    alia,
    store,
    () => wakeSignal.wake(),
    runnerHost,
    generationToken,
  );

  alia.cli.register({
    name: "terminal-job",
    summary: "Run and inspect durable terminal jobs.",
    commands: [
      {
        name: "run",
        summary: "Run a command in a durable VesnALIA terminal.",
        usage:
          "alia terminal-job run --title TITLE [scope] --artifact-root PATH [--delivery queue|steer] [--json] -- COMMAND [ARG...]",
      },
      {
        name: "watch",
        summary: "Register an existing terminal without recovering scrollback.",
        usage:
          "alia terminal-job watch TERMINAL_ID --notify-thread THREAD --log PATH [--delivery queue|steer] [--json]",
      },
      {
        name: "show",
        summary: "Show durable job status without command arguments.",
        usage: "alia terminal-job show JOB_ID [--json]",
      },
      {
        name: "list",
        summary: "List recent terminal jobs without command arguments.",
        usage: "alia terminal-job list [--limit N] [--json]",
      },
      {
        name: "prune",
        summary: "Preview or delete old settled job data.",
        usage:
          "alia terminal-job prune --older-than-days N [--limit N] [--delete] [--json]",
      },
      {
        name: "retry-notification",
        summary: "Retry an abandoned or waiting completion notice.",
        usage: "alia terminal-job retry-notification JOB_ID [--json]",
      },
    ],
    run(argv, ctx) {
      return cli.run(argv, ctx);
    },
  });

  alia.background.service("reconciler", {
    start: createServiceLoop(service, store, (delay, signal) => wakeSignal.wait(delay, signal)),
  });

  alia.log.info("Terminal jobs loaded");
}
