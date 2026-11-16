import type { Account, UsageSnapshot } from "./types";

// tokenmaxx measures pressure on hard windows; spend windows track money, not
// headroom, so they stay out of it.
export const accountPeak = (usage: UsageSnapshot | undefined): number | null => {
  if (usage === undefined) return null;
  const hard = usage.windows.filter((window) => window.kind === "hard");
  const considered = hard.length > 0 ? hard : usage.windows;
  if (considered.length === 0) return null;
  return considered.reduce((highest, window) => Math.max(highest, window.usedPercent), 0);
};

export type Pool = {
  usedPercent: number;
  accountCount: number;
};

// How full the pool is: every account that can still serve a request counts
// once, at its own fullest window. An account with no measurement yet is not
// counted, so an unmeasured account cannot read as free capacity.
export const poolPressure = (
  accounts: readonly Account[],
  usage: readonly UsageSnapshot[],
): Pool | null => {
  const usageByAccount = new Map(usage.map((entry) => [entry.accountId, entry]));
  const peaks = accounts
    .filter((account) => account.enabled)
    .map((account) => accountPeak(usageByAccount.get(account.id)))
    .filter((peak): peak is number => peak !== null);

  if (peaks.length === 0) return null;
  return {
    accountCount: peaks.length,
    usedPercent: peaks.reduce((total, peak) => total + peak, 0) / peaks.length,
  };
};

export type NextReset = {
  at: number;
  label: string;
  usedPercent: number;
};

// When this account gets headroom back: the reset of its fullest window, not
// its soonest one. An account capped on a weekly window is not usable again
// when its 5-hour window rolls over. Windows without a reset time never renew
// on a schedule, so they are skipped.
export const nextReset = (usage: UsageSnapshot | undefined, now: number): NextReset | null => {
  if (usage === undefined) return null;
  const hard = usage.windows.filter((window) => window.kind === "hard");
  const considered = hard.length > 0 ? hard : usage.windows;

  return (
    considered
      .flatMap((window) => {
        if (window.resetAt === null) return [];
        const at = Date.parse(window.resetAt);
        if (Number.isNaN(at) || at <= now) return [];
        return [{ at, label: window.label, usedPercent: window.usedPercent }];
      })
      .sort((left, right) =>
        left.usedPercent === right.usedPercent
          ? left.at - right.at
          : right.usedPercent - left.usedPercent,
      )[0] ?? null
  );
};
