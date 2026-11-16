import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { taskTypeSchema, type TaskType } from "./lib/task-type";
import { JobRegistry, JOBS_KEY, JOBS_CHANGED, snapshotInputSchema, snapshotSchema, type Job } from "./lib/observability";

export const endpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  createdAt: z.string(),
});

export type Endpoint = z.infer<typeof endpointSchema>;

export const modelLocationSchema = z.enum(["local", "cloud"]);
export type ModelLocation = z.infer<typeof modelLocationSchema>;

export const capabilityTagSchema = taskTypeSchema;
export type CapabilityTag = z.infer<typeof capabilityTagSchema>;

export { taskTypeSchema, type TaskType } from "./lib/task-type";

export const modelOverrideSchema = z.object({
  model: z.string().trim().min(1),
  location: modelLocationSchema.optional(),
  tags: z.array(capabilityTagSchema).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  updatedAt: z.string(),
});

export type ModelOverride = z.infer<typeof modelOverrideSchema>;

export const modelInfoSchema = z.object({
  name: z.string(),
  modifiedAt: z.string().nullable(),
  size: z.number().nullable(),
  digest: z.string().nullable(),
  family: z.string().nullable(),
  parameterSize: z.string().nullable(),
  quantization: z.string().nullable(),
  location: modelLocationSchema,
  tags: z.array(capabilityTagSchema),
  routingPriority: z.number().int(),
  classificationSource: z.enum(["heuristic", "override"]),
  contextLength: z.number().int().positive().nullable(),
});

export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const runningModelSchema = z.object({
  name: z.string(),
  size: z.number().nullable(),
  sizeVram: z.number().nullable(),
  contextLength: z.number().nullable(),
  expiresAt: z.string().nullable(),
});

export type RunningModel = z.infer<typeof runningModelSchema>;

export const probeResultSchema = z.object({
  endpoint: endpointSchema,
  online: z.boolean(),
  latencyMs: z.number().nullable(),
  healthReliability: z.number().min(0).max(1),
  models: z.array(modelInfoSchema),
  runningModels: z.array(runningModelSchema),
  runningError: z.string().nullable(),
  error: z.string().nullable(),
});

export type ProbeResult = z.infer<typeof probeResultSchema>;

export const recommendationConstraintsSchema = z.object({
  localOnly: z.boolean().default(false),
  minContext: z.number().int().positive().optional(),
  preferRunning: z.boolean().default(false),
  preferReliable: z.boolean().default(false),
  endpointId: z.string().optional(),
});

export type RecommendationConstraints = z.infer<
  typeof recommendationConstraintsSchema
>;

export const recommendationCandidateSchema = z.object({
  endpoint: endpointSchema,
  model: modelInfoSchema,
  running: z.boolean(),
  reliability: z.number().min(0).max(1),
  cooldownUntil: z.string().nullable(),
  benchmarkSamples: z.number().int().nonnegative(),
  averageTokensPerSecond: z.number().nullable(),
  score: z.number(),
  reasons: z.array(z.string()),
});

export type RecommendationCandidate = z.infer<
  typeof recommendationCandidateSchema
>;

export const recommendationResultSchema = z.object({
  taskType: taskTypeSchema,
  constraints: recommendationConstraintsSchema,
  recommended: recommendationCandidateSchema.nullable(),
  alternatives: z.array(recommendationCandidateSchema),
  considered: z.number().int().nonnegative(),
  offlineEndpoints: z.array(endpointSchema),
});

export type RecommendationResult = z.infer<typeof recommendationResultSchema>;

export const modelTestResultSchema = z.object({
  mode: z.enum(["metadata", "generate"]),
  ok: z.boolean(),
  response: z.string().nullable(),
  contextLength: z.number().int().positive().nullable(),
  wallClockMs: z.number().nullable(),
  totalDurationMs: z.number().nullable(),
  loadDurationMs: z.number().nullable(),
  promptEvalCount: z.number().int().nullable(),
  promptEvalMs: z.number().nullable(),
  evalCount: z.number().int().nullable(),
  evalMs: z.number().nullable(),
  tokensPerSecond: z.number().nullable(),
  error: z.string().nullable(),
});

export type ModelTestResult = z.infer<typeof modelTestResultSchema>;

export const healthEventSchema = z.object({
  endpointId: z.string(),
  online: z.boolean(),
  latencyMs: z.number().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});

export type HealthEvent = z.infer<typeof healthEventSchema>;

export const benchmarkEventSchema = z.object({
  endpointId: z.string(),
  model: z.string(),
  mode: z.enum(["metadata", "generate"]),
  ok: z.boolean(),
  wallClockMs: z.number().nullable(),
  loadDurationMs: z.number().nullable(),
  tokensPerSecond: z.number().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});

export type BenchmarkEvent = z.infer<typeof benchmarkEventSchema>;

export const fleetHistorySchema = z.object({
  health: z.array(healthEventSchema),
  benchmarks: z.array(benchmarkEventSchema),
  cooldowns: z.array(
    z.object({
      endpointId: z.string(),
      model: z.string(),
      until: z.string(),
    }),
  ),
});

export type FleetHistory = z.infer<typeof fleetHistorySchema>;

export const routeAttemptSchema = z.object({
  candidate: recommendationCandidateSchema,
  result: modelTestResultSchema,
});

export const routeResultSchema = z.object({
  taskType: taskTypeSchema,
  prompt: z.string(),
  attempts: z.array(routeAttemptSchema),
  succeeded: z.boolean(),
  selected: recommendationCandidateSchema.nullable(),
  response: z.string().nullable(),
  error: z.string().nullable(),
});

export type RouteResult = z.infer<typeof routeResultSchema>;

const ollamaTagsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      model: z.string().optional(),
      modified_at: z.string().optional(),
      size: z.number().optional(),
      digest: z.string().optional(),
      details: z
        .object({
          format: z.string().optional(),
          family: z.string().optional(),
          parameter_size: z.string().optional(),
          quantization_level: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

const ollamaPsResponseSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      size: z.number().optional(),
      size_vram: z.number().optional(),
      context_length: z.number().optional(),
      expires_at: z.string().optional(),
    }),
  ),
});

const ollamaShowResponseSchema = z
  .object({
    model_info: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ollamaChatResponseSchema = z
  .object({
    message: z.object({ content: z.string() }),
    done: z.boolean(),
    total_duration: z.number().optional(),
    load_duration: z.number().optional(),
    prompt_eval_count: z.number().int().optional(),
    prompt_eval_duration: z.number().optional(),
    eval_count: z.number().int().optional(),
    eval_duration: z.number().optional(),
  })
  .passthrough();

const piCloudModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  reasoning: z.boolean(),
  input: z.array(z.enum(["text", "image"])),
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
  }),
});

const aliaModelCatalogResultSchema = z.object({
  path: z.string(),
  providerId: z.literal("ollama-cloud"),
  modelCount: z.number().int().nonnegative(),
  models: z.array(piCloudModelSchema),
  apiKeyEnvironmentVariable: z.literal("OLLAMA_API_KEY"),
  apiKeyAvailable: z.boolean(),
  credentialPath: z.string(),
  credentialConfigured: z.boolean(),
  backupPath: z.string().nullable(),
  credentialBackupPath: z.string().nullable(),
  updatedAt: z.string(),
});

export type AliaModelCatalogResult = z.infer<typeof aliaModelCatalogResultSchema>;

export const rpcContract = defineRpcContract({
  fleet_list: {
    input: z.null(),
    output: z.object({
      endpoints: z.array(endpointSchema),
    }),
  },

  fleet_add: {
    input: z.object({
      name: z.string().trim().min(1).max(100),
      baseUrl: z.string().trim().min(1).max(500),
    }),
    output: endpointSchema,
  },

  fleet_remove: {
    input: z.object({
      id: z.string(),
    }),
    output: z.object({
      removed: z.boolean(),
    }),
  },

  fleet_probe: {
    input: z.object({
      id: z.string(),
    }),
    output: probeResultSchema,
  },

  fleet_probe_all: {
    input: z.null(),
    output: z.object({
      results: z.array(probeResultSchema),
    }),
  },

  fleet_test_model: {
    input: z.object({
      id: z.string(),
      model: z.string().trim().min(1),
      generate: z.boolean().optional(),
      prompt: z.string().trim().min(1).max(1000).optional(),
    }),
    output: modelTestResultSchema,
  },

  fleet_recommend: {
    input: z.object({
      taskType: taskTypeSchema,
      localOnly: z.boolean().optional(),
      minContext: z.number().int().positive().optional(),
      preferRunning: z.boolean().optional(),
      preferReliable: z.boolean().optional(),
      endpointId: z.string().optional(),
    }),
    output: recommendationResultSchema,
  },

  fleet_history: {
    input: z.object({ endpointId: z.string().optional() }),
    output: fleetHistorySchema,
  },

  fleet_observability_snapshot: { input: snapshotInputSchema, output: snapshotSchema },

  fleet_route: {
    input: z.object({
      taskType: taskTypeSchema,
      prompt: z.string().trim().min(1).max(4000),
      label: z.string().max(120).optional(),
      localOnly: z.boolean().optional(),
      minContext: z.number().int().positive().optional(),
      preferRunning: z.boolean().optional(),
      preferReliable: z.boolean().optional(),
      endpointId: z.string().optional(),
      maxAttempts: z.number().int().min(1).max(5).optional(),
    }),
    output: routeResultSchema,
  },
});

const FLEET_CHANGED = "fleet-changed";

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === "AbortError") {
      return "Request timed out";
    }
    return cause.message;
  }

  return String(cause);
}

function normalizeBaseUrl(raw: string): string {
  let value = raw.trim();

  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }

  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ollama URL must use http:// or https://");
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error("Credentials are not supported in Ollama Fleet URLs");
  }

  url.search = "";
  url.hash = "";

  let path = url.pathname.replace(/\/+$/, "");

  if (path === "/v1" || path === "/api") {
    path = "";
  }

  if (path !== "" && path !== "/") {
    throw new Error(
      "Enter the Ollama server root URL, for example http://10.0.0.50:11434",
    );
  }

  url.pathname = "/";

  return url.toString().replace(/\/$/, "");
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 5000,
): Promise<unknown> {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const OLLAMA_CLOUD_BASE_URL = "https://ollama.com";
const OLLAMA_CLOUD_PROVIDER_ID = "ollama-cloud";
const OLLAMA_CLOUD_API_KEY_ENV = "OLLAMA_API_KEY";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function piModelsPath(): string {
  return join(homedir(), ".pi", "agent", "models.json");
}

function piAuthPath(): string {
  return join(homedir(), ".pi", "agent", "auth.json");
}

function likelyReasoningModel(model: string): boolean {
  return /deepseek|gpt-oss|glm-[45]|kimi|qwen3|qwq|minimax|nemotron|thinking|reason/i.test(model);
}

function likelyVisionModel(model: string): boolean {
  return /gemma4|glm-5\.3|kimi-k(?:2\.6|2\.7|3)|minimax-m3|mistral-large-3|qwen3\.5|vision|vl(?:[:._-]|$)/i.test(model);
}

function toPiCloudModel(model: z.infer<typeof ollamaTagsResponseSchema>["models"][number]): z.infer<typeof piCloudModelSchema> {
  const id = (model.model ?? model.name).trim();
  return {
    id,
    name: `${id} (Ollama Cloud)`,
    reasoning: likelyReasoningModel(id),
    input: likelyVisionModel(id) ? ["text", "image"] : ["text"],
    // Pi's documented defaults are intentionally conservative. Ollama Cloud
    // models with a larger window remain usable without VesnALIA overcommitting a
    // context size the catalog endpoint does not promise.
    contextWindow: 128_000,
    maxTokens: 32_768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

async function fetchOllamaCloudModels(): Promise<z.infer<typeof piCloudModelSchema>[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env[OLLAMA_CLOUD_API_KEY_ENV];
  if (apiKey !== undefined && apiKey.trim() !== "") {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  const raw = await fetchJson(
    `${OLLAMA_CLOUD_BASE_URL}/api/tags`,
    { headers },
    20_000,
  );
  const parsed = ollamaTagsResponseSchema.parse(raw);
  const byId = new Map<string, z.infer<typeof piCloudModelSchema>>();
  for (const model of parsed.models) {
    const normalized = toPiCloudModel(model);
    if (normalized.id !== "") byId.set(modelKey(normalized.id), normalized);
  }
  const models = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (models.length === 0) throw new Error("Ollama Cloud returned an empty model catalog");
  return models;
}

async function readJsonObjectDocument(path: string): Promise<{ document: JsonObject; existed: boolean }> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { document: {}, existed: false };
    throw cause;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${path} is not valid JSON; refusing to overwrite it`);
  }
  if (!isJsonObject(parsed)) throw new Error(`${path} must contain a JSON object`);
  if (parsed.providers !== undefined && !isJsonObject(parsed.providers)) {
    throw new Error(`${path} has a non-object providers field; refusing to overwrite it`);
  }
  return { document: parsed, existed: true };
}

async function writeJsonObjectDocument(path: string, document: JsonObject, existed: boolean): Promise<string | null> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const backupPath = existed ? `${path}.ollama-fleet.bak` : null;
  if (backupPath !== null) {
    await copyFile(path, backupPath);
    await chmod(backupPath, 0o600);
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  return backupPath;
}

function hasPiApiKeyCredential(document: JsonObject): boolean {
  const credential = document[OLLAMA_CLOUD_PROVIDER_ID];
  return isJsonObject(credential)
    && credential.type === "api_key"
    && typeof credential.key === "string"
    && credential.key.trim() !== "";
}

async function syncPiApiKeyCredential(): Promise<{
  path: string;
  configured: boolean;
  backupPath: string | null;
}> {
  const path = piAuthPath();
  const apiKey = process.env[OLLAMA_CLOUD_API_KEY_ENV]?.trim();
  const current = await readJsonObjectDocument(path);
  if (apiKey === undefined || apiKey === "") {
    return { path, configured: hasPiApiKeyCredential(current.document), backupPath: null };
  }

  const existing = current.document[OLLAMA_CLOUD_PROVIDER_ID];
  if (
    isJsonObject(existing)
    && existing.type === "api_key"
    && existing.key === apiKey
  ) {
    return { path, configured: true, backupPath: null };
  }

  const document = {
    ...current.document,
    [OLLAMA_CLOUD_PROVIDER_ID]: { type: "api_key", key: apiKey },
  };
  const backupPath = await writeJsonObjectDocument(path, document, current.existed);
  return { path, configured: true, backupPath };
}

async function syncOllamaCloudToAliaModels(): Promise<AliaModelCatalogResult> {
  const path = piModelsPath();
  const [models, current, credential] = await Promise.all([
    fetchOllamaCloudModels(),
    readJsonObjectDocument(path),
    syncPiApiKeyCredential(),
  ]);
  const providers = isJsonObject(current.document.providers)
    ? { ...current.document.providers }
    : {};
  providers[OLLAMA_CLOUD_PROVIDER_ID] = {
    baseUrl: `${OLLAMA_CLOUD_BASE_URL}/v1`,
    api: "openai-completions",
    apiKey: OLLAMA_CLOUD_API_KEY_ENV,
    authHeader: true,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    models,
  };
  const document = { ...current.document, providers };
  const backupPath = await writeJsonObjectDocument(path, document, current.existed);
  return {
    path,
    providerId: OLLAMA_CLOUD_PROVIDER_ID,
    modelCount: models.length,
    models,
    apiKeyEnvironmentVariable: OLLAMA_CLOUD_API_KEY_ENV,
    apiKeyAvailable: Boolean(process.env[OLLAMA_CLOUD_API_KEY_ENV]?.trim()),
    credentialPath: credential.path,
    credentialConfigured: credential.configured,
    backupPath,
    credentialBackupPath: credential.backupPath,
    updatedAt: new Date().toISOString(),
  };
}

async function aliaModelCatalogStatus(): Promise<Omit<AliaModelCatalogResult, "models" | "backupPath" | "credentialBackupPath" | "updatedAt"> & { configured: boolean }> {
  const path = piModelsPath();
  const credentialPath = piAuthPath();
  const [current, credentials] = await Promise.all([
    readJsonObjectDocument(path),
    readJsonObjectDocument(credentialPath),
  ]);
  const provider = isJsonObject(current.document.providers)
    ? current.document.providers[OLLAMA_CLOUD_PROVIDER_ID]
    : undefined;
  const models = isJsonObject(provider) && Array.isArray(provider.models) ? provider.models : [];
  return {
    path,
    providerId: OLLAMA_CLOUD_PROVIDER_ID,
    configured: isJsonObject(provider),
    modelCount: models.length,
    apiKeyEnvironmentVariable: OLLAMA_CLOUD_API_KEY_ENV,
    apiKeyAvailable: Boolean(process.env[OLLAMA_CLOUD_API_KEY_ENV]?.trim()),
    credentialPath,
    credentialConfigured: hasPiApiKeyCredential(credentials.document),
  };
}

async function removeOllamaCloudFromAliaModels(): Promise<{
  path: string;
  removed: boolean;
  backupPath: string | null;
  credentialPath: string;
  credentialRemoved: boolean;
  credentialBackupPath: string | null;
}> {
  const path = piModelsPath();
  const credentialPath = piAuthPath();
  const [current, credentials] = await Promise.all([
    readJsonObjectDocument(path),
    readJsonObjectDocument(credentialPath),
  ]);

  const providers = isJsonObject(current.document.providers)
    ? { ...current.document.providers }
    : {};
  const removed = OLLAMA_CLOUD_PROVIDER_ID in providers;
  let backupPath: string | null = null;
  if (removed) {
    delete providers[OLLAMA_CLOUD_PROVIDER_ID];
    backupPath = await writeJsonObjectDocument(
      path,
      { ...current.document, providers },
      current.existed,
    );
  }

  const credentialDocument = { ...credentials.document };
  const credentialRemoved = OLLAMA_CLOUD_PROVIDER_ID in credentialDocument;
  let credentialBackupPath: string | null = null;
  if (credentialRemoved) {
    delete credentialDocument[OLLAMA_CLOUD_PROVIDER_ID];
    credentialBackupPath = await writeJsonObjectDocument(
      credentialPath,
      credentialDocument,
      credentials.existed,
    );
  }

  return {
    path,
    removed,
    backupPath,
    credentialPath,
    credentialRemoved,
    credentialBackupPath,
  };
}

function nanosecondsToMilliseconds(value: number | undefined): number | null {
  return value === undefined ? null : Math.round((value / 1_000_000) * 100) / 100;
}

function extractContextLength(raw: unknown): number | null {
  const parsed = ollamaShowResponseSchema.safeParse(raw);

  if (!parsed.success || parsed.data.model_info === undefined) {
    return null;
  }

  const candidates = Object.entries(parsed.data.model_info)
    .filter(([key]) => key.toLowerCase().endsWith("context_length"))
    .map(([, value]) => (typeof value === "number" ? value : Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0);

  return candidates.length === 0 ? null : Math.max(...candidates);
}

const HEALTH_HISTORY_LIMIT = 500;
const BENCHMARK_HISTORY_LIMIT = 200;
const MODEL_COOLDOWN_MS = 15 * 60 * 1000;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function endpointSuccessRate(
  history: HealthEvent[],
  endpointId: string,
): number {
  const recent = history
    .filter((event) => event.endpointId === endpointId)
    .slice(-20);

  if (recent.length === 0) return 1;
  return recent.filter((event) => event.online).length / recent.length;
}

function modelBenchmarkStats(
  history: BenchmarkEvent[],
  endpointId: string,
  model: string,
): {
  samples: number;
  successRate: number;
  averageTokensPerSecond: number | null;
  cooldownUntil: string | null;
} {
  const recent = history
    .filter(
      (event) =>
        event.endpointId === endpointId &&
        modelKey(event.model) === modelKey(model) &&
        event.mode === "generate",
    )
    .slice(-10);
  const successful = recent.filter((event) => event.ok);
  let consecutiveFailures = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index]?.ok) break;
    consecutiveFailures += 1;
  }

  let cooldownUntil: string | null = null;
  const latest = recent[recent.length - 1];

  if (consecutiveFailures >= 2 && latest !== undefined) {
    const expiresAt = Date.parse(latest.checkedAt) + MODEL_COOLDOWN_MS;
    if (expiresAt > Date.now()) cooldownUntil = new Date(expiresAt).toISOString();
  }

  return {
    samples: recent.length,
    successRate:
      recent.length === 0 ? 0.75 : successful.length / recent.length,
    averageTokensPerSecond: average(
      successful
        .map((event) => event.tokensPerSecond)
        .filter((value): value is number => value !== null),
    ),
    cooldownUntil,
  };
}

const CAPABILITY_ORDER: CapabilityTag[] = [
  "coding",
  "reasoning",
  "security",
  "general",
];

function modelKey(model: string): string {
  return model.trim().toLowerCase();
}

export function inferModelLocation(model: string): ModelLocation {
  return /(?:^|[-_:/.])cloud(?:$|[-_:/.])/i.test(model) ? "cloud" : "local";
}

export function inferCapabilityTags(model: string): CapabilityTag[] {
  const name = model.toLowerCase();
  const tags = new Set<CapabilityTag>();

  if (
    /coder|coding|code[-_.:]|devstral|codestral|starcoder|codellama|claude-local/.test(
      name,
    )
  ) {
    tags.add("coding");
  }

  if (
    /reason|thinking|deepseek-r1|qwq|gpt-oss|qwen3(?:[.:/_-]|$)|qwen3\.5|glm-4|rnj-1/.test(
      name,
    )
  ) {
    tags.add("reasoning");
  }

  if (/security|foundation-sec|cyber|red[-_.]?team|pentest|ops(?:[:/_-]|$)/.test(name)) {
    tags.add("security");
  }

  const isNonChatModel =
    /embed|embedding|rerank|flux|stable[-_.]?diffusion|whisper|clip/.test(name);

  if (!isNonChatModel) {
    tags.add("general");
  }

  return CAPABILITY_ORDER.filter((tag) => tags.has(tag));
}

function parseParameterBillions(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;

  const normalized = value.trim().toUpperCase();
  const suffixed = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*([BMK])$/);

  if (suffixed !== null) {
    const amount = Number(suffixed[1]);
    const unit = suffixed[2];

    if (!Number.isFinite(amount)) return null;
    if (unit === "B") return amount;
    if (unit === "M") return amount / 1000;
    return amount / 1_000_000;
  }

  const raw = Number(normalized);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  return raw >= 1_000_000 ? raw / 1_000_000_000 : raw;
}

function classifyModel(
  model: {
    name: string;
    modifiedAt: string | null;
    size: number | null;
    digest: string | null;
    family: string | null;
    parameterSize: string | null;
    quantization: string | null;
  },
  override: ModelOverride | undefined,
): ModelInfo {
  return {
    ...model,
    location: override?.location ?? inferModelLocation(model.name),
    tags: override?.tags ?? inferCapabilityTags(model.name),
    routingPriority: override?.priority ?? 0,
    classificationSource: override === undefined ? "heuristic" : "override",
    contextLength: null,
  };
}

function scoreCandidate(
  model: ModelInfo,
  taskType: TaskType,
  preferRunning: boolean,
  running: boolean,
  preferReliable: boolean,
  reliability: number,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const name = model.name.toLowerCase();

  if (model.tags.includes(taskType)) {
    score += 100;
    reasons.push(`${taskType} capability match`);
  } else if (model.tags.includes("general")) {
    score += 25;
    reasons.push("general-purpose fallback");
  }

  const taskBonus =
    taskType === "coding"
      ? /qwen3-coder/.test(name)
        ? 25
        : /devstral|deepseek-coder/.test(name)
          ? 20
          : /coder|codestral|codellama|starcoder/.test(name)
            ? 15
            : 0
      : taskType === "reasoning"
        ? /deepseek-r1/.test(name)
          ? 25
          : /thinking|qwq/.test(name)
            ? 20
            : /qwen3\.5|gpt-oss|glm-4/.test(name)
              ? 12
              : 0
        : taskType === "security"
          ? /foundation-sec/.test(name)
            ? 30
            : /security|cyber|pentest|red[-_.]?team/.test(name)
              ? 25
              : /ops(?:[:/_-]|$)/.test(name)
                ? 15
                : 0
          : 0;

  if (taskBonus > 0) {
    score += taskBonus;
    reasons.push("strong model-family match");
  }

  const parameterBillions = parseParameterBillions(model.parameterSize);

  if (parameterBillions !== null) {
    const qualityBonus = Math.min(30, Math.log2(parameterBillions + 1) * 5);
    score += qualityBonus;
    reasons.push(`estimated ${parameterBillions.toFixed(parameterBillions < 10 ? 1 : 0)}B parameters`);
  }

  if (model.location === "local") {
    score += 5;
    reasons.push("local model");
  }

  if (preferRunning && running) {
    score += 15;
    reasons.push("already loaded");
  }

  if (preferReliable) {
    score += reliability * 20;
    reasons.push(`${Math.round(reliability * 100)}% recent reliability`);
  }

  if (model.routingPriority !== 0) {
    score += model.routingPriority;
    reasons.push(`override priority ${model.routingPriority > 0 ? "+" : ""}${model.routingPriority}`);
  }

  return {
    score: Math.round(score * 100) / 100,
    reasons,
  };
}

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("Ollama Fleet loaded");
  const jobs = new JobRegistry({
    read: () => alia.storage.kv.get(JOBS_KEY),
    write: value => alia.storage.kv.set(JOBS_KEY, value),
    publish: value => alia.realtime.publish(JOBS_CHANGED, value),
  });
  await jobs.initialize();
  alia.onDispose(() => jobs.flush());
  const contextCache = new Map<string, number | null>();
  const lastHealthRecordedAt = new Map<string, number>();
  let telemetryWriteChain: Promise<void> = Promise.resolve();

  function enqueueTelemetry(write: () => Promise<void>): Promise<void> {
    const next = telemetryWriteChain.then(write, write);
    telemetryWriteChain = next.catch(() => undefined);
    return next;
  }

  async function readHealthHistory(): Promise<HealthEvent[]> {
    const raw = await alia.storage.kv.get<unknown>("health-history");
    const parsed = z.array(healthEventSchema).safeParse(raw ?? []);

    if (!parsed.success) {
      alia.log.warn("Stored Ollama Fleet health history was invalid");
      return [];
    }

    return parsed.data;
  }

  async function readBenchmarkHistory(): Promise<BenchmarkEvent[]> {
    const raw = await alia.storage.kv.get<unknown>("benchmark-history");
    const parsed = z.array(benchmarkEventSchema).safeParse(raw ?? []);

    if (!parsed.success) {
      alia.log.warn("Stored Ollama Fleet benchmark history was invalid");
      return [];
    }

    return parsed.data;
  }

  async function recordHealth(event: HealthEvent): Promise<void> {
    const now = Date.now();
    const last = lastHealthRecordedAt.get(event.endpointId) ?? 0;

    if (event.online && now - last < 30_000) return;
    lastHealthRecordedAt.set(event.endpointId, now);

    try {
      await enqueueTelemetry(async () => {
        const history = await readHealthHistory();
        await alia.storage.kv.set(
          "health-history",
          [...history, event].slice(-HEALTH_HISTORY_LIMIT),
        );
      });
    } catch (cause) {
      alia.log.warn(`Could not record Ollama Fleet health history: ${errorMessage(cause)}`);
    }
  }

  async function recordBenchmark(event: BenchmarkEvent): Promise<void> {
    try {
      await enqueueTelemetry(async () => {
        const history = await readBenchmarkHistory();
        await alia.storage.kv.set(
          "benchmark-history",
          [...history, event].slice(-BENCHMARK_HISTORY_LIMIT),
        );
      });
    } catch (cause) {
      alia.log.warn(`Could not record Ollama Fleet benchmark history: ${errorMessage(cause)}`);
    }
  }

  async function fleetHistory(endpointId?: string): Promise<FleetHistory> {
    const [health, benchmarks] = await Promise.all([
      readHealthHistory(),
      readBenchmarkHistory(),
    ]);

    const filteredHealth =
        endpointId === undefined
          ? health
          : health.filter((event) => event.endpointId === endpointId);
    const filteredBenchmarks =
        endpointId === undefined
          ? benchmarks
          : benchmarks.filter((event) => event.endpointId === endpointId);
    const pairs = new Map<string, { endpointId: string; model: string }>();

    for (const event of filteredBenchmarks) {
      if (event.mode !== "generate") continue;
      pairs.set(`${event.endpointId}:${modelKey(event.model)}`, {
        endpointId: event.endpointId,
        model: event.model,
      });
    }

    const cooldowns = [...pairs.values()].flatMap((pair) => {
      const stats = modelBenchmarkStats(
        filteredBenchmarks,
        pair.endpointId,
        pair.model,
      );
      return stats.cooldownUntil === null
        ? []
        : [{ ...pair, until: stats.cooldownUntil }];
    });

    return {
      health: filteredHealth,
      benchmarks: filteredBenchmarks,
      cooldowns,
    };
  }

  async function readEndpoints(): Promise<Endpoint[]> {
    const raw = await alia.storage.kv.get<unknown>("endpoints");

    if (raw === undefined || raw === null) {
      return [];
    }

    const parsed = z.array(endpointSchema).safeParse(raw);

    if (!parsed.success) {
      alia.log.warn("Stored Ollama Fleet endpoint data was invalid");
      return [];
    }

    return parsed.data;
  }

  async function writeEndpoints(endpoints: Endpoint[]): Promise<void> {
    await alia.storage.kv.set("endpoints", endpoints);

    alia.realtime.publish(FLEET_CHANGED, {
      count: endpoints.length,
    });
  }

  async function readOverrides(): Promise<ModelOverride[]> {
    const raw = await alia.storage.kv.get<unknown>("model-overrides");

    if (raw === undefined || raw === null) {
      return [];
    }

    const parsed = z.array(modelOverrideSchema).safeParse(raw);

    if (!parsed.success) {
      alia.log.warn("Stored Ollama Fleet model overrides were invalid");
      return [];
    }

    return parsed.data;
  }

  async function writeOverrides(overrides: ModelOverride[]): Promise<void> {
    await alia.storage.kv.set("model-overrides", overrides);
    alia.realtime.publish(FLEET_CHANGED, { overrides: overrides.length });
  }

  async function overrideMap(): Promise<Map<string, ModelOverride>> {
    return new Map(
      (await readOverrides()).map((override) => [modelKey(override.model), override]),
    );
  }

  async function setOverride(
    model: string,
    values: Pick<ModelOverride, "location" | "tags" | "priority">,
  ): Promise<ModelOverride> {
    if (
      values.location === undefined &&
      values.tags === undefined &&
      values.priority === undefined
    ) {
      throw new Error("Set at least one of location, tags, or priority");
    }

    const overrides = await readOverrides();
    const key = modelKey(model);
    const current = overrides.find((override) => modelKey(override.model) === key);
    const next = modelOverrideSchema.parse({
      model: model.trim(),
      location: values.location ?? current?.location,
      tags: values.tags ?? current?.tags,
      priority: values.priority ?? current?.priority,
      updatedAt: new Date().toISOString(),
    });

    await writeOverrides([
      ...overrides.filter((override) => modelKey(override.model) !== key),
      next,
    ].sort((a, b) => a.model.localeCompare(b.model)));

    return next;
  }

  async function clearOverride(model: string): Promise<boolean> {
    const overrides = await readOverrides();
    const key = modelKey(model);
    const remaining = overrides.filter((override) => modelKey(override.model) !== key);

    if (remaining.length === overrides.length) {
      return false;
    }

    await writeOverrides(remaining);
    return true;
  }

  async function getEndpoint(id: string): Promise<Endpoint | null> {
    const endpoints = await readEndpoints();
    return endpoints.find((endpoint) => endpoint.id === id) ?? null;
  }

  async function fetchModelContext(
    endpoint: Endpoint,
    model: string,
  ): Promise<number | null> {
    const raw = await fetchJson(
      `${endpoint.baseUrl}/api/show`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      },
      10_000,
    );

    return extractContextLength(raw);
  }

  async function getModelContext(
    endpoint: Endpoint,
    model: string,
  ): Promise<number | null> {
    const key = `${endpoint.id}:${modelKey(model)}`;

    if (contextCache.has(key)) {
      return contextCache.get(key) ?? null;
    }

    try {
      const contextLength = await fetchModelContext(endpoint, model);
      contextCache.set(key, contextLength);
      return contextLength;
    } catch {
      return null;
    }
  }

  async function addEndpoint(
    name: string,
    rawBaseUrl: string,
  ): Promise<Endpoint> {
    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    const endpoints = await readEndpoints();

    if (endpoints.some((endpoint) => endpoint.baseUrl === baseUrl)) {
      throw new Error(`Ollama endpoint ${baseUrl} is already in the fleet`);
    }

    const endpoint: Endpoint = {
      id: randomUUID().slice(0, 8),
      name: name.trim(),
      baseUrl,
      createdAt: new Date().toISOString(),
    };

    await writeEndpoints([...endpoints, endpoint]);

    return endpoint;
  }

  async function removeEndpoint(id: string): Promise<boolean> {
    const endpoints = await readEndpoints();
    const remaining = endpoints.filter((endpoint) => endpoint.id !== id);

    if (remaining.length === endpoints.length) {
      return false;
    }

    await writeEndpoints(remaining);

    return true;
  }

  async function probeEndpoint(
    endpoint: Endpoint,
    overridesByModel?: Map<string, ModelOverride>,
  ): Promise<ProbeResult> {
    const started = performance.now();

    try {
      const raw = await fetchJson(`${endpoint.baseUrl}/api/tags`);
      const response = ollamaTagsResponseSchema.parse(raw);
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      const overrides = overridesByModel ?? (await overrideMap());

      const models: ModelInfo[] = response.models
        .map((model) =>
          classifyModel(
            {
              name: model.name,
              modifiedAt: model.modified_at ?? null,
              size: model.size ?? null,
              digest: model.digest ?? null,
              family: model.details?.family ?? null,
              parameterSize: model.details?.parameter_size ?? null,
              quantization: model.details?.quantization_level ?? null,
            },
            overrides.get(modelKey(model.name)),
          ),
        )
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const model of models) {
        const key = `${endpoint.id}:${modelKey(model.name)}`;
        if (contextCache.has(key)) {
          model.contextLength = contextCache.get(key) ?? null;
        }
      }

      let runningModels: RunningModel[] = [];
      let runningError: string | null = null;

      try {
        const runningRaw = await fetchJson(`${endpoint.baseUrl}/api/ps`, undefined, 3000);
        const running = ollamaPsResponseSchema.parse(runningRaw);
        runningModels = running.models
          .map((model) => ({
            name: model.name,
            size: model.size ?? null,
            sizeVram: model.size_vram ?? null,
            contextLength: model.context_length ?? null,
            expiresAt: model.expires_at ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch (cause) {
        runningError = errorMessage(cause);
      }

      const result: ProbeResult = {
        endpoint,
        online: true,
        latencyMs,
        healthReliability: 1,
        models,
        runningModels,
        runningError,
        error: null,
      };
      await recordHealth({
        endpointId: endpoint.id,
        online: true,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error: null,
      });
      result.healthReliability = endpointSuccessRate(
        await readHealthHistory(),
        endpoint.id,
      );
      return result;
    } catch (cause) {
      const error = errorMessage(cause);
      const result: ProbeResult = {
        endpoint,
        online: false,
        latencyMs: null,
        healthReliability: 0,
        models: [],
        runningModels: [],
        runningError: null,
        error,
      };
      await recordHealth({
        endpointId: endpoint.id,
        online: false,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
        error,
      });
      result.healthReliability = endpointSuccessRate(
        await readHealthHistory(),
        endpoint.id,
      );
      return result;
    }
  }

  async function probeAll(): Promise<ProbeResult[]> {
    const endpoints = await readEndpoints();
    const overrides = await overrideMap();

    return await Promise.all(
      endpoints.map((endpoint) => probeEndpoint(endpoint, overrides)),
    );
  }

  async function recommendModel(
    taskType: TaskType,
    constraintsInput: Partial<RecommendationConstraints>,
  ): Promise<RecommendationResult> {
    const constraints = recommendationConstraintsSchema.parse(constraintsInput);
    const endpoints = await readEndpoints();
    const selectedEndpoints =
      constraints.endpointId === undefined
        ? endpoints
        : endpoints.filter((endpoint) => endpoint.id === constraints.endpointId);

    if (constraints.endpointId !== undefined && selectedEndpoints.length === 0) {
      throw new Error(`No Ollama endpoint with id ${constraints.endpointId}`);
    }

    const overrides = await overrideMap();
    const results = await Promise.all(
      selectedEndpoints.map((endpoint) => probeEndpoint(endpoint, overrides)),
    );
    const [healthHistory, benchmarkHistory] = await Promise.all([
      readHealthHistory(),
      readBenchmarkHistory(),
    ]);
    const candidates: RecommendationCandidate[] = [];

    for (const result of results) {
      if (!result.online) continue;

      const running = new Set(
        result.runningModels.map((model) => modelKey(model.name)),
      );
      const endpointReliability = endpointSuccessRate(
        healthHistory,
        result.endpoint.id,
      );

      for (const model of result.models) {
        if (model.tags.length === 0) continue;
        if (constraints.localOnly && model.location !== "local") continue;

        const isRunning = running.has(modelKey(model.name));
        const benchmark = modelBenchmarkStats(
          benchmarkHistory,
          result.endpoint.id,
          model.name,
        );
        const reliability =
          Math.round(
            (endpointReliability * 0.6 + benchmark.successRate * 0.4) * 1000,
          ) / 1000;

        if (benchmark.cooldownUntil !== null) continue;

        const scored = scoreCandidate(
          model,
          taskType,
          constraints.preferRunning,
          isRunning,
          constraints.preferReliable,
          reliability,
        );
        candidates.push({
          endpoint: result.endpoint,
          model,
          running: isRunning,
          reliability,
          cooldownUntil: benchmark.cooldownUntil,
          benchmarkSamples: benchmark.samples,
          averageTokensPerSecond: benchmark.averageTokensPerSecond,
          score: scored.score,
          reasons: scored.reasons,
        });
      }
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.model.location !== b.model.location) {
        return a.model.location === "local" ? -1 : 1;
      }

      const byModel = a.model.name.localeCompare(b.model.name);
      return byModel !== 0
        ? byModel
        : a.endpoint.name.localeCompare(b.endpoint.name);
    });

    let eligibleCandidates = candidates;

    if (constraints.minContext !== undefined) {
      const matching: RecommendationCandidate[] = [];

      for (let index = 0; index < candidates.length && matching.length < 5; index += 4) {
        const batch = candidates.slice(index, index + 4);
        const checked = await Promise.all(
          batch.map(async (candidate) => {
            const contextLength =
              candidate.model.contextLength ??
              (await getModelContext(candidate.endpoint, candidate.model.name));

            return {
              ...candidate,
              model: { ...candidate.model, contextLength },
              reasons:
                contextLength === null
                  ? candidate.reasons
                  : [...candidate.reasons, `${contextLength.toLocaleString()} token context`],
            };
          }),
        );

        matching.push(
          ...checked.filter(
            (candidate) =>
              candidate.model.contextLength !== null &&
              candidate.model.contextLength >= constraints.minContext!,
          ),
        );
      }

      eligibleCandidates = matching;
    }

    return {
      taskType,
      constraints,
      recommended: eligibleCandidates[0] ?? null,
      alternatives: eligibleCandidates.slice(1, 5),
      considered: candidates.length,
      offlineEndpoints: results
        .filter((result) => !result.online)
        .map((result) => result.endpoint),
    };
  }

  async function finishModelTest(
    endpoint: Endpoint,
    model: string,
    result: ModelTestResult,
  ): Promise<ModelTestResult> {
    await recordBenchmark({
      endpointId: endpoint.id,
      model,
      mode: result.mode,
      ok: result.ok,
      wallClockMs: result.wallClockMs,
      loadDurationMs: result.loadDurationMs,
      tokensPerSecond: result.tokensPerSecond,
      checkedAt: new Date().toISOString(),
      error: result.error,
    });
    return result;
  }

  async function testModel(
    endpoint: Endpoint,
    model: string,
    generate = false,
    prompt = "Reply with exactly OK.",
    maxTokens = 16,
    signal?: AbortSignal,
  ): Promise<ModelTestResult> {
    const started = performance.now();

    try {
      if (!generate) {
        const raw = await fetchJson(
          `${endpoint.baseUrl}/api/show`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model }),
          },
          10_000,
        );
        const contextLength = extractContextLength(raw);
        contextCache.set(`${endpoint.id}:${modelKey(model)}`, contextLength);

        return finishModelTest(endpoint, model, {
          mode: "metadata",
          ok: true,
          response: null,
          contextLength,
          wallClockMs: Math.round(performance.now() - started),
          totalDurationMs: null,
          loadDurationMs: null,
          promptEvalCount: null,
          promptEvalMs: null,
          evalCount: null,
          evalMs: null,
          tokensPerSecond: null,
          error: null,
        });
      }

      const raw = await fetchJson(
        `${endpoint.baseUrl}/api/chat`,
        {
          signal,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            stream: false,
            options: { temperature: 0, num_predict: maxTokens },
          }),
        },
        120_000,
      );
      const response = ollamaChatResponseSchema.parse(raw);
      const evalMs = nanosecondsToMilliseconds(response.eval_duration);
      const tokensPerSecond =
        response.eval_count !== undefined &&
        response.eval_duration !== undefined &&
        response.eval_duration > 0
          ? Math.round(
              (response.eval_count / (response.eval_duration / 1_000_000_000)) *
                100,
            ) / 100
          : null;

      return finishModelTest(endpoint, model, {
        mode: "generate",
        ok: response.done,
        response: response.message.content.trim(),
        contextLength:
          contextCache.get(`${endpoint.id}:${modelKey(model)}`) ?? null,
        wallClockMs: Math.round(performance.now() - started),
        totalDurationMs: nanosecondsToMilliseconds(response.total_duration),
        loadDurationMs: nanosecondsToMilliseconds(response.load_duration),
        promptEvalCount: response.prompt_eval_count ?? null,
        promptEvalMs: nanosecondsToMilliseconds(response.prompt_eval_duration),
        evalCount: response.eval_count ?? null,
        evalMs,
        tokensPerSecond,
        error: response.done ? null : "Ollama response did not finish",
      });
    } catch (cause) {
      return finishModelTest(endpoint, model, {
        mode: generate ? "generate" : "metadata",
        ok: false,
        response: null,
        contextLength: null,
        wallClockMs: Math.round(performance.now() - started),
        totalDurationMs: null,
        loadDurationMs: null,
        promptEvalCount: null,
        promptEvalMs: null,
        evalCount: null,
        evalMs: null,
        tokensPerSecond: null,
        error: errorMessage(cause),
      });
    }
  }

  async function routeTask(
    taskType: TaskType,
    prompt: string,
    constraints: Partial<RecommendationConstraints>,
    maxAttempts = 3,
    context: { label?: string; origin?: Job["origin"]; signal?: AbortSignal } = {},
  ): Promise<RouteResult> {
    const jobId = jobs.start(taskType, context.label, context.origin ?? null);
    const signal = context.signal;
    const cancel = () => jobs.finish(jobId, "cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    const attempts: RouteResult["attempts"] = [];
    const cancelled = (): RouteResult => ({ taskType, prompt, attempts, succeeded: false,
      selected: null, response: null, error: "Cancelled" });
    try {
      if (signal?.aborted) { cancel(); return cancelled(); }
      const recommendation = await recommendModel(taskType, constraints);
      const chain = [
        ...(recommendation.recommended === null ? [] : [recommendation.recommended]),
        ...recommendation.alternatives,
      ].slice(0, Math.max(1, Math.min(5, maxAttempts)));
      for (const candidate of chain) {
        if (signal?.aborted) { cancel(); return cancelled(); }
        jobs.attempt(jobId, candidate.model.name, candidate.endpoint);
        const result = await testModel(candidate.endpoint, candidate.model.name, true, prompt, 256, signal);
        attempts.push({ candidate, result });
        if (signal?.aborted) { cancel(); return cancelled(); }
        if (result.ok) {
          jobs.finish(jobId, "completed");
          return { taskType, prompt, attempts, succeeded: true, selected: candidate,
            response: result.response, error: null };
        }
      }
      if (signal?.aborted) { cancel(); return cancelled(); }
      const error = chain.length === 0 ? "No eligible models are available"
        : attempts[attempts.length - 1]?.result.error ?? "Every fallback attempt failed";
      jobs.finish(jobId, "failed", error);
      return { taskType, prompt, attempts, succeeded: false, selected: null, response: null, error };
    } catch (cause) {
      if (signal?.aborted) { cancel(); return cancelled(); }
      jobs.finish(jobId, "failed", cause);
      throw cause;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  alia.rpc.register(rpcContract, {
    fleet_observability_snapshot: input => jobs.snapshot(input),
    fleet_list: async () => ({
      endpoints: await readEndpoints(),
    }),

    fleet_add: ({ name, baseUrl }) => addEndpoint(name, baseUrl),

    fleet_remove: async ({ id }) => ({
      removed: await removeEndpoint(id),
    }),

    fleet_probe: async ({ id }) => {
      const endpoint = await getEndpoint(id);

      if (endpoint === null) {
        throw new Error(`No Ollama endpoint with id ${id}`);
      }

      return probeEndpoint(endpoint);
    },

    fleet_probe_all: async () => ({
      results: await probeAll(),
    }),

    fleet_test_model: async ({ id, model, generate, prompt }) => {
      const endpoint = await getEndpoint(id);

      if (endpoint === null) {
        throw new Error(`No Ollama endpoint with id ${id}`);
      }

      return testModel(endpoint, model, generate ?? false, prompt);
    },

    fleet_recommend: ({
      taskType,
      localOnly,
      minContext,
      preferRunning,
      preferReliable,
      endpointId,
    }) =>
      recommendModel(taskType, {
        localOnly: localOnly ?? false,
        minContext,
        preferRunning: preferRunning ?? false,
        preferReliable: preferReliable ?? false,
        endpointId,
      }),

    fleet_history: ({ endpointId }) => fleetHistory(endpointId),

    fleet_route: ({
      taskType,
      prompt,
      label,
      localOnly,
      minContext,
      preferRunning,
      preferReliable,
      endpointId,
      maxAttempts,
    }) =>
      routeTask(
        taskType,
        prompt,
        {
          localOnly: localOnly ?? false,
          minContext,
          preferRunning: preferRunning ?? false,
          preferReliable: preferReliable ?? false,
          endpointId,
        },
        maxAttempts ?? 3,
        { label },
      ),
  });

  const usage = [
    "Usage:",
    "  VesnALIA ollama-fleet list [--json]",
    "  VesnALIA ollama-fleet add <name> <url> [--json]",
    "  VesnALIA ollama-fleet remove <endpoint-id> [--json]",
    "  VesnALIA ollama-fleet status [endpoint-id] [--json]",
    "  VesnALIA ollama-fleet models [endpoint-id] [--json]",
    "  VesnALIA ollama-fleet test <endpoint-id> <model> [--generate] [--prompt <text>] [--json]",
    "  VesnALIA ollama-fleet recommend <coding|reasoning|security|general> [--local-only] [--min-context <tokens>] [--prefer-running] [--prefer-reliable] [--endpoint <id>] [--json]",
    "  VesnALIA ollama-fleet route <coding|reasoning|security|general> <prompt> [recommend options] [--max-attempts 1..5] [--label <text>] [--json]",
    "  VesnALIA ollama-fleet history [endpoint-id] [--json]",
    "  VesnALIA ollama-fleet override list [--json]",
    "  VesnALIA ollama-fleet override set <model> [--location local|cloud] [--tags <csv|none>] [--priority -100..100] [--json]",
    "  VesnALIA ollama-fleet override clear <model> [--json]",
    "  VesnALIA ollama-fleet alia-models <sync|status|remove> [--json]",
  ].join("\n");

  alia.cli.register({
    name: "ollama-fleet",
    summary: "Manage and inspect Ollama servers",

    commands: [
      {
        name: "list",
        summary: "List configured Ollama endpoints",
        usage: "alia ollama-fleet list [--json]",
      },
      {
        name: "add",
        summary: "Add an Ollama endpoint",
        usage: 'alia ollama-fleet add "Desktop PC" http://10.0.0.50:11434',
      },
      {
        name: "remove",
        summary: "Remove an Ollama endpoint",
        usage: "alia ollama-fleet remove <endpoint-id>",
      },
      {
        name: "status",
        summary: "Check Ollama endpoint health",
        usage: "alia ollama-fleet status [endpoint-id] [--json]",
      },
      {
        name: "models",
        summary: "List models available through the fleet",
        usage: "alia ollama-fleet models [endpoint-id] [--json]",
      },
      {
        name: "test",
        summary: "Inspect a model or run a real generation smoke test",
        usage:
          "alia ollama-fleet test <endpoint-id> <model> [--generate] [--prompt <text>] [--json]",
      },
      {
        name: "recommend",
        summary: "Choose the best available model for a task",
        usage:
          "alia ollama-fleet recommend <coding|reasoning|security|general> [--local-only] [--min-context <tokens>] [--prefer-running] [--prefer-reliable] [--endpoint <id>] [--json]",
      },
      {
        name: "route",
        summary: "Generate with an ordered model fallback chain",
        usage:
          "alia ollama-fleet route <coding|reasoning|security|general> <prompt> [recommend options] [--max-attempts 1..5] [--label <text>] [--json]",
      },
      {
        name: "history",
        summary: "Inspect bounded health and benchmark history",
        usage: "alia ollama-fleet history [endpoint-id] [--json]",
      },
      {
        name: "override",
        summary: "Manage per-model capability and routing overrides",
        usage:
          "alia ollama-fleet override <list|set|clear> ... [--json]",
      },
      {
        name: "alia-models",
        summary: "Sync Ollama Cloud into VesnALIA's Pi-backed model list",
        usage: "alia ollama-fleet alia-models <sync|status|remove> [--json]",
      },
    ],

    async run(argv) {
      const json = argv.includes("--json");
      const clean = argv.filter((arg) => arg !== "--json");
      const [command, ...args] = clean;

      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value, null, 2) : text,
      });

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return {
            exitCode: 0,
            stdout: usage,
          };

        case "list": {
          const endpoints = await readEndpoints();

          return reply(
            endpoints,
            endpoints.length === 0
              ? "No Ollama endpoints configured."
              : endpoints
                  .map(
                    (endpoint) =>
                      `${endpoint.id}  ${endpoint.name}  ${endpoint.baseUrl}`,
                  )
                  .join("\n"),
          );
        }

        case "add": {
          if (args.length !== 2) {
            return {
              exitCode: 1,
              stderr: usage,
            };
          }

          const [name, baseUrl] = args;

          if (name === undefined || baseUrl === undefined) {
            return {
              exitCode: 1,
              stderr: usage,
            };
          }

          try {
            const endpoint = await addEndpoint(name, baseUrl);

            return reply(
              endpoint,
              `Added ${endpoint.name} (${endpoint.baseUrl}) as ${endpoint.id}`,
            );
          } catch (cause) {
            return {
              exitCode: 1,
              stderr: errorMessage(cause),
            };
          }
        }

        case "remove": {
          const id = args[0];

          if (id === undefined || args.length !== 1) {
            return {
              exitCode: 1,
              stderr: usage,
            };
          }

          if (!(await removeEndpoint(id))) {
            return {
              exitCode: 1,
              stderr: `No Ollama endpoint with id ${id}`,
            };
          }

          return reply(
            {
              removed: true,
              id,
            },
            `Removed ${id}`,
          );
        }

        case "status": {
          const id = args[0];

          if (id !== undefined) {
            const endpoint = await getEndpoint(id);

            if (endpoint === null) {
              return {
                exitCode: 1,
                stderr: `No Ollama endpoint with id ${id}`,
              };
            }

            const result = await probeEndpoint(endpoint);

            const text = result.online
              ? `${endpoint.name}: online, ${result.latencyMs} ms, ${result.models.length} models, ${result.runningModels.length} running`
              : `${endpoint.name}: offline - ${result.error}`;

            return reply(result, text);
          }

          const results = await probeAll();

          return reply(
            results,
            results.length === 0
              ? "No Ollama endpoints configured."
              : results
                  .map((result) =>
                    result.online
                      ? `${result.endpoint.name}: online, ${result.latencyMs} ms, ${result.models.length} models, ${result.runningModels.length} running`
                      : `${result.endpoint.name}: offline - ${result.error}`,
                  )
                  .join("\n"),
          );
        }

        case "models": {
          const id = args[0];

          let results: ProbeResult[];

          if (id !== undefined) {
            const endpoint = await getEndpoint(id);

            if (endpoint === null) {
              return {
                exitCode: 1,
                stderr: `No Ollama endpoint with id ${id}`,
              };
            }

            results = [await probeEndpoint(endpoint)];
          } else {
            results = await probeAll();
          }

          if (json) {
            return reply(results, "");
          }

          const lines: string[] = [];

          for (const result of results) {
            lines.push(`${result.endpoint.name} (${result.endpoint.id})`);

            if (!result.online) {
              lines.push(`  OFFLINE: ${result.error}`);
              continue;
            }

            const running = new Set(
              result.runningModels.map((model) => modelKey(model.name)),
            );

            for (const model of result.models) {
              const details = [
                running.has(modelKey(model.name)) ? "running" : null,
                model.location,
                model.tags.length === 0
                  ? "not-routable"
                  : model.tags.join(","),
                model.contextLength === null
                  ? null
                  : `${model.contextLength.toLocaleString()} context`,
                model.parameterSize,
                model.quantization,
                model.classificationSource === "override" ? "override" : null,
              ].filter(Boolean);

              lines.push(
                `  ${model.name}${details.length > 0 ? `  [${details.join(", ")}]` : ""}`,
              );
            }
          }

          return {
            exitCode: 0,
            stdout:
              lines.length === 0
                ? "No Ollama endpoints configured."
                : lines.join("\n"),
          };
        }

        case "history": {
          const endpointId = args[0];

          if (args.length > 1) return { exitCode: 1, stderr: usage };
          if (endpointId !== undefined && (await getEndpoint(endpointId)) === null) {
            return {
              exitCode: 1,
              stderr: `No Ollama endpoint with id ${endpointId}`,
            };
          }

          const history = await fleetHistory(endpointId);

          if (json) return reply(history, "");

          const healthRate =
            history.health.length === 0
              ? null
              : Math.round(
                  (history.health.filter((event) => event.online).length /
                    history.health.length) *
                    100,
                );
          const generations = history.benchmarks.filter(
            (event) => event.mode === "generate",
          );
          const lines = [
            `Health checks: ${history.health.length}${healthRate === null ? "" : ` · ${healthRate}% online`}`,
            `Generation benchmarks: ${generations.length}`,
            `Active cooldowns: ${history.cooldowns.length}`,
          ];

          for (const cooldown of history.cooldowns) {
            lines.push(
              `COOLDOWN  ${cooldown.model} on ${cooldown.endpointId} until ${cooldown.until}`,
            );
          }

          for (const event of generations.slice(-10).reverse()) {
            lines.push(
              `${event.checkedAt}  ${event.ok ? "ok" : "failed"}  ${event.model}  ${event.tokensPerSecond ?? "?"} tok/s  ${event.wallClockMs ?? "?"} ms`,
            );
          }

          return { exitCode: 0, stdout: lines.join("\n") };
        }

        case "test": {
          const [id, model] = args;

          if (id === undefined || model === undefined) {
            return {
              exitCode: 1,
              stderr: usage,
            };
          }

          let generate = false;
          let prompt: string | undefined;

          for (let index = 2; index < args.length; index += 1) {
            const arg = args[index];

            if (arg === "--generate") {
              generate = true;
              continue;
            }

            if (arg === "--prompt" && args[index + 1] !== undefined) {
              const parsed = z
                .string()
                .trim()
                .min(1)
                .max(1000)
                .safeParse(args[index + 1]);
              if (!parsed.success) return { exitCode: 1, stderr: usage };
              prompt = parsed.data;
              generate = true;
              index += 1;
              continue;
            }

            return { exitCode: 1, stderr: usage };
          }

          const endpoint = await getEndpoint(id);

          if (endpoint === null) {
            return {
              exitCode: 1,
              stderr: `No Ollama endpoint with id ${id}`,
            };
          }

          const result = await testModel(endpoint, model, generate, prompt);

          if (!result.ok) {
            return {
              exitCode: 1,
              stderr: result.error ?? "Model test failed",
            };
          }

          if (result.mode === "generate") {
            return reply(
              { endpoint: endpoint.name, model, ...result },
              [
                `${model} generated successfully on ${endpoint.name}`,
                `Response: ${result.response ?? "(empty)"}`,
                `Wall time: ${result.wallClockMs ?? "?"} ms · ${result.evalCount ?? "?"} tokens · ${result.tokensPerSecond ?? "?"} tokens/s`,
              ].join("\n"),
            );
          }

          return reply(
            { endpoint: endpoint.name, model, ...result },
            `${model} is available on ${endpoint.name}${result.contextLength === null ? "" : ` with ${result.contextLength.toLocaleString()} context`}`,
          );
        }

        case "recommend": {
          const taskType = taskTypeSchema.safeParse(args[0]);

          if (!taskType.success) {
            return { exitCode: 1, stderr: usage };
          }

          let localOnly = false;
          let minContext: number | undefined;
          let preferRunning = false;
          let preferReliable = false;
          let endpointId: string | undefined;

          for (let index = 1; index < args.length; index += 1) {
            const arg = args[index];

            if (arg === "--local-only") {
              localOnly = true;
              continue;
            }

            if (arg === "--prefer-running") {
              preferRunning = true;
              continue;
            }

            if (arg === "--prefer-reliable") {
              preferReliable = true;
              continue;
            }

            if (arg === "--min-context" && args[index + 1] !== undefined) {
              const parsed = z.coerce.number().int().positive().safeParse(args[index + 1]);
              if (!parsed.success) return { exitCode: 1, stderr: usage };
              minContext = parsed.data;
              index += 1;
              continue;
            }

            if (arg === "--endpoint" && args[index + 1] !== undefined) {
              endpointId = args[index + 1];
              index += 1;
              continue;
            }

            return { exitCode: 1, stderr: usage };
          }

          try {
            const result = await recommendModel(taskType.data, {
              localOnly,
              minContext,
              preferRunning,
              preferReliable,
              endpointId,
            });

            if (result.recommended === null) {
              return reply(
                result,
                `No eligible ${taskType.data} models are available${localOnly ? " with local-only enabled" : ""}.`,
              );
            }

            const choice = result.recommended;
            const text = [
              `${choice.model.name} on ${choice.endpoint.name}`,
              `score ${choice.score} · ${Math.round(choice.reliability * 100)}% reliable · ${choice.model.location}${choice.running ? " · running" : ""}${choice.model.contextLength === null ? "" : ` · ${choice.model.contextLength.toLocaleString()} context`} · ${choice.model.tags.join(", ")}`,
              choice.benchmarkSamples === 0
                ? "no generation benchmarks yet"
                : `${choice.benchmarkSamples} benchmark samples${choice.averageTokensPerSecond === null ? "" : ` · ${choice.averageTokensPerSecond} tokens/s average`}`,
              choice.reasons.join("; "),
            ].join("\n");

            return reply(result, text);
          } catch (cause) {
            return { exitCode: 1, stderr: errorMessage(cause) };
          }
        }

        case "route": {
          const taskType = taskTypeSchema.safeParse(args[0]);
          const prompt = z.string().trim().min(1).max(4000).safeParse(args[1]);

          if (!taskType.success || !prompt.success) {
            return { exitCode: 1, stderr: usage };
          }

          let localOnly = false;
          let minContext: number | undefined;
          let preferRunning = false;
          let preferReliable = false;
          let endpointId: string | undefined;
          let maxAttempts = 3;
          let label: string | undefined;

          for (let index = 2; index < args.length; index += 1) {
            const arg = args[index];

            if (arg === "--label" && args[index + 1] !== undefined) {
              const parsed = z.string().max(120).safeParse(args[++index]);
              if (!parsed.success) return { exitCode: 1, stderr: usage };
              label = parsed.data; continue;
            }
            if (arg === "--local-only") {
              localOnly = true;
              continue;
            }
            if (arg === "--prefer-running") {
              preferRunning = true;
              continue;
            }
            if (arg === "--prefer-reliable") {
              preferReliable = true;
              continue;
            }
            if (arg === "--min-context" && args[index + 1] !== undefined) {
              const parsed = z.coerce.number().int().positive().safeParse(args[index + 1]);
              if (!parsed.success) return { exitCode: 1, stderr: usage };
              minContext = parsed.data;
              index += 1;
              continue;
            }
            if (arg === "--endpoint" && args[index + 1] !== undefined) {
              endpointId = args[index + 1];
              index += 1;
              continue;
            }
            if (arg === "--max-attempts" && args[index + 1] !== undefined) {
              const parsed = z.coerce.number().int().min(1).max(5).safeParse(args[index + 1]);
              if (!parsed.success) return { exitCode: 1, stderr: usage };
              maxAttempts = parsed.data;
              index += 1;
              continue;
            }

            return { exitCode: 1, stderr: usage };
          }

          try {
            const result = await routeTask(
              taskType.data,
              prompt.data,
              {
                localOnly,
                minContext,
                preferRunning,
                preferReliable,
                endpointId,
              },
              maxAttempts,
              { label },
            );

            if (!result.succeeded || result.selected === null) {
              return {
                exitCode: 1,
                stderr: json
                  ? JSON.stringify(result, null, 2)
                  : result.error ?? "Every fallback attempt failed",
              };
            }

            return reply(
              result,
              [
                `Routed through ${result.selected.model.name} on ${result.selected.endpoint.name} after ${result.attempts.length} attempt${result.attempts.length === 1 ? "" : "s"}`,
                result.response ?? "(empty response)",
              ].join("\n"),
            );
          } catch (cause) {
            return { exitCode: 1, stderr: errorMessage(cause) };
          }
        }

        case "override": {
          const [action, ...overrideArgs] = args;

          if (action === "list" && overrideArgs.length === 0) {
            const overrides = await readOverrides();
            return reply(
              overrides,
              overrides.length === 0
                ? "No model overrides configured."
                : overrides
                    .map((override) => {
                      const values = [
                        override.location,
                        override.tags === undefined
                          ? undefined
                          : `tags=${override.tags.length === 0 ? "none" : override.tags.join(",")}`,
                        override.priority === undefined
                          ? undefined
                          : `priority=${override.priority}`,
                      ].filter(Boolean);
                      return `${override.model}  ${values.join("  ")}`;
                    })
                    .join("\n"),
            );
          }

          if (action === "clear" && overrideArgs.length === 1) {
            const model = overrideArgs[0];

            if (model === undefined || !(await clearOverride(model))) {
              return {
                exitCode: 1,
                stderr: `No model override for ${model ?? "the requested model"}`,
              };
            }

            return reply({ cleared: true, model }, `Cleared override for ${model}`);
          }

          if (action === "set") {
            const model = overrideArgs[0];

            if (model === undefined) {
              return { exitCode: 1, stderr: usage };
            }

            let location: ModelLocation | undefined;
            let tags: CapabilityTag[] | undefined;
            let priority: number | undefined;

            for (let index = 1; index < overrideArgs.length; index += 2) {
              const flag = overrideArgs[index];
              const value = overrideArgs[index + 1];

              if (value === undefined) {
                return { exitCode: 1, stderr: usage };
              }

              if (flag === "--location") {
                const parsed = modelLocationSchema.safeParse(value);
                if (!parsed.success) return { exitCode: 1, stderr: usage };
                location = parsed.data;
                continue;
              }

              if (flag === "--tags") {
                if (value === "none") {
                  tags = [];
                  continue;
                }

                const parsed = z
                  .array(capabilityTagSchema)
                  .safeParse([...new Set(value.split(",").map((tag) => tag.trim()))]);
                if (!parsed.success || parsed.data.length === 0) {
                  return { exitCode: 1, stderr: usage };
                }
                tags = CAPABILITY_ORDER.filter((tag) => parsed.data.includes(tag));
                continue;
              }

              if (flag === "--priority") {
                const parsed = z.coerce.number().int().min(-100).max(100).safeParse(value);
                if (!parsed.success) return { exitCode: 1, stderr: usage };
                priority = parsed.data;
                continue;
              }

              return { exitCode: 1, stderr: usage };
            }

            try {
              const override = await setOverride(model, {
                location,
                tags,
                priority,
              });
              return reply(override, `Saved override for ${override.model}`);
            } catch (cause) {
              return { exitCode: 1, stderr: errorMessage(cause) };
            }
          }

          return { exitCode: 1, stderr: usage };
        }

        case "alia-models": {
          const action = args[0];
          if (args.length !== 1 || !["sync", "status", "remove"].includes(action ?? "")) {
            return { exitCode: 1, stderr: usage };
          }
          try {
            if (action === "status") {
              const status = await aliaModelCatalogStatus();
              return reply(
                status,
                [
                  `Ollama Cloud VesnALIA models: ${status.configured ? `${status.modelCount} configured` : "not configured"}`,
                  `Catalog: ${status.path}`,
                  `${status.apiKeyEnvironmentVariable}: ${status.apiKeyAvailable ? "available to VesnALIA" : "not available to VesnALIA"}`,
                  `Pi credential: ${status.credentialConfigured ? `configured in ${status.credentialPath}` : "not configured"}`,
                ].join("\n"),
              );
            }
            if (action === "remove") {
              const result = await removeOllamaCloudFromAliaModels();
              return result.removed || result.credentialRemoved
                ? reply(
                    result,
                    [
                      result.removed ? `Removed Ollama Cloud from ${result.path}` : "Ollama Cloud model catalog was already absent",
                      result.credentialRemoved ? `Removed Pi credential from ${result.credentialPath}` : "Pi credential was already absent",
                    ].join("\n"),
                  )
                : { exitCode: 1, stderr: `Ollama Cloud is not configured in ${result.path}` };
            }
            const result = await syncOllamaCloudToAliaModels();
            return reply(
              result,
              [
                `Synced ${result.modelCount} Ollama Cloud models into VesnALIA`,
                `Provider: ${result.providerId} · catalog ${result.path}`,
                result.backupPath === null ? "Created a new Pi model catalog" : `Backup: ${result.backupPath}`,
                result.apiKeyAvailable
                  ? `${result.apiKeyEnvironmentVariable} is available to VesnALIA`
                  : `WARNING: ${result.apiKeyEnvironmentVariable} is not available to VesnALIA; set it for the VesnALIA host before using these models`,
                result.credentialConfigured
                  ? `Pi credential configured in ${result.credentialPath}`
                  : `WARNING: Pi credential is not configured; set ${result.apiKeyEnvironmentVariable} and sync again`,
                result.credentialBackupPath === null ? "" : `Credential backup: ${result.credentialBackupPath}`,
              ].filter((line) => line !== "").join("\n"),
            );
          } catch (cause) {
            return { exitCode: 1, stderr: errorMessage(cause) };
          }
        }

        default:
          return {
            exitCode: 1,
            stderr: usage,
          };
      }
    },
  });

  alia.agents.registerTool({
    name: "ollama_fleet_status",
    description:
      "Check the health, latency, and model count of Ollama servers configured in Ollama Fleet.",
    instructions:
      "Use ollama_fleet_status when you need to know which Ollama inference servers are currently reachable.",

    parameters: z.object({
      endpointId: z
        .string()
        .optional()
        .describe("Optional Ollama Fleet endpoint ID"),
    }),

    async execute({ endpointId }) {
      if (endpointId !== undefined) {
        const endpoint = await getEndpoint(endpointId);

        if (endpoint === null) {
          return `No Ollama endpoint with id ${endpointId}`;
        }

        return JSON.stringify(await probeEndpoint(endpoint), null, 2);
      }

      return JSON.stringify(await probeAll(), null, 2);
    },
  });

  alia.agents.registerTool({
    name: "ollama_fleet_models",
    description:
      "List models available from the Ollama servers configured in Ollama Fleet.",
    instructions:
      "Use ollama_fleet_models before selecting a local Ollama model or when checking where a model is available.",

    parameters: z.object({
      endpointId: z
        .string()
        .optional()
        .describe("Optional Ollama Fleet endpoint ID"),
    }),

    async execute({ endpointId }) {
      let results: ProbeResult[];

      if (endpointId !== undefined) {
        const endpoint = await getEndpoint(endpointId);

        if (endpoint === null) {
          return `No Ollama endpoint with id ${endpointId}`;
        }

        results = [await probeEndpoint(endpoint)];
      } else {
        results = await probeAll();
      }

      return JSON.stringify(results, null, 2);
    },
  });

  alia.agents.registerTool({
    name: "ollama_fleet_test",
    description:
      "Inspect a model or run a real generation smoke test with latency and throughput metrics.",
    instructions:
      "Use ollama_fleet_test to verify model metadata. Set generate=true when you need to prove inference works and measure it.",

    parameters: z.object({
      endpointId: z.string().describe("Ollama Fleet endpoint ID"),
      model: z.string().min(1).describe("Exact Ollama model name"),
      generate: z
        .boolean()
        .optional()
        .describe("Run a small /api/chat generation instead of metadata-only inspection"),
      prompt: z
        .string()
        .min(1)
        .max(1000)
        .optional()
        .describe("Optional smoke-test prompt; implies generation"),
    }),

    async execute({ endpointId, model, generate, prompt }) {
      const endpoint = await getEndpoint(endpointId);

      if (endpoint === null) {
        return `No Ollama endpoint with id ${endpointId}`;
      }

      return JSON.stringify(
        {
          endpoint: endpoint.name,
          model,
          ...(await testModel(
            endpoint,
            model,
            generate === true || prompt !== undefined,
            prompt,
          )),
        },
        null,
        2,
      );
    },
  });

  alia.agents.registerTool({
    name: "ollama_fleet_recommend",
    description:
      "Recommend the best currently available Ollama model for coding, reasoning, security, or general work.",
    instructions:
      "Use ollama_fleet_recommend when selecting an Ollama model. Set localOnly when cloud-backed Ollama models must not be used.",

    parameters: z.object({
      taskType: taskTypeSchema.describe("Type of work the model will perform"),
      localOnly: z
        .boolean()
        .optional()
        .describe("When true, exclude cloud-backed Ollama models"),
      minContext: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Minimum required context window in tokens"),
      preferRunning: z
        .boolean()
        .optional()
        .describe("Prefer models already loaded according to /api/ps"),
      preferReliable: z
        .boolean()
        .optional()
        .describe("Prefer models and endpoints with stronger recent reliability"),
      endpointId: z
        .string()
        .optional()
        .describe("Optional Ollama Fleet endpoint ID constraint"),
    }),

    async execute({
      taskType,
      localOnly,
      minContext,
      preferRunning,
      preferReliable,
      endpointId,
    }) {
      try {
        return JSON.stringify(
          await recommendModel(taskType, {
            localOnly: localOnly ?? false,
            minContext,
            preferRunning: preferRunning ?? false,
            preferReliable: preferReliable ?? false,
            endpointId,
          }),
          null,
          2,
        );
      } catch (cause) {
        return JSON.stringify({ error: errorMessage(cause) }, null, 2);
      }
    },
  });

  alia.agents.registerTool({
    name: "ollama_fleet_history",
    description:
      "Read bounded Ollama Fleet health checks and model benchmark history.",
    instructions:
      "Use ollama_fleet_history when diagnosing reliability, load time, or generation throughput.",
    parameters: z.object({
      endpointId: z
        .string()
        .optional()
        .describe("Optional Ollama Fleet endpoint ID"),
    }),
    async execute({ endpointId }) {
      return JSON.stringify(await fleetHistory(endpointId), null, 2);
    },
  });

  alia.agents.registerTool({
    name: "ollama_fleet_route",
    description:
      "Select an Ollama model, generate a response, and automatically try ordered fallback models when an attempt fails.",
    instructions:
      "Use ollama_fleet_route when you want Fleet to execute a prompt rather than only recommend a model. Keep maxAttempts small because every fallback performs inference.",
    parameters: z.object({
      taskType: taskTypeSchema.describe("Type of work the model will perform"),
      prompt: z.string().trim().min(1).max(4000),
      label: z.string().max(120).optional(),
      localOnly: z.boolean().optional(),
      minContext: z.number().int().positive().optional(),
      preferRunning: z.boolean().optional(),
      preferReliable: z.boolean().optional(),
      endpointId: z.string().optional(),
      maxAttempts: z.number().int().min(1).max(5).optional(),
    }),
    async execute({
      taskType,
      prompt,
      label,
      localOnly,
      minContext,
      preferRunning,
      preferReliable,
      endpointId,
      maxAttempts,
    }, ctx) {
      try {
        return JSON.stringify(
          await routeTask(
            taskType,
            prompt,
            {
              localOnly: localOnly ?? false,
              minContext,
              preferRunning: preferRunning ?? false,
              preferReliable: preferReliable ?? false,
              endpointId,
            },
            maxAttempts ?? 3,
            { label, origin: { threadId: ctx.threadId, projectId: ctx.projectId }, signal: ctx.signal },
          ),
          null,
          2,
        );
      } catch (cause) {
        return JSON.stringify({ error: errorMessage(cause) }, null, 2);
      }
    },
  });

  alia.agents.configure(() => ({
    tools: [
      "ollama_fleet_status",
      "ollama_fleet_models",
      "ollama_fleet_test",
      "ollama_fleet_recommend",
      "ollama_fleet_history",
      "ollama_fleet_route",
    ],
    skills: [],
  }));

  alia.onDispose(() => {
    alia.log.info("Ollama Fleet disposed");
  });
}
