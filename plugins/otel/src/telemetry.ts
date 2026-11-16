import type { FinishedTurn } from "./fold.js";
import { DURATION_BOUNDS, Meter, SpanQueue, TOKEN_BOUNDS, type Attrs } from "./otlp.js";
import { threadSpanIdOf, traceIdOf, turnSpanIdOf } from "./ids.js";

export interface ThreadCtx {
  threadId: string;
  projectId: string;
  projectName?: string;
  environmentId: string | null;
  providerId: string;
  parentThreadId: string | null;
  rootThreadId: string;
  originPluginId: string | null;
  /** The VesnALIA machine (host) the thread's environment runs on, when known. */
  machineId?: string;
  machineName?: string;
}

export interface Enabled {
  traces: boolean;
  metrics: boolean;
}

// Only harnesses whose model vendor is certain are named; anything else leaves the attribute out.
const VENDOR: Record<string, string> = { "claude-code": "anthropic", codex: "openai" };

export class Telemetry {
  readonly meter = new Meter();
  readonly queue = new SpanQueue();

  constructor(private isEnabled: () => Enabled) {
    const m = this.meter;
    m.describe("gen_ai.client.token.usage", "{token}", "Input and output tokens per VesnALIA turn");
    m.describe("gen_ai.client.operation.duration", "s", "Duration of a VesnALIA turn");
    m.describe("alia.gen_ai.client.cache_tokens", "{token}", "Cache read and write tokens per VesnALIA turn");
    m.describe("alia.gen_ai.client.cost", "USD", "Cost the provider reported for VesnALIA turns");
    m.describe("alia.turns", "{turn}", "Finished VesnALIA turns");
    m.describe("alia.thread.transitions", "{event}", "alia thread lifecycle events");
    m.describe("alia.thread.active.duration", "s", "Time a VesnALIA thread stayed active");
    m.describe("alia.automation.runs", "{run}", "Finished threads started by automations");
    m.describe("alia.provider.usage.used_percent", "%", "Provider quota window used");
    m.describe("alia.provider.usage.reset_time", "s", "Provider quota window reset, unix seconds");
    m.describe("alia.provider.usage.cost_used", "USD", "Spend in a provider quota window");
    m.describe("alia.provider.usage.cost_limit", "USD", "Spend limit of a provider quota window");
  }

  static spanAttrs(c: ThreadCtx): Attrs {
    return {
      "alia.thread.id": c.threadId,
      "alia.project.id": c.projectId,
      "alia.project.name": c.projectName,
      "alia.environment.id": c.environmentId ?? undefined,
      "alia.machine.id": c.machineId,
      "alia.machine.name": c.machineName,
      "alia.provider.id": c.providerId,
      "alia.parent_thread.id": c.parentThreadId ?? undefined,
      "alia.root_thread.id": c.rootThreadId,
      "alia.origin.plugin": c.originPluginId ?? undefined,
      "alia.automation.run": c.originPluginId === "automations" ? true : undefined,
    };
  }

  turn(c: ThreadCtx, t: FinishedTurn) {
    const model = t.model ?? "unknown";
    const failed = t.status === "failed";
    const seconds = Math.max(0, t.endedAt - t.startedAt) / 1000;
    const enabled = this.isEnabled();
    if (enabled.traces)
      this.queue.push({
        traceId: traceIdOf(c.rootThreadId),
        spanId: turnSpanIdOf(c.threadId, t.startedAt, t.startSeq),
        parentSpanId: threadSpanIdOf(c.threadId),
        name: `chat ${model}`,
        startMs: t.startedAt,
        endMs: t.endedAt,
        error: failed,
        attrs: {
          ...Telemetry.spanAttrs(c),
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": model,
          "gen_ai.provider.name": VENDOR[c.providerId],
          "gen_ai.usage.input_tokens": t.tokens.input,
          "gen_ai.usage.output_tokens": t.tokens.output,
          "gen_ai.usage.cache_read.input_tokens": t.tokens.cacheRead,
          "gen_ai.usage.cache_creation.input_tokens": t.tokens.cacheWrite,
          "alia.usage.reasoning_tokens": t.tokens.reasoning,
          "alia.cost.usd": t.usd || undefined,
          "alia.turn.status": t.status,
          "alia.turn.initiator": t.initiator ?? undefined,
          // The provider's own session id: Claude Code reports it as session.id.
          "session.id": t.providerThreadId ?? undefined,
          "error.type": failed ? "turn_failed" : undefined,
        },
      });
    if (!enabled.metrics) return;
    const base: Attrs = {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model,
      "gen_ai.provider.name": VENDOR[c.providerId],
      "alia.provider.id": c.providerId,
      "alia.project.id": c.projectId,
      "alia.machine.name": c.machineName,
    };
    const m = this.meter;
    m.record("gen_ai.client.token.usage", { ...base, "gen_ai.token.type": "input" }, t.tokens.input, TOKEN_BOUNDS);
    m.record("gen_ai.client.token.usage", { ...base, "gen_ai.token.type": "output" }, t.tokens.output, TOKEN_BOUNDS);
    m.add("alia.gen_ai.client.cache_tokens", { ...base, "alia.cache.type": "read" }, t.tokens.cacheRead);
    m.add("alia.gen_ai.client.cache_tokens", { ...base, "alia.cache.type": "write" }, t.tokens.cacheWrite);
    if (t.usd > 0) m.add("alia.gen_ai.client.cost", base, t.usd);
    m.record("gen_ai.client.operation.duration", { ...base, "error.type": failed ? "turn_failed" : undefined }, seconds, DURATION_BOUNDS);
    m.add("alia.turns", { ...base, "alia.turn.status": t.status }, 1);
  }

  /** A thread lifecycle event; `activeMs` is set when an active stretch ended. */
  lifecycle(c: ThreadCtx, state: string, activeMs?: number) {
    if (!this.isEnabled().metrics) return;
    const where: Attrs = { "alia.provider.id": c.providerId, "alia.project.id": c.projectId, "alia.machine.name": c.machineName };
    this.meter.add("alia.thread.transitions", { ...where, "alia.thread.state": state }, 1);
    if (activeMs !== undefined) this.meter.record("alia.thread.active.duration", where, activeMs / 1000, DURATION_BOUNDS);
    if (c.originPluginId === "automations" && (state === "idle" || state === "failed"))
      this.meter.add("alia.automation.runs", { "alia.thread.state": state, "alia.project.id": c.projectId, "alia.machine.name": c.machineName }, 1);
  }

  /** The thread's own span, children of its parent's span; sent once when it is archived or deleted. */
  threadSpan(c: ThreadCtx, createdAt: number, endedAt: number, state: string) {
    if (!this.isEnabled().traces) return;
    this.queue.push({
      traceId: traceIdOf(c.rootThreadId),
      spanId: threadSpanIdOf(c.threadId),
      parentSpanId: c.parentThreadId ? threadSpanIdOf(c.parentThreadId) : undefined,
      name: "alia.thread",
      startMs: createdAt,
      endMs: endedAt,
      attrs: { ...Telemetry.spanAttrs(c), "alia.thread.final_state": state },
    });
  }
}

export interface UsageWindowInput {
  machineId: string;
  machineName?: string;
  /** A one-way hash of the account login, never the login itself. */
  accountHash?: string;
  providerId: string;
  planLabel: string | null;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  cost: { usedUsdCents: number; limitUsdCents: number } | null;
}

/** Sets the provider quota gauges. The account email is not exported, only a hash of it. */
export function setUsageGauges(meter: Meter, windows: readonly UsageWindowInput[]) {
  const attrs = (w: UsageWindowInput): Attrs => ({
    "alia.machine.id": w.machineId,
    "alia.machine.name": w.machineName,
    "alia.provider.account": w.accountHash,
    "alia.provider.id": w.providerId,
    "alia.provider.plan": w.planLabel ?? undefined,
    "alia.usage.window": w.label,
  });
  meter.setGauges("alia.provider.usage.used_percent", windows.map((w) => ({ attrs: attrs(w), value: w.usedPercent })));
  meter.setGauges(
    "alia.provider.usage.reset_time",
    windows.flatMap((w) => {
      const t = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
      return Number.isFinite(t) ? [{ attrs: attrs(w), value: t / 1000 }] : [];
    }),
  );
  meter.setGauges("alia.provider.usage.cost_used", windows.flatMap((w) => (w.cost ? [{ attrs: attrs(w), value: w.cost.usedUsdCents / 100 }] : [])));
  meter.setGauges("alia.provider.usage.cost_limit", windows.flatMap((w) => (w.cost ? [{ attrs: attrs(w), value: w.cost.limitUsdCents / 100 }] : [])));
}
