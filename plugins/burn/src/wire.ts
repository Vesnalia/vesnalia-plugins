import type { BudgetPolicy } from "./budget.js";
import type { UsageReport } from "./report.js";

/** What the pi extension POSTs to the VesnALIA plugin after each change. */
export interface UsageEnvelope {
  threadId: string;
  sentAt: number;
  report: UsageReport;
}

/**
 * The VesnALIA plugin's answer. `policy` is the thread's budget as VesnALIA sees it (its
 * per-thread budget, else the plugin setting); pi applies it in place of its
 * own `/burn budget`, except that a null VesnALIA budget falls back to pi's.
 */
export type UsageReply = { ok: true; policy?: BudgetPolicy } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The policy in a reply, or null when it carries none or a malformed one. Never throws. */
export function readPolicy(body: unknown): BudgetPolicy | null {
  if (!isRecord(body) || body.ok !== true || !isRecord(body.policy)) return null;
  const { budget, stopAtBudget, notifyExpensiveTurn } = body.policy;
  const validBudget = budget === null || (typeof budget === "number" && Number.isFinite(budget) && budget > 0);
  if (!validBudget || typeof stopAtBudget !== "boolean" || typeof notifyExpensiveTurn !== "boolean") return null;
  return { budget: budget as number | null, stopAtBudget, notifyExpensiveTurn };
}
