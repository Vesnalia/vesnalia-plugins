// Thread limit (§3.9.5). VesnALIA limits concurrently running threads globally and
// per host, but the Plugin SDK 0.5.29 exposes no read access to that limit
// (no concurrency field anywhere in bundled-types/alia-plugin-sdk.d.ts; the
// limit is behind `alia concurrency-limit status --json`). The server reads it
// from that CLI; if the CLI is not reachable the limit is unknown and nothing
// is throttled. The plugin never changes VesnALIA's limit.
//
// `alia crew thread-limit <n>` sets a plugin-side limit instead. It only makes
// the plugin hold back its own deliveries (status `throttled`); VesnALIA's setting
// stays untouched. Useful to demo the behaviour without touching a global
// setting, and for teams that want crews to leave room for other work.
import type { Store } from "./store";

export const LIMIT_SETTING = "threadLimit";

export type LimitReading = { limit: number | null; source: "plugin" | "alia" | "unknown" };

/** `alia concurrency-limit status --json` → the tighter of the global and the host limits. */
export function parseLimitStatus(text: string): number | null {
  try {
    const status = JSON.parse(text) as { globalLimit?: number | null; hosts?: { effectiveLimit?: number | null; status?: string }[] };
    const limits = [
      ...(typeof status.globalLimit === "number" ? [status.globalLimit] : []),
      ...(status.hosts ?? [])
        .filter((host) => host.status === undefined || host.status === "connected")
        .map((host) => host.effectiveLimit)
        .filter((value): value is number => typeof value === "number"),
    ];
    return limits.length > 0 ? Math.min(...limits) : null;
  } catch {
    return null;
  }
}

export async function readLimit(store: Store, aliaLimit: (() => Promise<number | null>) | null): Promise<LimitReading> {
  const own = store.getSetting(LIMIT_SETTING);
  if (own !== null && Number.isFinite(Number(own))) return { limit: Number(own), source: "plugin" };
  const limit = aliaLimit ? await aliaLimit().catch(() => null) : null;
  return limit === null ? { limit: null, source: "unknown" } : { limit, source: "alia" };
}

/** Members of the project's running crews, with this crew's members counted as planned. */
export function plannedThreads(store: Store, projectId: string, crewName: string, members: number): number {
  const others = store
    .listCrews(projectId)
    .filter((crew) => crew.name !== crewName && (crew.status === "running" || crew.status === "degraded" || crew.status === "starting"))
    .reduce((sum, crew) => sum + store.listMembers(crew.id).length, 0);
  return others + members;
}

export function limitLine(threads: number, reading: LimitReading): { text: string; over: boolean } {
  if (reading.limit === null) return { text: `Threads: ${threads} members in running crews; VesnALIA's thread limit is not readable here`, over: false };
  const over = threads > reading.limit;
  const source = reading.source === "plugin" ? "plugin limit (VesnALIA crew thread-limit)" : "VesnALIA limit";
  return {
    text: `Threads: ${threads} members in running crews vs ${source} ${reading.limit}${over ? ` — ${threads - reading.limit} deliveries will wait as throttled` : ""}`,
    over,
  };
}
