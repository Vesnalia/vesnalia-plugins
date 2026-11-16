import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { decodeLaunchArtifact, decodeOutcomeArtifact } from "../src/artifacts.js";
import { runnerCommand } from "../src/cli.js";
import { RUNNER_ARGUMENT } from "../src/host-contract.js";

const runner = path.resolve(import.meta.dirname, "../dist/host.js");
const runnerPrefix = [runner, RUNNER_ARGUMENT];
const temporary: string[] = [];
const processGroups: number[] = [];

async function root(prefix = "terminal-job-runner-") {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

function paths(artifactRoot: string, jobId: string) {
  const directory = path.join(artifactRoot, jobId);
  return {
    directory,
    launch: path.join(directory, "launch.json"),
    log: path.join(directory, "output.log"),
    outcome: path.join(directory, "outcome.json"),
  };
}

function runnerArguments(artifactRoot: string, jobId: string, command: string[]) {
  return [
    ...runnerPrefix,
    "--job-id",
    jobId,
    "--owner-thread",
    "thr_owner",
    "--artifact-root",
    artifactRoot,
    "--",
    ...command,
  ];
}

function run(artifactRoot: string, jobId: string, command: string[]) {
  return spawnSync(process.execPath, runnerArguments(artifactRoot, jobId, command), {
    encoding: "utf8",
    env: { ...process.env, BB_TERMINAL_SESSION_ID: "term_fixture" },
  });
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitStopped(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && running(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(running(pid)).toBe(false);
}

afterEach(async () => {
  for (const group of processGroups.splice(0)) {
    try {
      process.kill(-group, "SIGKILL");
    } catch {}
  }
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bundled terminal-job runner", () => {
  it.each([0, 2])("preserves combined output and exact status for exit %i", async (exitCode) => {
    const artifactRoot = await root();
    const jobId = `job_exit_${exitCode}`;
    const result = run(artifactRoot, jobId, [
      process.execPath,
      "-e",
      `process.stdout.write('one\\n'); process.stderr.write('two\\n'); process.exit(${exitCode})`,
    ]);
    const files = paths(artifactRoot, jobId);

    expect(result.status).toBe(exitCode);
    expect(result.stdout).toBe("one\ntwo\n");
    expect(readFileSync(files.log, "utf8")).toBe(result.stdout);
    expect(decodeLaunchArtifact(readFileSync(files.launch, "utf8"))).toMatchObject({
      jobId,
      terminalId: "term_fixture",
      ownerThreadId: "thr_owner",
    });
    expect(decodeOutcomeArtifact(readFileSync(files.outcome, "utf8"))).toMatchObject({
      jobId,
      terminalId: "term_fixture",
      commandExitCode: exitCode,
      signal: null,
      status: exitCode,
      result: exitCode === 0 ? "success" : "failure",
    });
    await expect((await import("node:fs/promises")).stat(files.directory).then((item) => item.mode & 0o777)).resolves.toBe(0o700);
    for (const file of [files.launch, files.log, files.outcome]) {
      await expect((await import("node:fs/promises")).stat(file).then((item) => item.mode & 0o777)).resolves.toBe(0o600);
    }
  });

  it("records an absent terminal environment as unknown without invalidating success", async () => {
    const artifactRoot = await root();
    const jobId = "job_no_terminal_env";
    const env = { ...process.env };
    delete env.BB_TERMINAL_SESSION_ID;
    const result = spawnSync(process.execPath, runnerArguments(artifactRoot, jobId, ["true"]), {
      encoding: "utf8",
      env,
    });
    expect(result.status).toBe(0);
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, jobId).outcome, "utf8"))).toMatchObject({
      terminalId: null,
      result: "success",
      status: 0,
    });
  });

  it("passes hostile argv unchanged without evaluation", async () => {
    const artifactRoot = await root();
    const argv = ["space value", "", "雪", "quote'\"", "line\nbreak", "*", "$(touch NEVER)", "; echo bad"];
    const result = run(artifactRoot, "job_argv", [
      process.execPath,
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      ...argv,
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(argv);
    expect(existsSync(path.join(artifactRoot, "NEVER"))).toBe(false);
  });

  it("records a child signal and a signal forwarded to the process group", async () => {
    const artifactRoot = await root();
    const childSignal = run(artifactRoot, "job_child_signal", [
      "/bin/sh",
      "-c",
      "printf partial; kill -TERM $$",
    ]);
    expect(childSignal.status).toBe(143);
    expect(readFileSync(paths(artifactRoot, "job_child_signal").log, "utf8")).toBe("partial");
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, "job_child_signal").outcome, "utf8"))).toMatchObject({
      commandExitCode: null,
      signal: "SIGTERM",
      status: 143,
      result: "signaled",
    });

    const pidFile = path.join(artifactRoot, "pids");
    const jobId = "job_forwarded_signal";
    const child = spawn(
      process.execPath,
      runnerArguments(artifactRoot, jobId, [
        "/bin/sh",
        "-c",
        `sleep 60 & echo "$$ $!" > ${JSON.stringify(pidFile)}; printf ready; wait`,
      ]),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    const [parentPid, grandchildPid] = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
    child.kill("SIGTERM");
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).toBe(143);
    await waitStopped(parentPid!);
    await waitStopped(grandchildPid!);
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, jobId).outcome, "utf8"))).toMatchObject({
      signal: "SIGTERM",
      status: 143,
      result: "signaled",
    });
  });

  it("preserves normal exit when a signal arrives after child exit but before stdio close", async () => {
    const artifactRoot = await root();
    const jobId = "job_post_exit_signal";
    const child = spawn(
      process.execPath,
      runnerArguments(artifactRoot, jobId, ["/bin/sh", "-c", "(sleep 0.5) & printf exited"]),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.kill("SIGTERM");
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).toBe(0);
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, jobId).outcome, "utf8"))).toMatchObject({
      commandExitCode: 0,
      signal: null,
      status: 0,
      result: "success",
    });
  });

  it("leaves partial output without a false outcome after forced runner loss", async () => {
    const artifactRoot = await root();
    const jobId = "job_forced_loss";
    const pidFile = path.join(artifactRoot, "forced-pid");
    const child = spawn(
      process.execPath,
      runnerArguments(artifactRoot, jobId, [
        "/bin/sh",
        "-c",
        `echo $$ > ${JSON.stringify(pidFile)}; printf partial; sleep 60`,
      ]),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    const group = Number(readFileSync(pidFile, "utf8").trim());
    processGroups.push(group);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(readFileSync(paths(artifactRoot, jobId).log, "utf8")).toBe("partial");
    expect(existsSync(paths(artifactRoot, jobId).outcome)).toBe(false);
    expect(running(group)).toBe(true);
  });

  it("runs the generated shell command with exact argv and clears the Electron flag", async () => {
    const artifactRoot = await root();
    const capture = path.join(artifactRoot, "capture.cjs");
    writeFileSync(
      capture,
      "process.stdout.write(JSON.stringify({argv:process.argv.slice(2),electron:process.env.ELECTRON_RUN_AS_NODE ?? null})); process.exit(6)",
    );
    const argv = [process.execPath, capture, "", "a b", "'", "$(false)", "line\nbreak"];
    const command = runnerCommand(
      { execPath: process.execPath, artifactPath: runner },
      { jobId: "job_shell", ownerThreadId: "thr_owner", artifactRoot, argv },
    );
    const result = spawnSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, BB_TERMINAL_SESSION_ID: "term_shell" },
    });

    expect(result.status).toBe(6);
    expect(JSON.parse(result.stdout)).toEqual({ argv: argv.slice(2), electron: null });
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, "job_shell").outcome, "utf8")).status).toBe(6);
  });

  it("accepts the private runner token only as the first artifact argument", async () => {
    const artifactRoot = await root();
    const result = spawnSync(
      process.execPath,
      [runner, "not-runner", RUNNER_ARGUMENT, "--job-id", "job_hidden", "--artifact-root", artifactRoot],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(existsSync(path.join(artifactRoot, "job_hidden"))).toBe(false);
  });
});
