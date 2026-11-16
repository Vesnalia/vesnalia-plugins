// Docker plumbing: bounded, argv-only, never a shell.
//
// Every command here has an explicit timeout and a capped output budget so a
// hung daemon or a chatty pull cannot pin the plugin or balloon its memory.
import { spawn } from "node:child_process";

export type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const MAX_PROCESS_OUTPUT = 16 * 1024;

export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  const { cwd, timeoutMs = 60_000 } = options;
  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string =>
      current.length >= MAX_PROCESS_OUTPUT
        ? current
        : (current + chunk.toString("utf8")).slice(0, MAX_PROCESS_OUTPUT);
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error: Error) => {
      finish({ code: null, stdout, stderr: `${stderr}${error.message}`.trim(), timedOut });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

export function lastLine(text: string): string {
  const lines = text.trim().split(/\r?\n/u).filter(Boolean);
  return lines.length === 0 ? "" : (lines[lines.length - 1] ?? "").slice(0, 400);
}

export async function dockerDaemonUp(): Promise<boolean> {
  const result = await runProcess("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeoutMs: 10_000,
  });
  return result.code === 0;
}

/** Starts the desktop app out-of-band; never waits for its window. */
export function launchDockerDesktop(path: string): void {
  const child = spawn(path, [], {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  child.unref();
}

export async function waitForDaemon(timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await dockerDaemonUp()) return true;
    await sleep(2_000);
  }
  return false;
}

/** `docker compose …` in a deployment directory. */
export function compose(
  cwd: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<RunResult> {
  return runProcess("docker", ["compose", ...args], { cwd, timeoutMs });
}

export type ContainerRef = {
  name: string;
  image: string;
  projectDir: string | null;
  projectName: string | null;
  hostPort: number | null;
  state: string;
};

/** Every container whose name or image mentions millivolt. */
export async function listMillivoltContainers(): Promise<ContainerRef[]> {
  const listed = await runProcess(
    "docker",
    ["ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.State}}"],
    { timeoutMs: 15_000 },
  );
  if (listed.code !== 0) return [];
  const rows = listed.stdout
    .split(/\r?\n/u)
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 3 && /millivolt/iu.test(`${parts[0]} ${parts[1]}`));
  const refs: ContainerRef[] = [];
  for (const [name = "", image = "", state = ""] of rows.slice(0, 10)) {
    const inspected = await runProcess(
      "docker",
      [
        "inspect",
        "-f",
        '{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project"}}',
        name,
      ],
      { timeoutMs: 10_000 },
    );
    const [projectDir = "", projectName = ""] = inspected.code === 0
      ? inspected.stdout.trim().split("|")
      : ["", ""];
    refs.push({
      name,
      image,
      projectDir: projectDir === "" ? null : projectDir,
      projectName: projectName === "" ? null : projectName,
      hostPort: await hostPortOf(name),
      state,
    });
  }
  return refs;
}

/** The loopback host port Docker publishes for a container, if any. */
export async function hostPortOf(container: string): Promise<number | null> {
  const result = await runProcess("docker", ["port", container], { timeoutMs: 10_000 });
  if (result.code !== 0) return null;
  for (const line of result.stdout.split(/\r?\n/u)) {
    const match = /->\s*(?:[\d.]+|\[[^\]]+\]):(\d{2,5})\s*$/u.exec(line.trim());
    if (match?.[1] !== undefined) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
    }
  }
  return null;
}

/** The image digest a container is actually running, for update comparisons. */
export async function containerImageId(container: string): Promise<string | null> {
  const result = await runProcess("docker", ["inspect", "-f", "{{.Image}}", container], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) return null;
  const id = result.stdout.trim();
  return id === "" ? null : id;
}

/** The image id the local tag now points at, after a pull. */
export async function taggedImageId(image: string): Promise<string | null> {
  const result = await runProcess("docker", ["image", "inspect", "-f", "{{.Id}}", image], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) return null;
  const id = result.stdout.trim();
  return id === "" ? null : id;
}

/** Names of volumes Docker knows about whose name mentions millivolt. */
export async function millivoltVolumes(): Promise<string[]> {
  const result = await runProcess("docker", ["volume", "ls", "--format", "{{.Name}}"], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /millivolt/iu.test(line))
    .slice(0, 10);
}
