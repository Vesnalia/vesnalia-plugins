import type { ProviderId } from "./types";

const compact = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
});
const cents = new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 4,
  minimumFractionDigits: 2,
  style: "currency",
});

export const formatTokens = (value: number): string => compact.format(value);
export const formatCount = (value: number): string => whole.format(value);
export const formatUsd = (value: number): string =>
  value > 0 && value < 0.01 ? cents.format(value) : money.format(value);

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: "Claude",
  openai: "Codex",
};

export const PROVIDER_CLI: Record<ProviderId, "claude" | "codex"> = {
  anthropic: "claude",
  openai: "codex",
};

const PLAN_LABEL: Record<string, string> = {
  default_claude_max_5x: "Max 5×",
  default_claude_max_20x: "Max 20×",
  default_claude_pro: "Pro",
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  team: "Team",
};

export const formatPlan = (plan: string | null | undefined): string | null => {
  if (plan === null || plan === undefined || plan.trim().length === 0) return null;
  return PLAN_LABEL[plan] ?? plan.replace(/^default_(claude_)?/, "").replace(/_/g, " ");
};

export const formatHealth = (health: string): string =>
  health.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());

export const HEALTHY_STATES = new Set(["ready", "refreshDue", "refreshing", "unchecked"]);

export const formatDuration = (milliseconds: number): string => {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
};

export const formatReset = (resetAt: string | null, now: number): string | null => {
  if (resetAt === null) return null;
  const target = Date.parse(resetAt);
  if (Number.isNaN(target)) return null;
  return target <= now ? "resetting" : `resets in ${formatDuration(target - now)}`;
};

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const clockWithDay = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  weekday: "short",
});

export const formatClock = (at: number, now: number): string =>
  (at - now > 20 * 3_600_000 ? clockWithDay : clock).format(new Date(at));

export const formatAge = (iso: string, now: number): string => {
  const observed = Date.parse(iso);
  if (Number.isNaN(observed)) return "unknown";
  const seconds = Math.max(0, Math.round((now - observed) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${formatDuration(seconds * 1_000)} ago`;
};

export type Pressure = "idle" | "steady" | "elevated" | "critical";

export const pressureOf = (usedPercent: number): Pressure => {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 70) return "elevated";
  if (usedPercent >= 25) return "steady";
  return "idle";
};

// Theme tokens only, so a custom palette can restyle every bar.
export const PRESSURE_BAR: Record<Pressure, string> = {
  critical: "bg-destructive",
  elevated: "bg-destructive/55",
  steady: "bg-primary",
  idle: "bg-primary/45",
};

export const PRESSURE_TEXT: Record<Pressure, string> = {
  critical: "text-destructive",
  elevated: "text-destructive/80",
  steady: "text-foreground",
  idle: "text-muted-foreground",
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
