import {
  type Dashboard,
  ManagerUnavailableError,
  type TokenAnalytics,
  manager,
} from "./manager.js";
import { resolveBinary } from "./process.js";

export type TokenmaxxState = {
  daemon: "running" | "stopped" | "missing-binary" | "error";
  daemonError: string | null;
  version: string | null;
  proxyPort: number | null;
  binaryPath: string | null;
  home: string;
  snapshot: Dashboard | null;
  tokens: TokenAnalytics | null;
};

export type StateInput = {
  socketPath: string;
  root: string;
  configuredBinary: string;
};

export const readState = async (input: StateInput): Promise<TokenmaxxState> => {
  const binaryPath = resolveBinary(input.configuredBinary);
  const client = manager(input.socketPath);
  const base = {
    binaryPath,
    home: input.root,
    proxyPort: null,
    snapshot: null,
    tokens: null,
  } satisfies Partial<TokenmaxxState>;

  try {
    const ping = await client.ping();
    const [analytics, proxyPort] = await Promise.all([
      client.analytics(),
      client.proxyPort().catch(() => null),
    ]);
    return {
      ...base,
      daemon: "running",
      daemonError: null,
      proxyPort,
      snapshot: analytics.snapshot,
      tokens: analytics.tokens ?? null,
      version: ping.version ?? null,
    };
  } catch (error) {
    if (error instanceof ManagerUnavailableError) {
      return {
        ...base,
        daemon: binaryPath === null ? "missing-binary" : "stopped",
        daemonError: binaryPath === null ? "tokenmaxx is not installed on this machine." : null,
        version: null,
      };
    }
    return {
      ...base,
      daemon: "error",
      daemonError: error instanceof Error ? error.message : String(error),
      version: null,
    };
  }
};

// Changes worth waking the UI for. Sample timestamps tick on every read, so
// they are deliberately excluded; token totals stand in for live traffic.
export const fingerprint = (state: TokenmaxxState): string =>
  JSON.stringify([
    state.daemon,
    state.version,
    state.proxyPort,
    state.binaryPath,
    state.snapshot?.providers.map((provider) => [
      provider.provider,
      provider.activeAccountId,
      provider.generation,
      provider.policy.enabled,
      provider.policy.thresholdPercent,
      provider.policy.minimumDwellMilliseconds,
      provider.policy.hysteresisPercent,
      provider.policy.hiddenWindowIds,
    ]),
    state.snapshot?.accounts.map((account) => [account.id, account.health, account.enabled]),
    state.snapshot?.usage.map((usage) => [
      usage.accountId,
      usage.hardLimitReached,
      usage.windows.map((window) => [window.id, window.usedPercent, window.resetAt]),
      usage.extraUsage?.usedPercent ?? null,
      usage.resetCredits?.available ?? null,
    ]),
    state.tokens?.timeframes.find((timeframe) => timeframe.key === "1h")?.totalTokens ?? null,
  ]);
