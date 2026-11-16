import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Switch } from "@/components/ui/switch";
import { AccountCard } from "./account-card";
import { PROVIDER_LABEL, formatDuration, pressureOf } from "./format";
import { accountPeak, poolPressure } from "./pressure";
import { RotationSettings } from "./rotation-settings";
import type { Account, ProviderId, ProviderState, UsageSnapshot } from "./types";
import type { PolicyPatch } from "./use-tokenmaxx";

type ProviderSectionProps = {
  provider: ProviderId;
  providerState: ProviderState | undefined;
  accounts: Account[];
  usage: UsageSnapshot[];
  now: number;
  pending: string | null;
  onPolicy: (patch: PolicyPatch) => void;
  onSwitch: (accountId: string) => void;
  onSignOut: (accountId: string) => void;
  onUseResetCredit: (accountId: string) => void;
};

export const ProviderSection = ({
  provider,
  providerState,
  accounts,
  usage,
  now,
  pending,
  onPolicy,
  onSwitch,
  onSignOut,
  onUseResetCredit,
}: ProviderSectionProps) => {
  const policy = providerState?.policy;
  const usageByAccount = new Map(usage.map((entry) => [entry.accountId, entry]));
  const activeAccountId = providerState?.activeAccountId ?? null;
  const ordered = [...accounts].sort((left, right) => {
    if (left.id === activeAccountId) return -1;
    if (right.id === activeAccountId) return 1;
    return (accountPeak(usageByAccount.get(left.id)) ?? -1) - (accountPeak(usageByAccount.get(right.id)) ?? -1);
  });
  const activeUsage = activeAccountId === null ? undefined : usageByAccount.get(activeAccountId);
  const activePeak = accountPeak(activeUsage);
  const pool = poolPressure(accounts, usage);
  const isAutoOn = policy?.enabled ?? false;
  const hiddenWindowIds = policy?.hiddenWindowIds ?? [];
  const labelById = new Map(
    usage.flatMap((entry) => entry.windows.map((window) => [window.id, window.label] as const)),
  );
  const hiddenWindows = hiddenWindowIds.map((id) => ({ id, label: labelById.get(id) ?? id }));

  const showWindow = (windowId: string) =>
    onPolicy({
      hiddenWindowIds: hiddenWindowIds.filter((entry) => entry !== windowId),
      provider,
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              {PROVIDER_LABEL[provider]}
              <Badge variant="secondary">
                {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
              </Badge>
            </CardTitle>
            <p className="mt-1 text-muted-foreground text-xs">
              {pool === null ? (
                <span>No usage measured yet</span>
              ) : (
                <span className="tabular-nums">
                  {Math.round(pool.usedPercent)}% used across {pool.accountCount}{" "}
                  {pool.accountCount === 1 ? "account" : "accounts"}
                </span>
              )}
              {activePeak === null ? null : (
                <span className="tabular-nums">
                  {" · active at "}
                  {Math.round(activePeak)}% ({pressureOf(activePeak)})
                </span>
              )}
              {isAutoOn && policy !== undefined ? (
                <span className="tabular-nums">
                  {" · rotates at "}
                  {policy.thresholdPercent}%
                  {policy.minimumDwellMilliseconds > 0
                    ? `, holds ${formatDuration(policy.minimumDwellMilliseconds)}`
                    : ""}
                </span>
              ) : null}
            </p>

            {hiddenWindows.length === 0 ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={pending !== null}
                    className="mt-1.5 flex items-center gap-1.5 rounded-md border border-border border-dashed px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    <Icon name="EyeOff" className="size-3" aria-hidden="true" />
                    {hiddenWindows.length} hidden{" "}
                    {hiddenWindows.length === 1 ? "window" : "windows"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {hiddenWindows.map((window) => (
                    <DropdownMenuItem key={window.id} onSelect={() => showWindow(window.id)}>
                      <Icon name="Eye" className="size-3.5" aria-hidden="true" />
                      Show {window.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onPolicy({ hiddenWindowIds: [], provider })}
                  >
                    Show all
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <label
              className="flex cursor-pointer items-center gap-2 text-sm"
              htmlFor={`auto-${provider}`}
            >
              Auto-rotate
              <Switch
                id={`auto-${provider}`}
                checked={isAutoOn}
                disabled={policy === undefined || pending !== null}
                onCheckedChange={(enabled) => onPolicy({ enabled, provider })}
              />
            </label>
            <RotationSettings
              provider={provider}
              policy={policy}
              isBusy={pending !== null}
              onPolicy={onPolicy}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5">
        {ordered.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No {PROVIDER_LABEL[provider]} accounts yet. Sign one in from the Setup tab.
          </p>
        ) : null}
        {ordered.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            usage={usageByAccount.get(account.id)}
            isActive={account.id === activeAccountId}
            hiddenWindowIds={hiddenWindowIds}
            now={now}
            pending={pending}
            onSwitch={() => onSwitch(account.id)}
            onSignOut={() => onSignOut(account.id)}
            onUseResetCredit={() => onUseResetCredit(account.id)}
            onHideWindow={(windowId) =>
              onPolicy({ hiddenWindowIds: [...hiddenWindowIds, windowId], provider })
            }
          />
        ))}
      </CardContent>
    </Card>
  );
};
