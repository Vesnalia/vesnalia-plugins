import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface UsageEvent {
  seq: number;
  type: string;
  createdAt: number;
  scope: { kind: string; turnId?: string };
  data: unknown;
}

export interface Turn {
  startedAt?: number;
  completedAt?: number;
  tokens: number;
  hasUsage: boolean;
}

export interface IngestState {
  afterSeq: number;
  turns: Map<string, Turn>;
  totals: Map<string, number>;
  providerThreadId?: string;
}

export interface CalculatedTurnStat {
  threadId: string;
  turnId: string;
  durationMs: number;
  durationFormatted: string;
  tokens: number;
  tps: number;
  label: string;
  badgeText: string;
  tooltip: string;
}

export function createState(): IngestState {
  return {
    afterSeq: 0,
    turns: new Map<string, Turn>(),
    totals: new Map<string, number>(),
    providerThreadId: undefined,
  };
}

export function ingest(state: IngestState, events: UsageEvent[]): void {
  for (const e of events) {
    if (e.seq <= state.afterSeq) continue;
    state.afterSeq = e.seq;

    if (e.data && typeof e.data === "object" && "providerThreadId" in e.data) {
      const pid = e.data.providerThreadId;
      if (typeof pid === "string" && pid.length > 0) {
        state.providerThreadId = pid;
      }
    }

    const id = e.scope.kind === "turn" ? e.scope.turnId : undefined;
    const turn = id ? state.turns.get(id) ?? { tokens: 0, hasUsage: false } : undefined;
    if (id && turn) state.turns.set(id, turn);
    if (turn && e.type === "turn/started") turn.startedAt ??= e.createdAt;
    if (turn && e.type === "turn/completed") turn.completedAt = e.createdAt;
    if (e.type !== "thread/tokenUsage/updated") continue;

    if (!e.data || typeof e.data !== "object" || !("tokenUsage" in e.data)) continue;
    const usageObj = e.data.tokenUsage;
    if (!usageObj || typeof usageObj !== "object") continue;

    let total: number | undefined;
    if ("total" in usageObj && usageObj.total && typeof usageObj.total === "object" && "outputTokens" in usageObj.total) {
      const val = usageObj.total.outputTokens;
      if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
        total = val;
      }
    }

    let last: number | undefined;
    if ("last" in usageObj && usageObj.last && typeof usageObj.last === "object" && "outputTokens" in usageObj.last) {
      const val = usageObj.last.outputTokens;
      if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
        last = val;
      }
    }

    if (total === undefined || last === undefined) continue;

    let key = "default";
    if ("providerThreadId" in e.data && typeof e.data.providerThreadId === "string") {
      key = e.data.providerThreadId;
    }

    const previous = state.totals.get(key);
    // First observation or a provider counter reset: only the reported last request is attributable.
    const delta = previous === undefined || total < previous ? last : total - previous;
    state.totals.set(key, total);
    if (turn) { turn.tokens += delta; turn.hasUsage = true; }
  }
}

const sessionFileCache = new Map<string, string>();

export function getOmpSessionFile(providerThreadId: string): string | null {
  const cached = sessionFileCache.get(providerThreadId);
  if (cached && fs.existsSync(cached)) return cached;

  const sessionsDir = process.env.PI_CODING_AGENT_DIR
    ? path.join(process.env.PI_CODING_AGENT_DIR, "sessions")
    : path.join(os.homedir(), ".omp", "agent", "sessions");

  if (!fs.existsSync(sessionsDir)) return null;

  try {
    const subdirs = fs.readdirSync(sessionsDir, { withFileTypes: true });
    for (const dirent of subdirs) {
      if (!dirent.isDirectory()) continue;
      const subpath = path.join(sessionsDir, dirent.name);
      const files = fs.readdirSync(subpath);
      for (const file of files) {
        if (file.endsWith(`_${providerThreadId}.jsonl`)) {
          const resolved = path.join(subpath, file);
          sessionFileCache.set(providerThreadId, resolved);
          return resolved;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface OmpTurnStat {
  outputTokens: number;
  durationMs: number;
}

export function getOmpSessionTurns(providerThreadId: string): OmpTurnStat[] | null {
  const sessionFile = getOmpSessionFile(providerThreadId);
  if (!sessionFile) return null;

  try {
    const content = fs.readFileSync(sessionFile, "utf8");
    const turns: OmpTurnStat[] = [];
    let currentTurn: OmpTurnStat | null = null;
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as unknown;
        if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "message") continue;
        if (!("message" in entry) || !entry.message || typeof entry.message !== "object") continue;
        const msg = entry.message;
        if (!("role" in msg) || typeof msg.role !== "string") continue;

        if (msg.role === "user") {
          if (currentTurn !== null) turns.push(currentTurn);
          currentTurn = { outputTokens: 0, durationMs: 0 };
        } else if (msg.role === "assistant" && currentTurn !== null) {
          if ("usage" in msg && msg.usage && typeof msg.usage === "object" && "output" in msg.usage) {
            const out = msg.usage.output;
            if (typeof out === "number" && Number.isFinite(out) && out > 0) {
              currentTurn.outputTokens += out;
            }
          }
          if ("duration" in msg && typeof msg.duration === "number" && Number.isFinite(msg.duration) && msg.duration > 0) {
            currentTurn.durationMs += msg.duration;
          }
        }
      } catch {
        // Ignore partial/invalid line
      }
    }
    if (currentTurn !== null) turns.push(currentTurn);
    return turns;
  } catch {
    return null;
  }
}

export function turnStats(state: IngestState, threadId: string): CalculatedTurnStat[] {
  const ompTurns = state.providerThreadId ? getOmpSessionTurns(state.providerThreadId) : null;
  const turnEntries = Array.from(state.turns.entries());

  return turnEntries.map(([turnId, turn], turnIndex) => {
    if (turn.startedAt === undefined || turn.completedAt === undefined) return null;

    if (turn.hasUsage) {
      const durationMs = turn.completedAt - turn.startedAt;
      if (durationMs <= 0) return null;
      const tps = Number((turn.tokens / (durationMs / 1000)).toFixed(1));
      const seconds = durationMs / 1000;
      const durationFormatted = seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
      return {
        threadId, turnId, durationMs, durationFormatted, tokens: turn.tokens, tps,
        label: `${tps} tps`,
        badgeText: `${tps} tps · ${turn.tokens.toLocaleString()} output tok in ${durationFormatted}`,
        tooltip: `Provider-reported output tokens divided by full turn duration, including tool waits. ${turn.tokens.toLocaleString()} output tokens / ${durationFormatted} = ${tps} tok/s.`,
      };
    }

    if (ompTurns && turnIndex < ompTurns.length) {
      const ompTurn = ompTurns[turnIndex];
      if (ompTurn.outputTokens > 0 && ompTurn.durationMs > 0) {
        const durationMs = Math.round(ompTurn.durationMs);
        const tps = Number(((ompTurn.outputTokens * 1000) / ompTurn.durationMs).toFixed(1));
        const seconds = ompTurn.durationMs / 1000;
        const durationFormatted = seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
        return {
          threadId, turnId, durationMs, durationFormatted, tokens: ompTurn.outputTokens, tps,
          label: `${tps} tps`,
          badgeText: `${tps} tps · ${ompTurn.outputTokens.toLocaleString()} output tok in ${durationFormatted}`,
          tooltip: `OMP native generation speed: ${ompTurn.outputTokens.toLocaleString()} output tokens in ${durationFormatted} = ${tps} tok/s.`,
        };
      }
    }

    return null;
  }).filter((turn): turn is NonNullable<typeof turn> => turn !== null);
}
