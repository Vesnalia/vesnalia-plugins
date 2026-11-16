import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const DEFAULT_PROXY_PORT = 8459;

export type ManagerPaths = {
  root: string;
  socketPath: string;
  proxyPort: number;
};

export const managerPaths = (home: string): ManagerPaths => {
  const root = resolve(home.trim().length > 0 ? home : join(homedir(), ".tokenmaxx"));
  return {
    root,
    socketPath: join(root, "runtime", "manager.sock"),
    proxyPort: DEFAULT_PROXY_PORT,
  };
};

export class ManagerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagerUnavailableError";
  }
}

export class ManagerRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ManagerRequestError";
    this.code = code;
  }
}

const responseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  id: z.number(),
  result: z.unknown().optional(),
});

// The daemon speaks newline-delimited JSON-RPC over a unix socket, one request
// per connection: it writes a single line and the client closes.
const request = <T>(input: {
  socketPath: string;
  method: string;
  params?: unknown;
  schema: z.ZodType<T>;
  timeoutMs: number;
}): Promise<T> =>
  new Promise<T>((fulfil, reject) => {
    const socket = createConnection(input.socketPath);
    let buffer = "";
    let settled = false;

    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      run();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new ManagerRequestError("TIMEOUT", `${input.method} timed out`)));
    }, input.timeoutMs);

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: 1, method: input.method, params: input.params })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      finish(() => {
        try {
          const response = responseSchema.parse(JSON.parse(buffer.slice(0, newline)));
          if (response.error !== undefined) {
            reject(new ManagerRequestError(response.error.code, response.error.message));
            return;
          }
          fulfil(input.schema.parse(response.result));
        } catch (error) {
          reject(
            new ManagerRequestError(
              "INVALID_RESPONSE",
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      });
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        reject(
          error.code === "ENOENT" || error.code === "ECONNREFUSED"
            ? new ManagerUnavailableError("The tokenmaxx daemon is not running.")
            : new ManagerRequestError(error.code ?? "SOCKET_ERROR", error.message),
        );
      });
    });
  });

export const providerIdSchema = z.enum(["openai", "anthropic"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

const accountSchema = z
  .object({
    auth: z.string(),
    createdAt: z.string(),
    enabled: z.boolean(),
    externalAccountId: z.string().nullish(),
    health: z.string(),
    id: z.string(),
    identity: z.string(),
    label: z.string(),
    onThreshold: z.string().nullish(),
    plan: z.string().nullish(),
    provider: providerIdSchema,
    updatedAt: z.string(),
  })
  .loose();

const usageWindowSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    label: z.string(),
    resetAt: z.string().nullable(),
    usedPercent: z.number(),
  })
  .loose();

const extraUsageSchema = z
  .object({
    balanceUsd: z.number().nullable(),
    enabled: z.boolean(),
    exhausted: z.boolean(),
    limitUsd: z.number().nullable(),
    spentUsd: z.number().nullable(),
    usedPercent: z.number().nullable(),
  })
  .loose();

const usageSnapshotSchema = z
  .object({
    accountId: z.string(),
    extraUsage: extraUsageSchema.nullish(),
    hardLimitReached: z.boolean(),
    measuredSpendUsd: z.number().nullish(),
    observedAt: z.string(),
    provider: providerIdSchema,
    resetCredits: z
      .object({ applicable: z.number(), available: z.number() })
      .loose()
      .nullish(),
    source: z.string(),
    windows: z.array(usageWindowSchema),
  })
  .loose();

const policySchema = z
  .object({
    authorization: z.string(),
    enabled: z.boolean(),
    hiddenWindowIds: z.array(z.string()).default([]),
    hysteresisPercent: z.number(),
    maximumSnapshotAgeMilliseconds: z.number(),
    minimumDwellMilliseconds: z.number(),
    provider: providerIdSchema,
    thresholdPercent: z.number(),
  })
  .loose();

const providerStateSchema = z
  .object({
    activeAccountId: z.string().nullable(),
    generation: z.number(),
    policy: policySchema,
    provider: providerIdSchema,
    switchedAt: z.string().nullable(),
  })
  .loose();

export const dashboardSchema = z
  .object({
    accounts: z.array(accountSchema),
    providers: z.array(providerStateSchema),
    sampledAt: z.string(),
    usage: z.array(usageSnapshotSchema),
  })
  .loose();
export type Dashboard = z.infer<typeof dashboardSchema>;

const breakdownSchema = z
  .object({
    cacheCreation: z.number(),
    cached: z.number(),
    costUsd: z.number(),
    input: z.number(),
    output: z.number(),
    tokens: z.number(),
  })
  .loose();

const timeframeSchema = z
  .object({
    bucketMs: z.number(),
    buckets: z.array(z.number()),
    byProvider: z.array(breakdownSchema.extend({ provider: providerIdSchema })),
    costCacheCreation: z.number(),
    costCached: z.number(),
    costInput: z.number(),
    costOutput: z.number(),
    costUsd: z.number(),
    key: z.string(),
    models: z.array(breakdownSchema.extend({ model: z.string(), provider: providerIdSchema })),
    peakPerHour: z.number(),
    totalCacheCreation: z.number(),
    totalCached: z.number(),
    totalInput: z.number(),
    totalOutput: z.number(),
    totalTokens: z.number(),
  })
  .loose();

export const tokenAnalyticsSchema = z
  .object({
    nowPerHour: z.number(),
    timeframes: z.array(timeframeSchema),
  })
  .loose();
export type TokenAnalytics = z.infer<typeof tokenAnalyticsSchema>;

const analyticsSchema = z
  .object({
    snapshot: dashboardSchema,
    tokens: tokenAnalyticsSchema.nullish(),
  })
  .loose();

export const resetCreditsSchema = z
  .object({
    available: z.number(),
    credits: z.array(
      z
        .object({
          expiresAt: z.string().nullable(),
          id: z.string(),
          title: z.string().nullable(),
        })
        .loose(),
    ),
  })
  .loose();

export const resetOutcomeSchema = z
  .object({
    code: z.enum(["reset", "nothing_to_reset", "no_credit", "already_redeemed"]),
    windowsReset: z.number(),
  })
  .loose();

const pingSchema = z
  .object({
    processId: z.number(),
    ready: z.literal(true),
    version: z.string().optional(),
  })
  .loose();

export type PolicyPatch = {
  provider: ProviderId;
  authorizationConfirmed?: boolean;
  enabled?: boolean;
  hiddenWindowIds?: string[];
  hysteresisPercent?: number;
  minimumDwellMilliseconds?: number;
  thresholdPercent?: number;
};

export const manager = (socketPath: string) => ({
  ping: () =>
    request({ socketPath, method: "manager/ping", schema: pingSchema, timeoutMs: 1_500 }),
  dashboard: () =>
    request({ socketPath, method: "dashboard/read", schema: dashboardSchema, timeoutMs: 15_000 }),
  analytics: () =>
    request({
      socketPath,
      method: "dashboard/analytics",
      schema: analyticsSchema,
      timeoutMs: 15_000,
    }),
  refresh: () =>
    request({ socketPath, method: "usage/refresh", schema: dashboardSchema, timeoutMs: 60_000 }),
  proxyPort: () =>
    request({
      socketPath,
      method: "proxy/port",
      schema: z.object({ port: z.number() }).loose(),
      timeoutMs: 5_000,
    }).then((result) => result.port),
  switchAccount: (provider: ProviderId, targetAccountId: string) =>
    request({
      socketPath,
      method: "provider/switch",
      params: { provider, reason: "bb plugin", targetAccountId },
      schema: dashboardSchema,
      timeoutMs: 30_000,
    }),
  setPolicy: (patch: PolicyPatch) =>
    request({
      socketPath,
      method: "policy/set",
      params: patch,
      schema: z.unknown(),
      timeoutMs: 15_000,
    }),
  removeAccount: (accountId: string) =>
    request({
      socketPath,
      method: "account/remove",
      params: { accountId },
      schema: z.unknown(),
      timeoutMs: 20_000,
    }),
  resetCredits: (accountId: string) =>
    request({
      socketPath,
      method: "codex/resetCredits",
      params: { accountId },
      schema: resetCreditsSchema,
      timeoutMs: 20_000,
    }),
  consumeReset: (accountId: string) =>
    request({
      socketPath,
      method: "codex/consumeReset",
      params: { accountId },
      schema: resetOutcomeSchema,
      timeoutMs: 45_000,
    }),
});
