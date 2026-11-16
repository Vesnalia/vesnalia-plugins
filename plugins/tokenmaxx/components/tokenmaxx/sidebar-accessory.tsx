import { cn } from "@/lib/utils";
import { PRESSURE_TEXT, pressureOf } from "./format";
import { poolPressure } from "./pressure";
import { useTokenmaxx } from "./use-tokenmaxx";

// The sidebar row is 4rem wide: one number, no controls.
export const SidebarAccessory = () => {
  const { state } = useTokenmaxx();
  const snapshot = state?.snapshot ?? null;
  if (snapshot === null) return null;

  const pool = poolPressure(snapshot.accounts, snapshot.usage);
  if (pool === null) return null;

  return (
    <span
      className={cn("text-xs tabular-nums", PRESSURE_TEXT[pressureOf(pool.usedPercent)])}
      title={`Your accounts are ${Math.round(pool.usedPercent)}% used across ${pool.accountCount} ${pool.accountCount === 1 ? "account" : "accounts"}`}
    >
      {Math.round(pool.usedPercent)}%
    </span>
  );
};
