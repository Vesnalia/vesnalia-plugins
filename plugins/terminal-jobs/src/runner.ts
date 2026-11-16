import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACT_SCHEMA_VERSION,
  LAUNCH_ARTIFACT_FIELDS,
  OUTCOME_ARTIFACT_FIELDS,
} from "./artifacts.js";

const CONTROL = /[\0-\x1f\x7f]/u;

export class RunnerUsageError extends Error {}

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  let index = 0;
  while (index < argv.length && argv[index] !== "--") {
    const name = argv[index++]!;
    if (!["--job-id", "--owner-thread", "--artifact-root"].includes(name)) {
      throw new RunnerUsageError(`unknown option: ${name}`);
    }
    if (index >= argv.length) throw new RunnerUsageError(`missing value for ${name}`);
    if (values.has(name)) throw new RunnerUsageError(`duplicate option: ${name}`);
    values.set(name, argv[index++]!);
  }
  if (argv[index] !== "--") throw new RunnerUsageError("command arguments must follow --");
  const command = argv.slice(index + 1);
  if (command.length === 0) throw new RunnerUsageError("missing command after --");
  for (const name of ["--job-id", "--owner-thread", "--artifact-root"]) {
    if (!values.has(name)) throw new RunnerUsageError(`missing ${name}`);
  }
  return {
    jobId: values.get("--job-id")!,
    ownerThreadId: values.get("--owner-thread")!,
    artifactRoot: values.get("--artifact-root")!,
    argv: command,
  };
}

function assertSafeMarker(name: string, value: string): void {
  if (!value || value.length > 512 || CONTROL.test(value)) {
    throw new RunnerUsageError(`invalid ${name}`);
  }
}

function writeAll(fd: number, buffer: Uint8Array): void {
  let offset = 0;
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset);
}

function atomicJson(filePath: string, value: Record<string, unknown>, fields: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !keys.includes(field))) {
    throw new Error(`internal artifact schema mismatch for ${path.basename(filePath)}`);
  }
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    writeAll(fd, Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filePath);
  const directoryFd = fs.openSync(path.dirname(filePath), "r");
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
}

function commandEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function forwardToGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function runTerminalJobRunner(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  assertSafeMarker("job ID", args.jobId);
  if (!/^job_[A-Za-z0-9_-]+$/u.test(args.jobId)) throw new RunnerUsageError("invalid job ID");
  assertSafeMarker("owner thread", args.ownerThreadId);
  if (
    args.artifactRoot.length > 4_096 ||
    !path.posix.isAbsolute(args.artifactRoot) ||
    CONTROL.test(args.artifactRoot)
  ) {
    throw new RunnerUsageError("--artifact-root must be an absolute POSIX path");
  }

  const jobDirectory = path.posix.join(args.artifactRoot, args.jobId);
  const launchPath = path.posix.join(jobDirectory, "launch.json");
  const logPath = path.posix.join(jobDirectory, "output.log");
  const outcomePath = path.posix.join(jobDirectory, "outcome.json");
  fs.mkdirSync(jobDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(jobDirectory, 0o700);
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const terminalId = process.env.ALIA_TERMINAL_SESSION_ID || null;

  atomicJson(
    launchPath,
    {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      jobId: args.jobId,
      terminalId,
      ownerThreadId: args.ownerThreadId,
      argv: args.argv,
      startedAt,
      artifactRoot: args.artifactRoot,
      jobDirectory,
      launchPath,
      logPath,
      outcomePath,
    },
    LAUNCH_ARTIFACT_FIELDS,
  );
  const logFd = fs.openSync(logPath, "a", 0o600);
  fs.fchmodSync(logFd, 0o600);

  let child: ChildProcess;
  try {
    child = spawn("/bin/sh", ["-c", 'exec "$@" 2>&1', "terminal-job-child", ...args.argv], {
      stdio: ["ignore", "pipe", "inherit"],
      env: commandEnvironment(),
      detached: true,
    });
  } catch (error) {
    const text = Buffer.from(`terminal-job-runner: launch failed: ${String(error)}\n`);
    writeAll(logFd, text);
    process.stdout.write(text);
    fs.fsyncSync(logFd);
    fs.closeSync(logFd);
    const finishedMs = Date.now();
    atomicJson(
      outcomePath,
      {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        jobId: args.jobId,
        terminalId,
        ownerThreadId: args.ownerThreadId,
        commandExitCode: null,
        signal: null,
        status: 127,
        result: "launch-failed",
        startedAt,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: finishedMs - startedMs,
        logPath,
      },
      OUTCOME_ARTIFACT_FIELDS,
    );
    return 127;
  }

  let spawnError: Error | null = null;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    writeAll(logFd, chunk);
    process.stdout.write(chunk);
  });

  let forwardedSignal: NodeJS.Signals | null = null;
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      if (forwardToGroup(child, signal)) forwardedSignal = signal;
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  const settled = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  if (spawnError !== null) {
    const text = Buffer.from(`terminal-job-runner: launch failed: ${String(spawnError)}\n`);
    writeAll(logFd, text);
    process.stdout.write(text);
  }
  fs.fsyncSync(logFd);
  fs.closeSync(logFd);

  let commandExitCode = settled.code;
  let signal = settled.signal ?? forwardedSignal;
  let result: "success" | "failure" | "signaled" | "launch-failed";
  let status: number;
  if (spawnError !== null) {
    commandExitCode = null;
    signal = null;
    status = 127;
    result = "launch-failed";
  } else if (signal !== null) {
    status = 128 + (os.constants.signals[signal] || 0);
    result = "signaled";
  } else {
    status = commandExitCode ?? 1;
    result = status === 0 ? "success" : "failure";
  }
  const finishedMs = Date.now();
  atomicJson(
    outcomePath,
    {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      jobId: args.jobId,
      terminalId,
      ownerThreadId: args.ownerThreadId,
      commandExitCode,
      signal,
      status,
      result,
      startedAt,
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: finishedMs - startedMs,
      logPath,
    },
    OUTCOME_ARTIFACT_FIELDS,
  );
  return status;
}
