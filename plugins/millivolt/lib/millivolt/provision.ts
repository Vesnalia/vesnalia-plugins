// Provisioning: find an existing millivolt, or create one, or update one.
//
// Discovery is evidence-first and bounded: Docker labels name the compose
// directory, a loopback probe names the port, and a capped filesystem scan
// catches a deployment that is on disk but not running. Nothing here guesses
// silently — every candidate carries the evidence that produced it.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compose,
  containerImageId,
  hostPortOf,
  lastLine,
  listMillivoltContainers,
  millivoltVolumes,
  runProcess,
  taggedImageId,
} from "./docker.js";

/** Ports a millivolt install is likely to answer on, most specific first. */
export const PROBE_PORTS = [8471, 8472, 8080, 8985, 8000, 8001];

/** The image listens here unless its config says otherwise. */
export const IMAGE_LISTEN_PORT = 8080;

export const MANAGED_MARKER = ".millivolt-managed";

export type DiscoveryCandidate = {
  kind: "container" | "port" | "compose-file";
  deployDir: string | null;
  port: number | null;
  containerName: string | null;
  token: string | null;
  evidence: string;
};

export type Discovery = {
  candidates: DiscoveryCandidate[];
  volumes: string[];
  scannedPorts: number[];
  scannedDirs: number;
  truncated: boolean;
};

export type InstallResult = {
  ok: boolean;
  detail: string | null;
  token: string;
  containerName: string;
  composePath: string;
  port: number;
};

export type UpdateResult = {
  changed: boolean;
  before: string | null;
  after: string | null;
  detail: string | null;
};

const COMPOSE_TEMPLATE = (
  port: number,
  containerName: string,
  projectName: string,
): string => `# Compose project "${projectName}" owns volumes ${projectName}_data and
# ${projectName}_config. Keep the project name unique per installation: two
# deployments that share a project share their history and their config.
name: ${projectName}

services:
  millivolt:
    # Self-hosted inference proxy: one OpenAI-compatible listener, one SQLite
    # history, one embedded dashboard. Pinned to the published tag so
    # \`bb millivolt update\` (or auto-update) can move it forward.
    image: ghcr.io/llm-4-people/millivolt:main
    container_name: ${containerName}
    ports:
      # Millivolt listens on :${IMAGE_LISTEN_PORT} inside the image; this publishes
      # it on the chosen host port. If you change Settings -> listen in the
      # dashboard, change this mapping to match or the port goes dark.
      - "127.0.0.1:${port}:${IMAGE_LISTEN_PORT}"
    environment:
      # Env-only by design: the credential never lands in the config volume.
      MILLIVOLT_OPERATOR_TOKEN: \${MILLIVOLT_OPERATOR_TOKEN:-}
    volumes:
      - data:/data
      - config:/config
    read_only: true
    tmpfs:
      - /tmp:rw,nosuid,nodev,noexec,size=16m
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    stop_grace_period: 30s

volumes:
  data:
  config:
`;

export function composeFor(
  port: number,
  containerName: string,
  projectName = containerName,
): string {
  return COMPOSE_TEMPLATE(port, containerName, projectName);
}

/** A long, unguessable operator credential. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function readEnv(dir: string): Promise<Record<string, string>> {
  try {
    const text = await fs.readFile(path.join(dir, ".env"), "utf8");
    const out: Record<string, string> = {};
    for (const raw of text.split(/\r?\n/u)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** True when `port` answers like millivolt: /healthz ok, and a 401 that names it. */
export async function probePort(port: number): Promise<{ ok: boolean; strong: boolean }> {
  const timeout = (ms: number) => AbortSignal.timeout(ms);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: timeout(1_500),
    });
    if (!health.ok) return { ok: false, strong: false };
    await health.arrayBuffer().catch(() => undefined);
  } catch {
    return { ok: false, strong: false };
  }
  try {
    const root = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: "manual",
      signal: timeout(1_500),
    });
    const realm = root.headers.get("www-authenticate") ?? "";
    await root.arrayBuffer().catch(() => undefined);
    return { ok: true, strong: /millivolt/iu.test(realm) };
  } catch {
    return { ok: true, strong: false };
  }
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "dist",
  "build",
  "target",
  "AppData",
  "Windows",
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
  "$Recycle.Bin",
  "System Volume Information",
  "Library",
  ".venv",
  "venv",
  "__pycache__",
]);

const COMPOSE_NAMES = new Set([
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
]);

/** Bounded, deadline-driven search for a compose file that mentions millivolt. */
export async function scanForComposeDirs(
  roots: string[],
  deadlineMs = 2_500,
  maxDirs = 400,
): Promise<{ dirs: string[]; visited: number; truncated: boolean }> {
  const deadline = Date.now() + deadlineMs;
  const queue: { dir: string; depth: number }[] = roots.map((dir) => ({ dir, depth: 0 }));
  const seen = new Set<string>();
  const dirs: string[] = [];
  let visited = 0;
  let truncated = false;
  while (queue.length > 0) {
    if (Date.now() > deadline || visited >= maxDirs || dirs.length >= 5) {
      truncated = queue.length > 0;
      break;
    }
    const next = queue.shift();
    if (next === undefined) break;
    if (seen.has(next.dir) || next.depth > 3) continue;
    seen.add(next.dir);
    let entries;
    try {
      entries = await fs.readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    visited += 1;
    for (const entry of entries) {
      if (entry.isFile() && COMPOSE_NAMES.has(entry.name.toLowerCase())) {
        try {
          const text = await fs.readFile(path.join(next.dir, entry.name), { encoding: "utf8" });
          if (/millivolt/iu.test(text.slice(0, 8_192))) dirs.push(next.dir);
        } catch {
          // unreadable compose file: not a candidate
        }
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      queue.push({ dir: path.join(next.dir, entry.name), depth: next.depth + 1 });
    }
  }
  return { dirs: [...new Set(dirs)], visited, truncated };
}

/**
 * Find millivolt: running containers first (Docker labels are authoritative),
 * then loopback ports, then compose files on disk.
 */
export async function discover(options: {
  extraPorts?: number[];
  /** Ports that are known not to be millivolt (e.g. this plugin's own proxy). */
  excludePorts?: number[];
  roots?: string[];
  deadlineMs?: number;
} = {}): Promise<Discovery> {
  const candidates: DiscoveryCandidate[] = [];
  const containers = await listMillivoltContainers();
  for (const container of containers) {
    const env = container.projectDir === null ? {} : await readEnv(container.projectDir);
    candidates.push({
      kind: "container",
      deployDir: container.projectDir,
      port: container.hostPort,
      containerName: container.name,
      token: env.MILLIVOLT_OPERATOR_TOKEN ?? null,
      evidence: `container ${container.name} (${container.state}) from ${container.image}`,
    });
  }

  const volumes = await millivoltVolumes();
  const scannedPorts: number[] = [];
  const excluded = new Set(options.excludePorts ?? []);
  const known = new Set(candidates.map((entry) => entry.port).filter((port): port is number => port !== null));
  const ports = [...new Set([...(options.extraPorts ?? []), ...PROBE_PORTS])].filter(
    (port) => !known.has(port) && !excluded.has(port),
  );
  for (const port of ports.slice(0, 8)) {
    scannedPorts.push(port);
    const probe = await probePort(port);
    if (!probe.ok) continue;
    candidates.push({
      kind: "port",
      deployDir: null,
      port,
      containerName: null,
      token: null,
      evidence: probe.strong
        ? `:${port} answered /healthz and a millivolt operator challenge`
        : `:${port} answered /healthz only`,
    });
  }

  let scannedDirs = 0;
  let truncated = false;
  if (candidates.length === 0) {
    const roots = options.roots ?? defaultRoots();
    const scan = await scanForComposeDirs(roots, options.deadlineMs ?? 2_500);
    scannedDirs = scan.visited;
    truncated = scan.truncated;
    for (const dir of scan.dirs) {
      const env = await readEnv(dir);
      const port = Number(env.MILLIVOLT_PORT ?? "");
      candidates.push({
        kind: "compose-file",
        deployDir: dir,
        port: Number.isInteger(port) && port > 0 ? port : null,
        containerName: env.MILLIVOLT_CONTAINER ?? null,
        token: env.MILLIVOLT_OPERATOR_TOKEN ?? null,
        evidence: `compose file in ${dir}`,
      });
    }
  }

  return { candidates, volumes, scannedPorts, scannedDirs, truncated };
}

/** Places a millivolt checkout or compose file usually lives, cheapest first. */
export function defaultRoots(): string[] {
  const home = os.homedir();
  const roots = [home];
  for (const name of ["dev", "docker", "projects", "code", "src", "repos", "Documents"]) {
    roots.push(path.join(home, name));
  }
  for (const drive of ["C:", "D:", "E:"]) {
    roots.push(`${drive}\\`);
  }
  return roots;
}

export async function defaultInstallDir(port: number): Promise<string> {
  const first = path.join(os.homedir(), "millivolt");
  try {
    await fs.access(path.join(first, MANAGED_MARKER));
    return first;
  } catch {
    // Either free (use it) or occupied by someone else's files (step aside).
    try {
      await fs.access(first);
      return path.join(os.homedir(), `millivolt-${port}`);
    } catch {
      return first;
    }
  }
}

/** Writes the deployment and starts it. Never overwrites a foreign compose file. */
export async function install(options: {
  dir: string;
  port: number;
  containerName: string;
  projectName?: string;
  token?: string;
  log?: (message: string) => void;
}): Promise<InstallResult> {
  const { dir, port, containerName } = options;
  const projectName = options.projectName ?? containerName;
  const token = options.token !== undefined && options.token !== "" ? options.token : generateToken();
  const composePath = path.join(dir, "compose.yaml");
  const envPath = path.join(dir, ".env");
  try {
    await fs.mkdir(dir, { recursive: true });
    const existingEnv = await readEnv(dir);
    const markerPath = path.join(dir, MANAGED_MARKER);
    let marker: string | null = null;
    try {
      marker = await fs.readFile(markerPath, "utf8");
    } catch {
      marker = null;
    }
    let wroteCompose = false;
    try {
      await fs.access(composePath);
      // A compose file we did not write: refuse rather than clobber it.
      if (marker === null) {
        return {
          ok: false,
          detail:
            `${composePath} already exists and was not created by this plugin; ` +
            "pick another directory or adopt that deployment instead",
          token,
          containerName,
          composePath,
          port,
        };
      }
    } catch {
      await fs.writeFile(composePath, composeFor(port, containerName, projectName), "utf8");
      wroteCompose = true;
    }
    if (marker === null) {
      await fs.writeFile(
        markerPath,
        `${JSON.stringify({ by: "bb-plugin-millivolt", at: new Date().toISOString() })}\n`,
        "utf8",
      );
    }
    const env = [
      "# Written by the bb millivolt plugin. The operator credential gates the",
      "# dashboard and the inference listener's operator plane.",
      `MILLIVOLT_OPERATOR_TOKEN=${token}`,
      `MILLIVOLT_PORT=${port}`,
      `MILLIVOLT_CONTAINER=${containerName}`,
      existingEnv.MILLIVOLT_IMAGE === undefined
        ? ""
        : `MILLIVOLT_IMAGE=${existingEnv.MILLIVOLT_IMAGE}`,
    ]
      .filter(Boolean)
      .join("\n");
    await fs.writeFile(envPath, `${env}\n`, "utf8");

    options.log?.(`installing millivolt in ${dir} on port ${port}`);
    const pulled = await compose(dir, ["pull", "--quiet"], 300_000);
    if (pulled.code !== 0) {
      return {
        ok: false,
        detail: lastLine(pulled.stderr) || "docker compose pull failed",
        token,
        containerName,
        composePath,
        port,
      };
    }
    const up = await compose(dir, ["up", "-d"], 180_000);
    if (up.code !== 0) {
      return {
        ok: false,
        detail: lastLine(up.stderr) || "docker compose up failed",
        token,
        containerName,
        composePath,
        port,
      };
    }
    return {
      ok: true,
      detail: wroteCompose ? null : "reused the existing managed compose file",
      token,
      containerName,
      composePath,
      port,
    };
  } catch (cause) {
    return {
      ok: false,
      detail: cause instanceof Error ? cause.message : String(cause),
      token,
      containerName,
      composePath,
      port,
    };
  }
}

/** Pulls the tag and reports whether the running container is now behind. */
export async function pullDeployment(
  dir: string,
  containerName: string,
): Promise<UpdateResult> {
  const before = await containerImageId(containerName);
  const pulled = await compose(dir, ["pull", "--quiet"], 300_000);
  if (pulled.code !== 0) {
    return {
      changed: false,
      before,
      after: before,
      detail: lastLine(pulled.stderr) || "docker compose pull failed",
    };
  }
  const after = await taggedImageId("ghcr.io/llm-4-people/millivolt:main");
  return {
    changed: before !== null && after !== null && before !== after,
    before,
    after,
    detail: null,
  };
}

/** Picks a container name that no existing container holds. */
export async function freeContainerName(preferred: string): Promise<string> {
  const listed = await runProcess("docker", ["ps", "-a", "--format", "{{.Names}}"], {
    timeoutMs: 10_000,
  });
  const taken = new Set(
    listed.code === 0 ? listed.stdout.split(/\r?\n/u).map((line) => line.trim()) : [],
  );
  if (!taken.has(preferred)) return preferred;
  for (let index = 2; index < 50; index += 1) {
    const candidate = `${preferred}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${preferred}-${Date.now()}`;
}

/**
 * A compose project name whose volumes cannot belong to someone else.
 *
 * A fresh install must never reuse an existing project's volumes: that is how a
 * second deployment would inherit another install's history and its `listen`
 * setting. A name is free when no project claims it and no volume named
 * `<name>_data` / `<name>_config` already exists.
 */
export async function freeProjectName(preferred: string): Promise<string> {
  const projects = await runProcess("docker", ["compose", "ls", "-a", "--format", "json"], {
    timeoutMs: 15_000,
  });
  const taken = new Set<string>();
  if (projects.code === 0) {
    try {
      const parsed = JSON.parse(projects.stdout) as { Name?: unknown }[];
      for (const entry of parsed) {
        if (typeof entry.Name === "string") taken.add(entry.Name.toLowerCase());
      }
    } catch {
      // Unparseable listing: fall through to the volume check.
    }
  }
  const volumes = new Set((await millivoltVolumes()).map((name) => name.toLowerCase()));
  const isFree = (name: string): boolean =>
    !taken.has(name.toLowerCase()) &&
    !volumes.has(`${name.toLowerCase()}_data`) &&
    !volumes.has(`${name.toLowerCase()}_config`);
  if (isFree(preferred)) return preferred;
  for (let index = 2; index < 50; index += 1) {
    const candidate = `${preferred}-${index}`;
    if (isFree(candidate)) return candidate;
  }
  return `${preferred}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Rollback: a previous image stays usable after a bad update.
// ---------------------------------------------------------------------------

/** Local-only tag used while a deployment is pinned to an older image. */
export const ROLLBACK_IMAGE = "ghcr.io/llm-4-people/millivolt:bb-rollback";

/** Compose override that pins the service to the rollback tag. */
export const ROLLBACK_OVERRIDE = "rollback.yaml";

export async function imageExists(ref: string): Promise<boolean> {
  const result = await runProcess("docker", ["image", "inspect", "-f", "{{.Id}}", ref], {
    timeoutMs: 10_000,
  });
  return result.code === 0 && result.stdout.trim() !== "";
}

export async function tagImage(id: string, ref: string): Promise<boolean> {
  const result = await runProcess("docker", ["tag", id, ref], { timeoutMs: 30_000 });
  return result.code === 0;
}

/**
 * Pins the deployment to `ROLLBACK_IMAGE`. `pull_policy: never` keeps compose
 * from trying to fetch a tag that only exists on this machine.
 */
export async function writeRollbackOverride(dir: string): Promise<void> {
  await fs.writeFile(
    path.join(dir, ROLLBACK_OVERRIDE),
    `# Written by the bb millivolt plugin while a rolled-back image is pinned.
# Delete this file (or run "bb millivolt resume") to track the published tag again.
services:
  millivolt:
    image: ${ROLLBACK_IMAGE}
    pull_policy: never
`,
    "utf8",
  );
}

export async function removeRollbackOverride(dir: string): Promise<void> {
  try {
    await fs.rm(path.join(dir, ROLLBACK_OVERRIDE), { force: true });
  } catch {
    // already gone
  }
}

/** Compose arguments that honour an active rollback override. */
export async function composeArgsFor(dir: string): Promise<string[]> {
  try {
    await fs.access(path.join(dir, ROLLBACK_OVERRIDE));
    return ["-f", "compose.yaml", "-f", ROLLBACK_OVERRIDE];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Diagnostics used by `repair`
// ---------------------------------------------------------------------------

/** Host port Docker publishes and the container-side port it maps to. */
export async function portMapping(
  container: string,
): Promise<{ hostPort: number; containerPort: number } | null> {
  const result = await runProcess("docker", ["port", container], { timeoutMs: 10_000 });
  if (result.code !== 0) return null;
  for (const line of result.stdout.split("\n")) {
    const match = /^(\d{2,5})\/tcp\s*->\s*(?:[\d.]+|\[[^\]]+\]):(\d{2,5})$/u.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { containerPort: Number(match[1]), hostPort: Number(match[2]) };
    }
  }
  return null;
}

/** Reads a file out of a running container without needing a shell in it. */
export async function readContainerFile(
  container: string,
  containerPath: string,
): Promise<string | null> {
  const tmp = path.join(os.tmpdir(), `bb-millivolt-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    const copied = await runProcess("docker", ["cp", `${container}:${containerPath}`, tmp], {
      timeoutMs: 20_000,
    });
    if (copied.code !== 0) return null;
    return await fs.readFile(tmp, "utf8");
  } catch {
    return null;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Writes a file back into the container (before a restart). */
export async function writeContainerFile(
  container: string,
  containerPath: string,
  content: string,
): Promise<boolean> {
  const tmp = path.join(os.tmpdir(), `bb-millivolt-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    await fs.writeFile(tmp, content, "utf8");
    const copied = await runProcess("docker", ["cp", tmp, `${container}:${containerPath}`], {
      timeoutMs: 20_000,
    });
    return copied.code === 0;
  } catch {
    return false;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** The `listen:` port in a millivolt config file, e.g. `:8080` -> 8080. */
export function listenPortOf(configText: string): number | null {
  for (const line of configText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("listen:")) continue;
    const colon = trimmed.lastIndexOf(":");
    if (colon < 0) continue;
    const value = Number(trimmed.slice(colon + 1).replace(/["'\s]/gu, ""));
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  return null;
}

/** Rewrites the `listen:` line, returning the new text (or null if absent). */
export function withListenPort(configText: string, port: number): string | null {
  const lines = configText.split("\n");
  const index = lines.findIndex((line) => line.trim().startsWith("listen:"));
  if (index < 0) return null;
  const trailing = lines[index]?.endsWith("\r") === true ? "\r" : "";
  lines[index] = `listen: "0.0.0.0:${port}"${trailing}`;
  return lines.join("\n");
}

export { hostPortOf };
