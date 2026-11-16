import { fileURLToPath } from "node:url";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import {
  RUNNER_ARGUMENT,
  RUNNER_PROTOCOL_VERSION,
  terminalJobHostContract,
} from "./src/host-contract.js";
import { RunnerUsageError, runTerminalJobRunner } from "./src/runner.js";

const hostEntry = experimental_defineHostEntry({
  contract: terminalJobHostContract,
  handlers: {
    "runner.readiness": () => ({
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      supported: process.platform !== "win32",
      execPath: process.execPath,
      artifactPath: fileURLToPath(import.meta.url),
      nodeVersion: process.version,
      platform: process.platform,
    }),
  },
});

if (process.argv[2] === RUNNER_ARGUMENT) {
  void runTerminalJobRunner(process.argv.slice(3))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      process.stderr.write(
        `terminal-job-runner: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = error instanceof RunnerUsageError ? 64 : 70;
    });
}

export default hostEntry;
