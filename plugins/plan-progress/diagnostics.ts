export const DIAGNOSTICS_CHANGED = "diagnostics-changed";
export type ProgressSource = "alia" | "claude-original" | null;
export interface ProgressDiagnostic {
  source: ProgressSource;
  lastCallSeq: number;
  warning: string | null;
  lastOutcome?: "completed" | "failed" | "unknown";
  lastCallAt?: number | null;
}
export const NO_DIAGNOSTIC: ProgressDiagnostic = { source: null, lastCallSeq: 0, warning: null };

/** Native helper events can have an agent scope without parentToolCallId. */
export function isMainEvent(event: unknown): boolean {
  const row = event as { scope?: { kind?: string }; data?: { parentToolCallId?: unknown; item?: {parentToolCallId?: unknown} } } | null;
  return !!row && (!row.scope || row.scope.kind === "turn") &&
    !row.data?.parentToolCallId && !row.data?.item?.parentToolCallId;
}

/** VesnALIA's ACP code wrapper records inner calls as metadata, without retaining
 * their arguments here. Outer completion can contain caught inner failures. */
function batchProgress(event: unknown): {source: ProgressSource; outcome: "completed" | "failed" | "unknown"} | null {
  const row = event as {type?: string; data?: {item?: {type?: string; server?: string;
    result?: {metadata?: {toolCalls?: {tool?: string; status?: string}[]; truncated?: boolean}}}}} | null;
  const item = row?.data?.item;
  if (row?.type !== "item/completed" || !isMainEvent(row) || item?.type !== "toolCall" ||
      !["alia", "alia-bridge"].includes(item.server ?? "")) return null;
  const meta = item.result?.metadata;
  if (!Array.isArray(meta?.toolCalls)) return null;
  for (const call of meta.toolCalls.slice(-100).reverse()) {
    const source = call?.tool === "alia-bridge.plan_progress" || call?.tool === "alia.plan_progress" ? "alia" :
      call?.tool === "plan-progress.plan_progress" ? "claude-original" : null;
    if (source) return {source, outcome: meta.truncated ? "unknown" :
      call.status === "error" || call.status === "failed" ? "failed" :
      call.status === "completed" ? "completed" : "unknown"};
  }
  return null;
}

export function progressOutcome(event: unknown): "completed" | "failed" | "unknown" {
  const batch = batchProgress(event);
  if (batch) return batch.outcome;
  const row = event as {data?: {item?: {status?: string; result?: {isError?: boolean; metadata?: {toolCalls?: unknown}}}}};
  const item = row.data?.item;
  if (Array.isArray(item?.result?.metadata?.toolCalls)) return "unknown";
  return item?.status === "failed" || item?.result?.isError === true ? "failed" :
    item?.status === "completed" ? "completed" : "unknown";
}

// Only main-agent completed tool calls count. Subagents have their own progress.
export function progressSource(event: unknown): ProgressSource {
  const row = event as { type?: string; data?: { item?: {
    type?: string; tool?: string; server?: string; result?: unknown;
    presentation?: {icon?: {glyph?: string}};
  } } } | null;
  if (row?.type !== "item/completed" || !isMainEvent(row)) return null;
  const item = row.data?.item;
  if (item?.type !== "toolCall") return null;
  const batch = batchProgress(row);
  if (batch) return batch.source;
  if (item.tool === "mcp__plan-progress__plan_progress" ||
    (item.tool === "plan_progress" && item.server === "plan-progress")) return "claude-original";
  if (item.tool === "mcp__alia-bridge__plan_progress" ||
    (item.tool === "plan_progress" && typeof item.result === "string" && item.result.startsWith("ALIA/")) ||
    (item.tool === "plan_progress" && (item.server === "alia-bridge" || item.server === "alia" ||
      item.presentation?.icon?.glyph === "ListTodo"))) return "alia";
  return null;
}

export function advanceDiagnostic(previous: ProgressDiagnostic, events: unknown[]): ProgressDiagnostic {
  let next = previous;
  for (const event of events) {
    const row = event as { seq?: number; createdAt?: number; data?: {item?: {status?: string; result?: {isError?: boolean}}} };
    const source = progressSource(event);
    if (!source || typeof row.seq !== "number" || row.seq <= next.lastCallSeq) continue;
    next = {
      source, lastCallSeq: row.seq,
      lastOutcome: progressOutcome(event),
      lastCallAt: typeof row.createdAt === "number" ? row.createdAt : null,
      warning: source === "claude-original"
        ? "The agent sent its plan to the Claude Code plugin. Use the VesnALIA progress tool to show it here."
        : null,
    };
  }
  return next;
}
