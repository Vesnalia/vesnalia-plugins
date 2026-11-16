// alia-plugin-millivolt — backend entry.
//
// The plugin owns millivolt end to end:
//   1. find an existing install (Docker labels, loopback probe, bounded disk
//      scan) or create one from scratch, token included;
//   2. keep it running with VesnALIA (start on load, health check, bounded restarts);
//   3. keep it current (pull on VesnALIA start and on an interval, but never under a
//      stream that is in flight);
//   4. expose typed, bounded reads of millivolt's metrics API to the sidebar;
//   5. serve the real dashboard inside VesnALIA through a loopback proxy that injects
//      the operator credential, so no browser tab and no token entry is needed.
//
// The operator token never reaches the frontend: it lives in a secret setting
// or the plugin's own storage and is used only by this process.
import { createServer, request as httpRequest, type Server } from "node:http";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import {
  compose,
  containerImageId,
  dockerDaemonUp,
  lastLine,
  launchDockerDesktop,
  listMillivoltContainers,
  runProcess,
  waitForDaemon,
} from "./lib/millivolt/docker.js";
import {
  ROLLBACK_IMAGE,
  composeArgsFor,
  listenPortOf,
  portMapping,
  readContainerFile,
  withListenPort,
  writeContainerFile,
  defaultInstallDir,
  discover,
  freeContainerName,
  freeProjectName,
  generateToken,
  imageExists,
  install,
  probePort,
  pullDeployment,
  readEnv,
  removeRollbackOverride,
  tagImage,
  writeRollbackOverride,
} from "./lib/millivolt/provision.js";

// millivolt now embeds `model_canon` (plus per-request response headers) in
// every metrics payload: /metrics/bootstrap is ~310 KB and a 200-row
// /metrics/agg/log page is ~500 KB, so the old 512 KB ceiling truncated the
// body mid-JSON and surfaced as "millivolt returned malformed JSON".
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const HEALTH_TIMEOUT_MS = 3_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const STATUS_CHANNEL = "millivolt-status";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

async function readCapped(response: Response, limit: number): Promise<string> {
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (total >= limit) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return text.slice(0, limit);
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True when a URL or Origin value names this machine's loopback interface. */
function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      LOOPBACK_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wire schemas
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  state: z.enum(["unknown", "starting", "running", "stopped", "error"]),
  healthy: z.boolean(),
  desiredRunning: z.boolean(),
  installed: z.boolean(),
  managed: z.enum(["installed", "adopted"]).nullable(),
  deployDir: z.string().nullable(),
  containerName: z.string().nullable(),
  autoUpdate: z.boolean(),
  lastUpdateCheck: z.string().nullable(),
  lastUpdateResult: z.string().nullable(),
  detail: z.string().nullable(),
  port: z.number().int(),
  embedUrl: z.string().nullable(),
  checkedAt: z.string(),
  /** Short ids, for display. */
  previousImage: z.string().nullable(),
  rolledBackTo: z.string().nullable(),
  canRevert: z.boolean(),
  repairReport: z.string().nullable(),
});

const candidateSchema = z.object({
  kind: z.enum(["container", "port", "compose-file"]),
  deployDir: z.string().nullable(),
  port: z.number().int().nullable(),
  containerName: z.string().nullable(),
  hasToken: z.boolean(),
  evidence: z.string(),
});

const discoverySchema = z.object({
  candidates: z.array(candidateSchema),
  volumes: z.array(z.string()),
  scannedPorts: z.array(z.number().int()),
  scannedDirs: z.number().int(),
  truncated: z.boolean(),
});

const overviewSchema = z.object({
  kpi: z.object({
    requests: z.number(),
    errors: z.number(),
    inFlight: z.number(),
    cost: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    reasoningTokens: z.number(),
    avgTtftMs: z.number().nullable(),
    avgTps: z.number().nullable(),
  }),
  storage: z.object({
    enabled: z.boolean(),
    dropped: z.number(),
    totalsDegraded: z.boolean(),
  }),
  pause: z.object({ paused: z.boolean(), queued: z.number() }),
  throttle: z.object({ active: z.number() }),
  debug: z.object({ enabled: z.boolean() }),
  dashboardVersion: z.string(),
});

const requestRowSchema = z.object({
  id: z.string(),
  start: z.string(),
  status: z.number(),
  provider: z.string(),
  model: z.string(),
  client: z.string(),
  stream: z.boolean(),
  durationMs: z.number(),
  ttftMs: z.number().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  retries: z.number(),
  errorType: z.string().nullable(),
});

const requestPageSchema = z.object({
  rows: z.array(requestRowSchema),
  more: z.boolean(),
  cursorMs: z.number().nullable(),
  cursorId: z.string().nullable(),
});

const updateResultSchema = z.object({
  changed: z.boolean(),
  detail: z.string().nullable(),
  checkedAt: z.string(),
});

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  overview: { input: z.null(), output: overviewSchema },
  requests: {
    input: z.object({
      limit: z.number().int().min(10).max(200).default(50),
      beforeMs: z.number().int().optional(),
      beforeId: z.string().optional(),
    }),
    output: requestPageSchema,
  },
  control: {
    input: z.object({
      action: z.enum([
        "start",
        "stop",
        "restart",
        "update",
        "revert",
        "resume",
        "repair",
      ]),
    }),
    output: statusSchema,
  },
  discover: { input: z.null(), output: discoverySchema },
  setup: {
    input: z.object({
      dir: z.string().optional(),
      port: z.number().int().min(1).max(65_535).optional(),
      token: z.string().optional(),
      adopt: z.boolean().default(false),
    }),
    output: statusSchema,
  },
  update: { input: z.null(), output: updateResultSchema },
});

export type MillivoltStatus = z.infer<typeof statusSchema>;
export type MillivoltOverview = z.infer<typeof overviewSchema>;
export type MillivoltRequestRow = z.infer<typeof requestRowSchema>;
export type MillivoltRequestPage = z.infer<typeof requestPageSchema>;
export type MillivoltCandidate = z.infer<typeof candidateSchema>;
export type MillivoltDiscovery = z.infer<typeof discoverySchema>;
export type MillivoltUpdateResult = z.infer<typeof updateResultSchema>;

// ---------------------------------------------------------------------------
// Tolerant readers for millivolt's JSON (numbers may arrive as null).
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** JSON.parse without the throw: a malformed body is a null, not a crash. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Persisted installation state (settings stay read-only overrides).
// ---------------------------------------------------------------------------

type PersistedState = {
  deployDir: string | null;
  port: number | null;
  containerName: string | null;
  token: string | null;
  managed: "installed" | "adopted" | null;
  installedAt: string | null;
  lastUpdateCheck: string | null;
  lastUpdateResult: string | null;
  /** Image the running container was started from, and the one before it. */
  imageId: string | null;
  previousImageId: string | null;
  /** Set while the deployment is pinned to the previous image. */
  rolledBackTo: string | null;
};

const EMPTY_STATE: PersistedState = {
  deployDir: null,
  port: null,
  containerName: null,
  token: null,
  managed: null,
  installedAt: null,
  lastUpdateCheck: null,
  lastUpdateResult: null,
  imageId: null,
  previousImageId: null,
  rolledBackTo: null,
};

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  const settings = alia.settings.define({
    deployDir: {
      type: "string",
      label: "Compose directory (blank = auto)",
      default: "",
      experimental_schema: z.string(),
    },
    port: {
      type: "number",
      label: "Host port (0 = auto)",
      default: 0,
      experimental_schema: z.number().int().min(0).max(65_535),
    },
    embedPort: {
      type: "number",
      label: "In-alia dashboard proxy port",
      default: 8472,
      experimental_schema: z.number().int().min(1).max(65_535),
    },
    operatorToken: {
      type: "string",
      label: "Operator token (blank = auto)",
      secret: true,
      default: "",
    },
    autoStart: { type: "boolean", label: "Start millivolt with VesnALIA", default: true },
    autoUpdate: {
      type: "boolean",
      label: "Pull updates when VesnALIA starts",
      default: true,
    },
    startDockerDesktop: {
      type: "boolean",
      label: "Launch Docker Desktop when the daemon is down",
      default: true,
    },
    dockerDesktopPath: {
      type: "string",
      label: "Docker Desktop executable",
      default: "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
    },
  });

  const config = await settings.get();
  let state: PersistedState = {
    ...EMPTY_STATE,
    ...((await alia.storage.kv.get<PersistedState>("state")) ?? {}),
  };
  const saveState = async (patch: Partial<PersistedState>): Promise<void> => {
    state = { ...state, ...patch };
    await alia.storage.kv.set("state", state);
  };

  // Settings win when set; otherwise the recorded install wins.
  let deployDir = config.deployDir.trim() !== "" ? config.deployDir.trim() : state.deployDir;
  let port =
    config.port > 0 ? config.port : (state.port ?? (deployDir === null ? 0 : 8471));
  let containerName = state.containerName ?? "millivolt";
  // Token precedence: the secret setting, then the deployment's own .env (so
  // rotating the credential there takes effect on reload), then our record.
  let operatorToken = config.operatorToken.trim();
  if (operatorToken === "") {
    const envToken =
      deployDir === null ? "" : ((await readEnv(deployDir)).MILLIVOLT_OPERATOR_TOKEN ?? "");
    operatorToken = envToken !== "" ? envToken : (state.token ?? "");
  }

  const baseUrl = (): string => `http://127.0.0.1:${port}`;
  const composeCwd = (): string => deployDir ?? "";
  /** Compose in the deployment dir, honouring an active rollback override. */
  async function composeHere(args: string[], timeoutMs = 120_000) {
    const dir = composeCwd();
    const prefix = dir === "" ? [] : await composeArgsFor(dir);
    return compose(dir, [...prefix, ...args], timeoutMs);
  }
  const configuredDeployDir = config.deployDir.trim();

  let desiredRunning =
    (await alia.storage.kv.get<boolean>("desired-running")) ?? config.autoStart;
  let restartAttempts = 0;
  let updateRunning = false;

  let runtime: MillivoltStatus = {
    state: "unknown",
    healthy: false,
    desiredRunning,
    installed: deployDir !== null,
    managed: state.managed ?? (deployDir === null ? null : "adopted"),
    deployDir: deployDir,
    containerName: state.containerName,
    autoUpdate: config.autoUpdate,
    lastUpdateCheck: state.lastUpdateCheck,
    lastUpdateResult: state.lastUpdateResult,
    detail: null,
    port: port,
    embedUrl: null,
    checkedAt: new Date().toISOString(),
    previousImage: null,
    rolledBackTo: null,
    canRevert: false,
    repairReport: null,
  };

  function publishState(patch: Partial<MillivoltStatus>): MillivoltStatus {
    runtime = { ...runtime, ...patch, checkedAt: new Date().toISOString() };
    alia.realtime.publish(STATUS_CHANNEL, runtime);
    return runtime;
  }

  const shortId = (id: string | null): string | null =>
    id === null ? null : id.replace(/^sha256:/u, "").slice(0, 12);

  const refreshRuntimeFromState = (): void => {
    runtime = {
      ...runtime,
      installed: deployDir !== null,
      managed: state.managed ?? (deployDir === null ? null : "adopted"),
      deployDir,
      containerName: state.containerName ?? containerName,
      lastUpdateCheck: state.lastUpdateCheck,
      lastUpdateResult: state.lastUpdateResult,
      previousImage: shortId(state.previousImageId),
      rolledBackTo: shortId(state.rolledBackTo),
      port,
    };
  };

  // -------------------------------------------------------------------------
  // millivolt HTTP access (operator credential stays here)
  // -------------------------------------------------------------------------

  async function operatorFetch(
    path: string,
    init: { method?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<{ ok: boolean; status: number; text: string }> {
    if (operatorToken === "") {
      return { ok: false, status: 0, text: "operator token is not configured" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
    try {
      const response = await fetch(`${baseUrl()}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${operatorToken}`,
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const text = await readCapped(response, MAX_RESPONSE_BYTES);
      return { ok: response.ok, status: response.status, text };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { ok: false, status: 0, text: message };
    } finally {
      clearTimeout(timer);
    }
  }

  async function health(targetPort = port): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(`http://127.0.0.1:${targetPort}/healthz`, {
        signal: controller.signal,
      });
      await response.arrayBuffer().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Container lifecycle
  // -------------------------------------------------------------------------

  async function ensureDaemon(): Promise<boolean> {
    if (await dockerDaemonUp()) return true;
    if (!config.startDockerDesktop) return false;
    launchDockerDesktop(config.dockerDesktopPath);
    alia.log.info("launching Docker Desktop");
    return waitForDaemon(120_000, sleep);
  }

  /**
   * Polls /healthz on the port the caller means, which is not always the
   * module-level `port` yet: an install probes the port it just chose, before
   * that choice is committed.
   */
  async function waitHealthy(timeoutMs: number, targetPort = port): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await health(targetPort)) return true;
      await sleep(1_000);
    }
    return false;
  }

  async function startMillivolt(): Promise<MillivoltStatus> {
    if (deployDir === null) {
      return publishState({
        state: "error",
        healthy: false,
        installed: false,
        detail: "millivolt is not installed yet",
      });
    }
    publishState({ state: "starting", detail: null });
    if (!(await ensureDaemon())) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "Docker daemon is not running",
      });
    }
    const up = await composeHere(["up", "-d"], 180_000);
    if (up.code !== 0) {
      return publishState({
        state: "error",
        healthy: false,
        detail: lastLine(up.stderr || up.stdout) || "docker compose up failed",
      });
    }
    if (await waitHealthy(90_000)) {
      restartAttempts = 0;
      refreshRuntimeFromState();
      return publishState({ state: "running", healthy: true, detail: null, desiredRunning: true });
    }
    const published = await runProcess("docker", ["port", containerName], { timeoutMs: 10_000 });
    const mapping = published.code === 0 ? lastLine(published.stdout) : "";
    return publishState({
      state: "error",
      healthy: false,
      detail:
        `container started but ${baseUrl()}/healthz did not answer` +
        (mapping === "" ? "" : ` (docker publishes ${mapping})`) +
        "; millivolt's Settings → listen must equal the configured port",
    });
  }

  async function stopMillivolt(): Promise<MillivoltStatus> {
    const stopped =
      deployDir === null
        ? { code: 0, stderr: "" }
        : await composeHere(["stop"], 120_000);
    return publishState({
      state: stopped.code === 0 ? "stopped" : "error",
      healthy: false,
      desiredRunning: false,
      detail: stopped.code === 0 ? null : lastLine(stopped.stderr),
    });
  }

  async function restartMillivolt(): Promise<MillivoltStatus> {
    if (deployDir === null) return startMillivolt();
    publishState({ state: "starting", detail: null });
    const restarted = await composeHere(["restart"], 120_000);
    if (restarted.code !== 0) {
      return publishState({
        state: "error",
        healthy: false,
        detail: lastLine(restarted.stderr) || "compose restart failed",
      });
    }
    if (await waitHealthy(90_000)) {
      return publishState({
        state: "running",
        healthy: true,
        detail: null,
        desiredRunning: true,
      });
    }
    return publishState({
      state: "error",
      healthy: false,
      detail: "container restarted but /healthz did not answer",
    });
  }

  async function refreshStatus(): Promise<MillivoltStatus> {
    const canRevert =
      state.previousImageId !== null &&
      state.previousImageId !== state.imageId &&
      state.rolledBackTo === null &&
      (await imageExists(state.previousImageId));
    if (await health()) {
      refreshRuntimeFromState();
      return publishState({ state: "running", healthy: true, detail: null, canRevert });
    }
    return publishState({
      state: runtime.state === "starting" ? "starting" : "stopped",
      healthy: false,
      installed: deployDir !== null,
    });
  }

  // -------------------------------------------------------------------------
  // Adoption and installation
  // -------------------------------------------------------------------------

  function applyInstall(target: {
    dir: string;
    port: number;
    containerName: string;
    token: string;
    managed: "installed" | "adopted";
  }): void {
    deployDir = target.dir;
    port = target.port;
    containerName = target.containerName;
    operatorToken = target.token;
    refreshRuntimeFromState();
  }

  async function adopt(dir: string, adoptedPort: number, token: string | null): Promise<MillivoltStatus> {
    const env = await readEnv(dir);
    const resolvedToken = token ?? env.MILLIVOLT_OPERATOR_TOKEN ?? operatorToken;
    const name = env.MILLIVOLT_CONTAINER ?? (await containerForDir(dir)) ?? "millivolt";
    await saveState({
      deployDir: dir,
      port: adoptedPort,
      containerName: name,
      token: resolvedToken === "" ? null : resolvedToken,
      managed: "adopted",
      installedAt: new Date().toISOString(),
    });
    applyInstall({ dir, port: adoptedPort, containerName: name, token: resolvedToken, managed: "adopted" });
    // Adopting a running instance should not bounce it.
    const probe = await probePort(adoptedPort);
    if (probe.ok) {
      return publishState({ state: "running", healthy: true, detail: null, desiredRunning: true });
    }
    return startMillivolt();
  }

  async function containerForDir(dir: string): Promise<string | null> {
    const containers = await listMillivoltContainers();
    const match = containers.find(
      (entry) => entry.projectDir !== null && entry.projectDir.toLowerCase() === dir.toLowerCase(),
    );
    return match?.name ?? null;
  }

  async function installFresh(preferredDir?: string, preferredPort?: number): Promise<MillivoltStatus> {
    const chosenPort = preferredPort ?? (port > 0 ? port : 8471);
    const chosenDir = preferredDir ?? (await defaultInstallDir(chosenPort));
    // Project name == container name keeps volumes unique per installation, so
    // a second deployment cannot inherit the first one's history or config.
    const name = await freeContainerName("millivolt");
    // The project name is what scopes the data volumes, so it must be free even
    // when the container name happens to be: a stopped older install still owns
    // its volumes.
    const projectName = await freeProjectName(name);
    const token = generateToken();
    publishState({ state: "starting", detail: `installing into ${chosenDir}` });
    if (!(await ensureDaemon())) {
      return publishState({
        state: "error",
        healthy: false,
        installed: false,
        detail: "Docker daemon is not running, so millivolt cannot be installed",
      });
    }
    const result = await install({
      dir: chosenDir,
      port: chosenPort,
      containerName: name,
      projectName,
      token,
      log: (message) => alia.log.info(message),
    });
    if (!result.ok) {
      return publishState({
        state: "error",
        healthy: false,
        installed: deployDir !== null,
        detail: result.detail,
      });
    }
    // State is committed only once the deployment answers, so a broken install
    // never locks the plugin onto a directory that does not work.
    if (!(await waitHealthy(90_000, chosenPort))) {
      return publishState({
        state: "error",
        healthy: false,
        installed: deployDir !== null,
        detail:
          `installed into ${chosenDir} on port ${chosenPort}, but /healthz did not ` +
          `answer. Check "docker compose logs" there, then adopt it once healthy.`,
      });
    }
    await saveState({
      deployDir: chosenDir,
      port: chosenPort,
      containerName: name,
      token,
      managed: "installed",
      installedAt: new Date().toISOString(),
      lastUpdateCheck: new Date().toISOString(),
      lastUpdateResult: "installed",
    });
    applyInstall({ dir: chosenDir, port: chosenPort, containerName: name, token, managed: "installed" });
    return publishState({ state: "running", healthy: true, detail: null, desiredRunning: true });
  }

  /**
   * Brings millivolt up without asking: adopt what already exists, otherwise
   * install. Only runs when nothing has been configured or adopted yet.
   */
  async function ensureReady(): Promise<MillivoltStatus> {
    if (deployDir !== null) return startMillivolt();
    publishState({ state: "starting", detail: "looking for an existing millivolt" });
    const found = await discover({ excludePorts: [config.embedPort] });
    const usable = found.candidates.find(
      (entry) => entry.deployDir !== null && entry.port !== null,
    );
    if (usable?.deployDir !== null && usable?.deployDir !== undefined && usable.port !== null) {
      alia.log.info(`adopting millivolt at ${usable.deployDir} (:${usable.port})`);
      return adopt(usable.deployDir, usable.port, usable.token);
    }
    const onPort = found.candidates.find((entry) => entry.port !== null && entry.token !== null);
    if (onPort?.port !== undefined && onPort.port !== null && configuredDeployDir === "") {
      // Millivolt answers on a port but we could not find its directory: adopt
      // the port with the discovered token and leave the deployment alone.
      await saveState({
        deployDir: null,
        port: onPort.port,
        containerName: null,
        token: onPort.token,
        managed: "adopted",
        installedAt: new Date().toISOString(),
      });
      applyInstall({
        dir: "",
        port: onPort.port,
        containerName: "millivolt",
        token: onPort.token ?? "",
        managed: "adopted",
      });
      deployDir = null;
      refreshRuntimeFromState();
      if (await probePort(onPort.port).then((probe) => probe.ok)) {
        return publishState({ state: "running", healthy: true, detail: null });
      }
    }
    return installFresh();
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  async function runUpdate(trigger: "startup" | "manual"): Promise<MillivoltUpdateResult> {
    const checkedAt = new Date().toISOString();
    if (deployDir === null) {
      return { changed: false, detail: "millivolt is not installed", checkedAt };
    }
    if (state.rolledBackTo !== null) {
      return {
        changed: false,
        detail: 'updates paused while rolled back; run "resume" to track the tag again',
        checkedAt,
      };
    }
    if (updateRunning) return { changed: false, detail: "an update is already running", checkedAt };
    if (trigger === "startup") {
      const busy = await operatorFetch("/metrics/bootstrap");
      if (busy.ok) {
        const snapshot = parseJsonObject(busy.text);
        const inFlight = num(record(snapshot?.counters).in_flight);
        if (inFlight > 0) {
          await saveState({ lastUpdateCheck: checkedAt, lastUpdateResult: "skipped: requests in flight" });
          refreshRuntimeFromState();
          publishState({});
          return { changed: false, detail: "skipped: requests in flight", checkedAt };
        }
      }
    }
    updateRunning = true;
    publishState({ lastUpdateCheck: checkedAt, lastUpdateResult: "checking" });
    try {
      const pulled = await pullDeployment(composeCwd(), containerName);
      if (pulled.detail !== null) {
        await saveState({ lastUpdateCheck: checkedAt, lastUpdateResult: pulled.detail });
        refreshRuntimeFromState();
        publishState({});
        return { changed: false, detail: pulled.detail, checkedAt };
      }
      if (!pulled.changed) {
        await saveState({ lastUpdateCheck: checkedAt, lastUpdateResult: "up to date" });
        refreshRuntimeFromState();
        publishState({});
        return { changed: false, detail: null, checkedAt };
      }
      alia.log.info("new millivolt image; recreating the container");
      const up = await composeHere(["up", "-d"], 180_000);
      if (up.code !== 0) {
        const detail = lastLine(up.stderr) || "docker compose up failed";
        await saveState({ lastUpdateCheck: checkedAt, lastUpdateResult: detail });
        refreshRuntimeFromState();
        publishState({});
        return { changed: true, detail, checkedAt };
      }
      const healthy = await waitHealthy(90_000);
      const detail = healthy ? "updated" : "updated, but /healthz did not answer";
      await saveState({
        lastUpdateCheck: checkedAt,
        lastUpdateResult: detail,
        // The image we just left is the revert target.
        previousImageId: pulled.before ?? state.previousImageId,
        imageId: pulled.after ?? state.imageId,
      });
      refreshRuntimeFromState();
      publishState({ healthy, state: healthy ? "running" : "error", detail: healthy ? null : detail });
      return { changed: true, detail: healthy ? null : detail, checkedAt };
    } finally {
      updateRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // Repair: what a stuck deployment usually needs, in one action
  // -------------------------------------------------------------------------

  /**
   * Diagnoses the failures seen in practice and fixes the ones that are safe to
   * fix without asking: a vanished rollback pin, a `listen` port that drifted
   * from the published mapping (the container reports healthy while the host
   * port goes nowhere), a stopped container, and a supervisor that gave up.
   * When the fixed deployment still will not answer, it falls back to the
   * previous image if one is available.
   */
  async function repairMillivolt(): Promise<MillivoltStatus> {
    if (deployDir === null) {
      return publishState({
        state: "error",
        healthy: false,
        repairReport: "millivolt is not installed; run setup first",
        detail: "millivolt is not installed",
      });
    }
    const steps: string[] = [];
    const wasHealthy = await health();
    publishState({ state: "starting", detail: null, repairReport: "diagnosing" });

    if (!(await ensureDaemon())) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "Docker daemon is not running",
        repairReport: "Docker daemon is not running and would not start",
      });
    }

    // A pin whose image is gone makes every `compose up` fail.
    if (state.rolledBackTo !== null && !(await imageExists(ROLLBACK_IMAGE))) {
      await removeRollbackOverride(composeCwd());
      await saveState({ rolledBackTo: null });
      steps.push("removed a rollback pin whose image was deleted");
    }

    // The classic silent failure: the container serves a different port than
    // the one Docker publishes, so its own healthcheck disagrees with the host.
    const mapping = await portMapping(containerName);
    if (mapping !== null) {
      const configText = await readContainerFile(containerName, "/config/proxy.yaml");
      const listen = configText === null ? null : listenPortOf(configText);
      if (configText !== null && listen !== null && listen !== mapping.containerPort) {
        const next = withListenPort(configText, mapping.containerPort);
        if (
          next !== null &&
          (await writeContainerFile(containerName, "/config/proxy.yaml", next))
        ) {
          steps.push(`set listen ${listen} to the published ${mapping.containerPort}`);
          await composeHere(["restart"], 120_000);
        } else {
          steps.push(`could not rewrite listen ${listen} to ${mapping.containerPort}`);
        }
      }
    }

    const up = await composeHere(["up", "-d"], 180_000);
    if (up.code !== 0) {
      return publishState({
        state: "error",
        healthy: false,
        detail: lastLine(up.stderr || up.stdout) || "docker compose up failed",
        repairReport: steps.join("; "),
      });
    }

    if (!(await waitHealthy(90_000, port))) {
      const fallback = state.previousImageId;
      if (
        fallback !== null &&
        fallback !== state.imageId &&
        (await imageExists(fallback))
      ) {
        steps.push("still not answering, so reverting to the previous image");
        desiredRunning = true;
        restartAttempts = 0;
        await alia.storage.kv.set("desired-running", true);
        const reverted = await revertMillivolt();
        return publishState({
          state: reverted.state,
          healthy: reverted.healthy,
          detail: reverted.detail,
          repairReport: steps.join("; "),
          desiredRunning: true,
        });
      }
      return publishState({
        state: "error",
        healthy: false,
        detail: `still not answering on ${baseUrl()}/healthz`,
        repairReport:
          steps.length === 0
            ? "nothing to fix automatically: check \"docker compose logs\" in the deployment directory"
            : steps.join("; "),
      });
    }

    // Healthy again: clear the supervisor's give-up state.
    desiredRunning = true;
    restartAttempts = 0;
    await alia.storage.kv.set("desired-running", true);

    if (steps.length === 0 && !wasHealthy) steps.push("started the deployment");
    const authed = await operatorFetch("/metrics/bootstrap");
    if (authed.status === 401) {
      steps.push("the operator token is rejected; set it in Settings");
    }
    refreshRuntimeFromState();
    alia.log.info(`repair: ${steps.join("; ") || "nothing to change"}`);
    return publishState({
      state: "running",
      healthy: true,
      detail: null,
      desiredRunning: true,
      repairReport: steps.join("; ") || "nothing needed changing",
    });
  }

  // -------------------------------------------------------------------------
  // Rollback: keep the previous image usable after a bad update
  // -------------------------------------------------------------------------

  /**
   * Records image drift: if the running container was started from an image we
   * did not record (an update made outside the plugin, or a restore), keep the
   * recorded one as the revert target.
   */
  async function reconcileImageHistory(): Promise<void> {
    if (deployDir === null) return;
    const running = await containerImageId(containerName);
    if (running === null || running === state.imageId) return;
    const previous = state.imageId;
    await saveState({
      imageId: running,
      previousImageId:
        previous !== null && previous !== running ? previous : state.previousImageId,
    });
    refreshRuntimeFromState();
  }

  async function revertMillivolt(): Promise<MillivoltStatus> {
    if (deployDir === null) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "millivolt is not installed",
      });
    }
    const target = state.previousImageId;
    if (target === null) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "no previous image is recorded yet; there is nothing to revert to",
      });
    }
    if (!(await imageExists(target))) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "the previous image is no longer on this machine (it was pruned)",
      });
    }
    const current = await containerImageId(containerName);
    if (current !== null && current === target) {
      return publishState({
        state: runtime.healthy ? "running" : runtime.state,
        healthy: runtime.healthy,
        detail: "the previous image is already the one running; nothing to revert",
        canRevert: false,
      });
    }
    if (!(await tagImage(target, ROLLBACK_IMAGE))) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "could not tag the previous image",
      });
    }
    await writeRollbackOverride(composeCwd());
    publishState({ state: "starting", detail: "reverting to the previous image" });
    const up = await composeHere(["up", "-d"], 180_000);
    if (up.code !== 0) {
      return publishState({
        state: "error",
        healthy: false,
        detail: lastLine(up.stderr) || "docker compose up failed during revert",
      });
    }
    if (!(await waitHealthy(90_000, port))) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "reverted, but /healthz did not answer",
      });
    }
    await saveState({
      rolledBackTo: target,
      imageId: target,
      previousImageId: current ?? state.imageId,
    });
    alia.log.info(`reverted to ${shortId(target) ?? "previous image"}`);
    refreshRuntimeFromState();
    return publishState({
      state: "running",
      healthy: true,
      detail: null,
      desiredRunning: true,
      canRevert: false,
      lastUpdateResult: "rolled back",
      lastUpdateCheck: new Date().toISOString(),
    });
  }

  async function resumeMillivolt(): Promise<MillivoltStatus> {
    if (deployDir === null) return startMillivolt();
    await removeRollbackOverride(composeCwd());
    publishState({ state: "starting", detail: "resuming the published tag" });
    const pulled = await composeHere(["pull", "--quiet"], 300_000);
    if (pulled.code !== 0) {
      return publishState({
        state: "error",
        healthy: false,
        detail: lastLine(pulled.stderr) || "docker compose pull failed",
      });
    }
    const up = await composeHere(["up", "-d"], 180_000);
    if (up.code !== 0) {
      return publishState({
        state: "error",
        healthy: false,
        detail: lastLine(up.stderr) || "docker compose up failed",
      });
    }
    if (!(await waitHealthy(90_000, port))) {
      return publishState({
        state: "error",
        healthy: false,
        detail: "resumed, but /healthz did not answer",
      });
    }
    const after = await containerImageId(containerName);
    const runningNow = after ?? state.imageId;
    const rolledBackFrom = state.rolledBackTo;
    await saveState({
      rolledBackTo: null,
      imageId: runningNow,
      previousImageId:
        rolledBackFrom !== null && rolledBackFrom !== runningNow
          ? rolledBackFrom
          : state.previousImageId,
      lastUpdateCheck: new Date().toISOString(),
      lastUpdateResult: "up to date",
    });
    refreshRuntimeFromState();
    return publishState({ state: "running", healthy: true, detail: null, desiredRunning: true });
  }

  // -------------------------------------------------------------------------
  // RPC surface for the VesnALIA frontend
  // -------------------------------------------------------------------------

  async function readOverview(): Promise<MillivoltOverview> {
    const response = await operatorFetch("/metrics/bootstrap");
    if (!response.ok) {
      throw new Error(
        response.status === 0
          ? `millivolt unreachable: ${response.text}`
          : `millivolt returned ${response.status}`,
      );
    }
    const body = parseJsonObject(response.text);
    if (body === null) throw new Error("millivolt returned malformed JSON");
    const kpi = record(body.kpi);
    const storage = record(body.storage);
    const pause = record(body.pause);
    const throttle = record(body.throttle);
    const debug = record(body.debug);
    const throttles = Array.isArray(throttle.throttles) ? throttle.throttles : [];
    return {
      kpi: {
        requests: num(kpi.requests),
        errors: num(kpi.errors),
        inFlight: num(kpi.in_flight),
        cost: num(kpi.cost),
        inputTokens: num(kpi.input_tokens),
        outputTokens: num(kpi.output_tokens),
        cacheReadTokens: num(kpi.cache_read_tokens),
        reasoningTokens: num(kpi.reasoning_tokens),
        avgTtftMs: numOrNull(kpi.avg_ttft_ms),
        avgTps: numOrNull(kpi.avg_tps),
      },
      storage: {
        enabled: bool(storage.enabled),
        dropped: num(storage.dropped),
        totalsDegraded: bool(storage.totals_degraded),
      },
      pause: { paused: bool(pause.paused), queued: num(pause.queued) },
      throttle: { active: throttles.length },
      debug: { enabled: bool(debug.enabled) },
      dashboardVersion: str(body.dashboard_version),
    };
  }

  async function readRequests(input: {
    limit: number;
    beforeMs?: number;
    beforeId?: string;
  }): Promise<MillivoltRequestPage> {
    const parts = [`limit=${input.limit}`];
    if (input.beforeMs !== undefined && input.beforeId !== undefined) {
      parts.push(
        `before_ms=${input.beforeMs}`,
        `before_id=${encodeURIComponent(input.beforeId)}`,
      );
    }
    const response = await operatorFetch(`/metrics/agg/log?${parts.join("&")}`);
    if (!response.ok) {
      throw new Error(
        response.status === 0
          ? `millivolt unreachable: ${response.text}`
          : `millivolt returned ${response.status}: ${response.text.slice(0, 200)}`,
      );
    }
    const body = parseJsonObject(response.text);
    if (body === null) throw new Error("millivolt returned malformed JSON");
    const records = Array.isArray(body.records) ? body.records : [];
    return {
      rows: records.slice(0, 200).map((entry) => {
        const row = record(entry);
        const usage = record(row.usage);
        return {
          id: str(row.id),
          start: str(row.start),
          status: num(row.status_code),
          provider: str(row.provider),
          model: str(row.model),
          client: str(row.client),
          stream: bool(row.stream),
          durationMs: num(row.duration_ms ?? row.processing_ms),
          ttftMs: numOrNull(row.ttft_ms),
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
          retries: num(row.retries),
          errorType:
            typeof row.error_type === "string" && row.error_type !== ""
              ? row.error_type
              : null,
        };
      }),
      more: bool(body.more),
      cursorMs: numOrNull(body.cursor_ms),
      cursorId: typeof body.cursor_id === "string" ? body.cursor_id : null,
    };
  }

  alia.rpc.register(rpcContract, {
    status: async () => refreshStatus(),
    overview: () => readOverview(),
    requests: (input) => readRequests(input),
    control: async ({ action }) => {
      if (action === "stop") {
        desiredRunning = false;
        await alia.storage.kv.set("desired-running", false);
        return stopMillivolt();
      }
      desiredRunning = true;
      await alia.storage.kv.set("desired-running", true);
      if (action === "update") {
        await runUpdate("manual");
        return refreshStatus();
      }
      if (action === "revert") return revertMillivolt();
      if (action === "resume") return resumeMillivolt();
      if (action === "repair") return repairMillivolt();
      return action === "restart" ? restartMillivolt() : startMillivolt();
    },
    discover: async () => {
      const found = await discover({
        extraPorts: port > 0 ? [port] : [],
        excludePorts: [config.embedPort],
      });
      return {
        candidates: found.candidates.map((entry) => ({
          kind: entry.kind,
          deployDir: entry.deployDir,
          port: entry.port,
          containerName: entry.containerName,
          hasToken: entry.token !== null && entry.token !== "",
          evidence: entry.evidence,
        })),
        volumes: found.volumes,
        scannedPorts: found.scannedPorts,
        scannedDirs: found.scannedDirs,
        truncated: found.truncated,
      };
    },
    setup: async ({ dir, port: wantedPort, token, adopt: shouldAdopt }) => {
      if (shouldAdopt) {
        if (dir === undefined || wantedPort === undefined) {
          return publishState({
            state: "error",
            healthy: false,
            detail: "adopting needs a directory and a port",
          });
        }
        return adopt(dir, wantedPort, token ?? null);
      }
      return installFresh(dir, wantedPort);
    },
    update: () => runUpdate("manual"),
  });

  // -------------------------------------------------------------------------
  // In-alia dashboard: loopback proxy that injects the operator credential.
  //
  // millivolt answers `frame-ancestors 'none'`, so the dashboard cannot be
  // framed directly; proxying from a second loopback port also means the page's
  // relative /metrics, /dash and /admin requests all carry the credential
  // without the token ever entering the webview.
  // -------------------------------------------------------------------------

  let embedServer: Server | null = null;
  let embedPort: number | null = null;

  const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "origin",
    "referer",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
  ]);

  const STRIPPED_RESPONSE_HEADERS = new Set([
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    // millivolt serves `Referrer-Policy: no-referrer` on its document. The
    // browser then strips the Referer from every subresource the framed page
    // loads, which used to be this proxy's only trust signal for those
    // requests. Dropping the header falls back to the browser default
    // (strict-origin-when-cross-origin), so a same-origin asset or API call
    // keeps a loopback Referer; the gate no longer depends on it either way.
    "referrer-policy",
    "host",
  ]);

  function proxyRequest(
    clientRequest: import("node:http").IncomingMessage,
    clientResponse: import("node:http").ServerResponse,
  ): void {
    const forwarded: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(clientRequest.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name)) continue;
      forwarded[name] = value;
    }
    forwarded.host = `127.0.0.1:${port}`;
    forwarded.authorization = `Bearer ${operatorToken}`;
    forwarded["accept-encoding"] = "identity";

    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: clientRequest.method ?? "GET",
        path: clientRequest.url ?? "/",
        headers: forwarded,
      },
      (upstreamResponse) => {
        const headers: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value === undefined) continue;
          if (STRIPPED_RESPONSE_HEADERS.has(name)) continue;
          headers[name] = value;
        }
        clientResponse.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          headers,
        );
        upstreamResponse.pipe(clientResponse);
      },
    );
    upstream.on("error", (error: Error) => {
      if (clientResponse.headersSent) {
        clientResponse.destroy();
        return;
      }
      clientResponse.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      clientResponse.end(`millivolt proxy error: ${error.message}`);
    });
    clientRequest.on("aborted", () => upstream.destroy());
    clientRequest.pipe(upstream);
  }

  function startEmbedProxy(): Server | null {
    if (operatorToken === "") {
      alia.log.warn("operator token not set; the in-alia dashboard stays disabled");
      return null;
    }
    const server = createServer((request, response) => {
      const host = request.headers.host ?? "";
      if (host !== `127.0.0.1:${embedPort}` && host !== `localhost:${embedPort}`) {
        response.writeHead(403, { "content-type": "text/plain" });
        response.end("forbidden host");
        return;
      }
      // The VesnALIA page that frames this proxy is loopback, so a loopback
      // Origin/Referer is the trust signal that survives a cross-site iframe
      // (Sec-Fetch-Site reports "cross-site" for it). Anything arriving from a
      // real website is refused, even though it carries no credential of its
      // own — this listener adds one.
      //
      // millivolt used to omit `Referrer-Policy`, so every subresource the
      // framed dashboard loaded carried `Referer: http://127.0.0.1:8472/…`
      // and landed in the first branch. It now sends `no-referrer`, the
      // browser drops the Referer on those requests, and they arrive with
      // only `Sec-Fetch-Site: same-origin` — the page is asking this proxy
      // for something it is allowed to ask for, so that has to be trusted
      // too. Only the document itself is cross-site, and its absence of
      // Referer is already the case the last branch accepts.
      const referer = request.headers.referer ?? request.headers.origin;
      const sameSite = request.headers["sec-fetch-site"] === "same-origin";
      if (referer !== undefined && !isLoopbackUrl(referer)) {
        response.writeHead(403, { "content-type": "text/plain" });
        response.end("forbidden origin");
        return;
      }
      if (referer === undefined) {
        if (sameSite) {
          // Same-origin subresource or API call from the framed page.
        } else if (
          request.headers["sec-fetch-dest"] !== undefined &&
          request.headers["sec-fetch-dest"] !== "document"
        ) {
          response.writeHead(403, { "content-type": "text/plain" });
          response.end("forbidden origin");
          return;
        }
      }
      proxyRequest(request, response);
    });
    server.on("error", (error: Error) => {
      alia.log.error(`dashboard proxy failed: ${error.message}`);
      embedPort = null;
      runtime.embedUrl = null;
    });
    server.listen(config.embedPort, "127.0.0.1", () => {
      embedPort = config.embedPort;
      runtime.embedUrl = `http://127.0.0.1:${config.embedPort}/`;
      alia.log.info(`dashboard proxy on ${runtime.embedUrl}`);
      alia.realtime.publish(STATUS_CHANNEL, runtime);
    });
    return server;
  }

  function disposeEmbedProxy(): void {
    if (embedServer === null) return;
    embedServer.close();
    embedServer.closeAllConnections?.();
    embedServer = null;
    embedPort = null;
    runtime.embedUrl = null;
  }
  alia.onDispose(() => {
    disposeEmbedProxy();
    alia.log.info("disposed");
  });

  // -------------------------------------------------------------------------
  // Startup + supervision: VesnALIA loads, millivolt exists, runs, stays current.
  // -------------------------------------------------------------------------

  alia.background.service("supervisor", {
    async start(signal) {
      embedServer = startEmbedProxy();
      signal.addEventListener("abort", disposeEmbedProxy, { once: true });
      if (desiredRunning) {
        await ensureReady();
        await reconcileImageHistory();
        if (config.autoUpdate && runtime.state === "running") {
          await runUpdate("startup");
        }
      } else {
        await refreshStatus();
      }
      let lastUpdate = Date.now();
      while (!signal.aborted) {
        await sleep(20_000, signal);
        if (signal.aborted) break;
        if (await health()) {
          if (!runtime.healthy) publishState({ state: "running", healthy: true });
        } else {
          publishState({ healthy: false, state: "stopped" });
          if (desiredRunning) {
            await sleep(5_000, signal);
            if (signal.aborted) break;
            if (!(await health())) {
              if (restartAttempts >= 3) {
                publishState({
                  state: "error",
                  detail: "millivolt stayed down after three restart attempts",
                });
                desiredRunning = false;
                await alia.storage.kv.set("desired-running", false);
              } else {
                restartAttempts += 1;
                alia.log.warn(`millivolt unhealthy; restart attempt ${restartAttempts}`);
                await startMillivolt();
              }
            }
          }
        }
        if (
          config.autoUpdate &&
          desiredRunning &&
          Date.now() - lastUpdate > UPDATE_INTERVAL_MS
        ) {
          lastUpdate = Date.now();
          await runUpdate("startup");
        }
      }
    },
  });

  // -------------------------------------------------------------------------
  // `alia millivolt …` for shells and agents.
  // -------------------------------------------------------------------------

  const usage = [
    "Usage:",
    "  VesnALIA millivolt status [--json]",
    "  VesnALIA millivolt setup [--dir PATH] [--port N] [--json]",
    "  VesnALIA millivolt setup --adopt --dir PATH --port N [--token T]",
    "  VesnALIA millivolt discover [--json]",
    "  VesnALIA millivolt update [--json]",
    "  VesnALIA millivolt repair [--json]   # diagnose and fix a stuck deployment",
    "  VesnALIA millivolt revert [--json]   # pin the previous image",
    "  VesnALIA millivolt resume [--json]   # track the published tag again",
    "  VesnALIA millivolt start | stop | restart",
    "  VesnALIA millivolt url",
    "  VesnALIA millivolt requests [count] [--json]",
  ].join("\n");

  alia.cli.register({
    name: "millivolt",
    summary: "Install, update, and inspect the millivolt inference proxy",
    commands: [
      { name: "status", summary: "Show install, container and traffic state", usage: "alia millivolt status [--json]" },
      { name: "setup", summary: "Install millivolt, or adopt an existing one", usage: "alia millivolt setup [--dir PATH] [--port N] [--adopt]" },
      { name: "discover", summary: "Find existing millivolt installs", usage: "alia millivolt discover [--json]" },
      { name: "update", summary: "Pull the newest image and recreate if it changed", usage: "alia millivolt update [--json]" },
      { name: "repair", summary: "Diagnose and fix a deployment that will not answer", usage: "alia millivolt repair [--json]" },
      { name: "revert", summary: "Pin the previous image after a bad update", usage: "alia millivolt revert [--json]" },
      { name: "resume", summary: "Stop pinning and track the published image again", usage: "alia millivolt resume [--json]" },
      { name: "start", summary: "Start the container", usage: "alia millivolt start" },
      { name: "stop", summary: "Stop the container", usage: "alia millivolt stop" },
      { name: "restart", summary: "Restart the container", usage: "alia millivolt restart" },
      { name: "url", summary: "Print the dashboard URL", usage: "alia millivolt url" },
      { name: "requests", summary: "Show recent proxied requests", usage: "alia millivolt requests [count] [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const flag = (name: string): string | undefined => {
        const index = argv.indexOf(`--${name}`);
        return index >= 0 ? argv[index + 1] : undefined;
      };
      const [command, ...args] = argv.filter(
        (arg) =>
          arg !== "--json" &&
          arg !== "--dir" &&
          arg !== "--port" &&
          arg !== flag("dir") &&
          arg !== flag("port"),
      );
      switch (command) {
        case undefined:
        case "help":
          return { exitCode: 0, stdout: usage };
        case "status": {
          const status = await refreshStatus();
          let overview: MillivoltOverview | null = null;
          try {
            overview = await readOverview();
          } catch {
            overview = null;
          }
          if (json) return { exitCode: 0, stdout: JSON.stringify({ status, overview }) };
          const lines = [
            `state:    ${status.state}${status.healthy ? " (healthy)" : ""}`,
            `installed: ${status.installed ? `yes (${status.managed ?? "unknown"})` : "no"}`,
            `directory: ${status.deployDir ?? "—"}`,
            `port:     ${status.port}`,
            `update:   ${status.lastUpdateResult ?? "not checked"}${
              status.lastUpdateCheck === null ? "" : ` @ ${status.lastUpdateCheck}`
            }`,
          ];
          if (status.detail !== null) lines.push(`detail:   ${status.detail}`);
          if (overview !== null) {
            lines.push(
              `requests: ${overview.kpi.requests}  errors: ${overview.kpi.errors}  in flight: ${overview.kpi.inFlight}`,
              `cost:     $${overview.kpi.cost.toFixed(4)}  tokens: ${overview.kpi.inputTokens + overview.kpi.outputTokens}`,
            );
          }
          return { exitCode: 0, stdout: lines.join("\n") };
        }
        case "setup": {
          const wantedDir = flag("dir");
          const wantedPort =
            flag("port") === undefined ? undefined : Number(flag("port"));
          const asAdopt = argv.includes("--adopt");
          const status = asAdopt
            ? wantedDir === undefined || wantedPort === undefined
              ? publishState({
                  state: "error",
                  healthy: false,
                  detail: "adopting needs --dir and --port",
                })
              : await adopt(wantedDir, wantedPort, flag("token") ?? null)
            : await installFresh(wantedDir, wantedPort);
          if (json) {
            return { exitCode: status.state === "error" ? 1 : 0, stdout: JSON.stringify(status) };
          }
          return {
            exitCode: status.state === "error" ? 1 : 0,
            stdout:
              status.detail ??
              `millivolt ${status.managed ?? "installed"} on ${status.deployDir} (:${status.port})`,
          };
        }
        case "discover": {
          const found = await discover({ excludePorts: [config.embedPort] });
          if (json) return { exitCode: 0, stdout: JSON.stringify(found) };
          if (found.candidates.length === 0) {
            return { exitCode: 0, stdout: "No existing millivolt found." };
          }
          return {
            exitCode: 0,
            stdout: found.candidates
              .map(
                (entry) =>
                  `${entry.kind.padEnd(12)} port ${String(entry.port ?? "—").padEnd(5)} ${entry.deployDir ?? "(no directory)"}
             ${entry.evidence}`,
              )
              .join("\n"),
          };
        }
        case "update": {
          const result = await runUpdate("manual");
          if (json) return { exitCode: 0, stdout: JSON.stringify(result) };
          return {
            exitCode: 0,
            stdout:
              result.detail ??
              (result.changed ? "updated to the newest image" : "already up to date"),
          };
        }
        case "repair": {
          const status = await repairMillivolt();
          if (json) return { exitCode: status.state === "error" ? 1 : 0, stdout: JSON.stringify(status) };
          return {
            exitCode: status.state === "error" ? 1 : 0,
            stdout: status.repairReport ?? status.detail ?? status.state,
          };
        }
        case "revert":
        case "resume": {
          const status =
            command === "revert" ? await revertMillivolt() : await resumeMillivolt();
          if (json) {
            return { exitCode: status.state === "error" ? 1 : 0, stdout: JSON.stringify(status) };
          }
          return {
            exitCode: status.state === "error" ? 1 : 0,
            stdout:
              status.detail ??
              (command === "revert"
                ? `reverted to ${status.rolledBackTo ?? "the previous image"}`
                : "tracking the published image again"),
          };
        }
        case "start":
        case "stop":
        case "restart": {
          desiredRunning = command !== "stop";
          await alia.storage.kv.set("desired-running", desiredRunning);
          const status =
            command === "stop"
              ? await stopMillivolt()
              : command === "restart"
                ? await restartMillivolt()
                : await startMillivolt();
          return {
            exitCode: status.state === "error" ? 1 : 0,
            stdout: `${command}: ${status.state}${status.detail === null ? "" : ` — ${status.detail}`}`,
          };
        }
        case "url":
          return { exitCode: 0, stdout: `${baseUrl()}/` };
        case "requests": {
          const limit = Math.min(Math.max(Number(args[0] ?? 20) || 20, 10), 200);
          const page = await readRequests({ limit });
          if (json) return { exitCode: 0, stdout: JSON.stringify(page) };
          if (page.rows.length === 0) return { exitCode: 0, stdout: "No requests recorded." };
          return {
            exitCode: 0,
            stdout: page.rows
              .map(
                (row) =>
                  `${row.start}  ${String(row.status).padEnd(3)}  ${row.provider}/${row.model}  ${row.client}  ${row.durationMs}ms  in:${row.inputTokens} out:${row.outputTokens}${row.errorType === null ? "" : `  !${row.errorType}`}`,
              )
              .join("\n"),
          };
        }
        default:
          return { exitCode: 1, stderr: usage };
      }
    },
  });
}
