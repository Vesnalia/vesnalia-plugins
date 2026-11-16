import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PRESSURE_BAR, PRESSURE_TEXT, formatClock, formatReset, formatUsd, pressureOf } from "./format";
import type { UsageSnapshot } from "./types";

type UsageWindowsProps = {
  usage: UsageSnapshot | undefined;
  hiddenWindowIds: string[];
  now: number;
  isBusy: boolean;
  onHideWindow: (windowId: string) => void;
};

export const UsageBar = ({ usedPercent }: { usedPercent: number }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
    <div
      className={cn(
        "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
        PRESSURE_BAR[pressureOf(usedPercent)],
      )}
      style={{ width: `${Math.min(100, Math.max(usedPercent, usedPercent > 0 ? 2 : 0))}%` }}
    />
  </div>
);

export const UsageWindows = ({
  usage,
  hiddenWindowIds,
  now,
  isBusy,
  onHideWindow,
}: UsageWindowsProps) => {
  if (usage === undefined) {
    return (
      <p className="text-muted-foreground text-xs">
        No usage measured yet. Run a request, or refresh.
      </p>
    );
  }

  const extra = usage.extraUsage;
  const visible = usage.windows.filter((window) => !hiddenWindowIds.includes(window.id));

  return (
    <div className="space-y-2.5">
      {usage.windows.length === 0 ? (
        <p className="text-muted-foreground text-xs">This account reports no rate-limit windows.</p>
      ) : null}
      {usage.windows.length > 0 && visible.length === 0 ? (
        <p className="text-muted-foreground text-xs">Every window is hidden.</p>
      ) : null}

      {visible.map((window) => {
        const reset = formatReset(window.resetAt, now);
        const pressure = pressureOf(window.usedPercent);
        return (
          <div key={window.id} className="group space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-muted-foreground">{window.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                {reset === null ? null : (
                  <span
                    className="text-muted-foreground tabular-nums"
                    title={
                      window.resetAt === null
                        ? undefined
                        : `Resets at ${formatClock(Date.parse(window.resetAt), now)}`
                    }
                  >
                    {reset}
                  </span>
                )}
                <span className={cn("font-medium tabular-nums", PRESSURE_TEXT[pressure])}>
                  {Math.round(window.usedPercent)}%
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Hide ${window.label}`}
                      disabled={isBusy}
                      onClick={() => onHideWindow(window.id)}
                      className="rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 group-hover:opacity-100"
                    >
                      <Icon name="EyeOff" className="size-3.5" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Hide this window everywhere</TooltipContent>
                </Tooltip>
              </span>
            </div>
            <UsageBar usedPercent={window.usedPercent} />
          </div>
        );
      })}

      {extra !== null && extra !== undefined && extra.enabled ? (
        <div className="space-y-1 border-border/60 border-t pt-2">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">
              Extra credits{extra.exhausted ? " · exhausted" : ""}
            </span>
            <span className="tabular-nums">
              {extra.spentUsd === null ? "unknown" : formatUsd(extra.spentUsd)}
              {extra.limitUsd === null ? "" : ` / ${formatUsd(extra.limitUsd)}`}
            </span>
          </div>
          {extra.usedPercent === null ? null : <UsageBar usedPercent={extra.usedPercent} />}
        </div>
      ) : null}
    </div>
  );
};
