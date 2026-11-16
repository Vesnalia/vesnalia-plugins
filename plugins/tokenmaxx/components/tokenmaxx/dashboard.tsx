import { useEffect, useState } from "react";
import { useAliaNavigate } from "@vesnalia/plugin-sdk/app";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsView } from "./analytics-view";
import { PRESSURE_TEXT, formatAge, pressureOf } from "./format";
import { poolPressure } from "./pressure";
import { LoginDialog, type LoginRequest } from "./login-dialog";
import { ProviderSection } from "./provider-section";
import { SetupView } from "./setup-view";
import { useTokenmaxx } from "./use-tokenmaxx";

const TABS = ["accounts", "analytics", "setup"] as const;
type TabKey = (typeof TABS)[number];

const useNow = (intervalMs: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

const DaemonNotice = ({
  state,
  pending,
  onStart,
}: {
  state: ReturnType<typeof useTokenmaxx>["state"];
  pending: string | null;
  onStart: () => void;
}) => {
  if (state === null || state.daemon === "running") return null;

  if (state.daemon === "missing-binary") {
    return (
      <Card>
        <CardContent className="space-y-2 py-6">
          <p className="font-medium">tokenmaxx is not installed on this machine.</p>
          <p className="text-muted-foreground text-sm">
            Install it, then reload this panel. If it lives somewhere unusual, set the binary path
            in this plugin's settings.
          </p>
          <code className="inline-block rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-xs">
            bun add -g tokenmaxx
          </code>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <p className="font-medium text-sm">
            {state.daemon === "stopped" ? "The tokenmaxx daemon is stopped." : "tokenmaxx errored."}
          </p>
          <p className="text-muted-foreground text-sm">
            {state.daemonError ?? "Accounts and usage appear once the daemon is running."}
          </p>
        </div>
        <Button size="sm" disabled={pending !== null} onClick={onStart}>
          <Icon name="Play" className="size-3.5" aria-hidden="true" />
          Start daemon
        </Button>
      </CardContent>
    </Card>
  );
};

export const Dashboard = ({ subPath }: { subPath: string }) => {
  const { actions, isLoading, loadError, pending, reload, state } = useTokenmaxx();
  const navigate = useAliaNavigate();
  const now = useNow(30_000);
  const [login, setLogin] = useState<LoginRequest | null>(null);

  const requested = subPath.split("/")[0] ?? "";
  const tab: TabKey = (TABS as readonly string[]).includes(requested)
    ? (requested as TabKey)
    : "accounts";

  const snapshot = state?.snapshot ?? null;
  const pool = snapshot === null ? null : poolPressure(snapshot.accounts, snapshot.usage);
  const providerState = (provider: "anthropic" | "openai") =>
    snapshot?.providers.find((entry) => entry.provider === provider);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
            {state === null ? null : (
              <>
                <Badge variant={state.daemon === "running" ? "secondary" : "destructive"}>
                  {state.daemon === "running" ? "Daemon running" : "Daemon down"}
                </Badge>
                {pool === null ? null : (
                  <span className="tabular-nums">
                    <span className={cn("font-medium", PRESSURE_TEXT[pressureOf(pool.usedPercent)])}>
                      {Math.round(pool.usedPercent)}% used
                    </span>{" "}
                    across {pool.accountCount} {pool.accountCount === 1 ? "account" : "accounts"}
                  </span>
                )}
                {state.proxyPort === null ? null : (
                  <span className="tabular-nums">· 127.0.0.1:{state.proxyPort}</span>
                )}
                {snapshot === null ? null : (
                  <span>· sampled {formatAge(snapshot.sampledAt, now)}</span>
                )}
              </>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== null || state?.daemon !== "running"}
            onClick={() => void actions.refresh()}
          >
            <Icon
              name={pending === "refresh" ? "Spinner" : "ArrowReloadHorizontal"}
              className={pending === "refresh" ? "size-3.5 animate-spin" : "size-3.5"}
              aria-hidden="true"
            />
            Re-probe usage
          </Button>
        </div>

        {loadError === null ? null : (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-destructive text-sm">{loadError}</p>
              <Button size="sm" variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : null}

        {state === null ? null : (
          <>
            <DaemonNotice
              state={state}
              pending={pending}
              onStart={() => void actions.daemon("start")}
            />

            <Tabs
              value={tab}
              onValueChange={(next) =>
                navigate.toPluginPanel("tokenmaxx", {
                  subPath: next === "accounts" ? "" : next,
                })
              }
            >
              <TabsList>
                <TabsTrigger value="accounts">Accounts</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="setup">Setup</TabsTrigger>
              </TabsList>

              <TabsContent value="accounts" className="space-y-4 pt-4">
                {(["anthropic", "openai"] as const).map((provider) => (
                  <ProviderSection
                    key={provider}
                    provider={provider}
                    providerState={providerState(provider)}
                    accounts={
                      snapshot?.accounts.filter((account) => account.provider === provider) ?? []
                    }
                    usage={snapshot?.usage.filter((entry) => entry.provider === provider) ?? []}
                    now={now}
                    pending={pending}
                    onPolicy={(patch) => void actions.setPolicy(patch)}
                    onSwitch={(accountId) => void actions.switchAccount({ accountId, provider })}
                    onSignOut={(accountId) => void actions.removeAccount(accountId)}
                    onUseResetCredit={(accountId) => {
                      void actions.consumeReset(accountId).then((outcome) => {
                        if (outcome === null) return;
                        toast.success(
                          outcome.code === "reset"
                            ? `Reset ${outcome.windowsReset} window${outcome.windowsReset === 1 ? "" : "s"}.`
                            : `Nothing to reset (${outcome.code.replace(/_/g, " ")}).`,
                        );
                      });
                    }}
                  />
                ))}
              </TabsContent>

              <TabsContent value="analytics" className="pt-4">
                <AnalyticsView tokens={state.tokens} />
              </TabsContent>

              <TabsContent value="setup" className="pt-4">
                <SetupView
                  state={state}
                  pending={pending}
                  actions={actions}
                  onLogin={setLogin}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <LoginDialog
        request={login}
        onClose={(didFinish) => {
          setLogin(null);
          if (didFinish) void reload();
        }}
      />
    </div>
  );
};
