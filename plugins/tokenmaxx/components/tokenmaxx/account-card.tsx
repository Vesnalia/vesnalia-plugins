import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  HEALTHY_STATES,
  formatAge,
  formatClock,
  formatDuration,
  formatHealth,
  formatPlan,
  formatUsd,
} from "./format";
import { nextReset } from "./pressure";
import type { Account, UsageSnapshot } from "./types";
import { UsageWindows } from "./usage-windows";

type AccountCardProps = {
  account: Account;
  usage: UsageSnapshot | undefined;
  isActive: boolean;
  hiddenWindowIds: string[];
  now: number;
  pending: string | null;
  onSwitch: () => void;
  onSignOut: () => void;
  onHideWindow: (windowId: string) => void;
  onUseResetCredit: () => void;
};

export const AccountCard = ({
  account,
  usage,
  isActive,
  hiddenWindowIds,
  now,
  pending,
  onSwitch,
  onSignOut,
  onHideWindow,
  onUseResetCredit,
}: AccountCardProps) => {
  const [isConfirmingSignOut, setConfirmingSignOut] = useState(false);
  const plan = formatPlan(account.plan);
  const isUnhealthy = !HEALTHY_STATES.has(account.health);
  const resetCredits = usage?.resetCredits?.available ?? 0;
  const renewal = nextReset(usage, now);
  const isSwitching = pending === `switch-${account.id}`;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isActive ? "border-primary/60 bg-primary/5" : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {isActive ? (
              <span className="flex items-center gap-1.5 text-primary text-xs">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                Active
              </span>
            ) : null}
            <span className="truncate font-medium text-sm">{account.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            {plan === null ? null : <Badge variant="secondary">{plan}</Badge>}
            {account.auth === "apiKey" ? <Badge variant="outline">API key</Badge> : null}
            {isUnhealthy ? (
              <Badge variant="destructive">{formatHealth(account.health)}</Badge>
            ) : null}
            {usage?.hardLimitReached === true ? (
              <Badge variant="destructive">Hard limit reached</Badge>
            ) : null}
            {renewal === null ? null : (
              <span
                className="flex items-center gap-1 tabular-nums"
                title={`Fullest window: ${renewal.label} at ${Math.round(renewal.usedPercent)}% used, resets at ${formatClock(renewal.at, now)}`}
              >
                <Icon name="Clock" className="size-3" aria-hidden="true" />
                Renews in {formatDuration(renewal.at - now)}
              </span>
            )}
            {usage === undefined ? null : <span>· measured {formatAge(usage.observedAt, now)}</span>}
            {usage?.measuredSpendUsd === null || usage?.measuredSpendUsd === undefined ? null : (
              <span className="tabular-nums">· {formatUsd(usage.measuredSpendUsd)} through proxy</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {resetCredits > 0 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={onUseResetCredit}
            >
              <Icon name="Repeat" className="size-3.5" aria-hidden="true" />
              Use reset credit ({resetCredits})
            </Button>
          ) : null}
          {isActive ? null : (
            <Button size="sm" variant="outline" disabled={pending !== null} onClick={onSwitch}>
              {isSwitching ? (
                <Icon name="Spinner" className="size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Make active
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Sign out ${account.label}`}
            disabled={pending !== null}
            onClick={() => setConfirmingSignOut(true)}
          >
            <Icon name="Trash2" className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <UsageWindows
          usage={usage}
          hiddenWindowIds={hiddenWindowIds}
          now={now}
          isBusy={pending !== null}
          onHideWindow={onHideWindow}
        />
      </div>

      <AlertDialog open={isConfirmingSignOut} onOpenChange={setConfirmingSignOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out {account.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              tokenmaxx deletes this account's credential from the macOS Keychain. Sign in again
              from the Setup tab to restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingSignOut(false);
                onSignOut();
              }}
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
