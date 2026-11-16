import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { LoginRequest } from "./login-dialog";
import type { TokenmaxxState } from "./types";
import type { useTokenmaxx } from "./use-tokenmaxx";

type DoctorCheck = { detail: string; name: string; status: string };

const STATUS_TONE: Record<string, string> = {
  missing: "text-destructive",
  note: "text-muted-foreground",
  ok: "text-primary",
  running: "text-primary",
  state: "text-muted-foreground",
  stopped: "text-destructive",
  warning: "text-destructive",
};

type SetupViewProps = {
  state: TokenmaxxState;
  pending: string | null;
  actions: ReturnType<typeof useTokenmaxx>["actions"];
  onLogin: (request: LoginRequest) => void;
};

export const SetupView = ({ state, pending, actions, onLogin }: SetupViewProps) => {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [raw, setRaw] = useState("");
  const [commandOutput, setCommandOutput] = useState<string | null>(null);

  const runDoctor = useCallback(async () => {
    const result = await actions.doctor();
    if (result === null) return;
    setChecks(result.checks);
    setRaw(result.raw);
  }, [actions]);

  useEffect(() => {
    void runDoctor();
    // Deliberately once per mount: doctor spawns the tokenmaxx CLI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // doctor prints a tool-version line before the routing line for both codex
  // and claude, so routing state is the last check under that name.
  const routingCheck = (name: string): DoctorCheck | undefined =>
    checks?.filter((check) => check.name === name).at(-1);

  const changeRouting = async (input: {
    action: "install" | "uninstall";
    target: "native" | "pi";
  }) => {
    const result = await actions.routing(input);
    if (result === null) return;
    setCommandOutput(result.output.trim());
    await runDoctor();
  };

  const isDaemonRunning = state.daemon === "running";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Daemon</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant={isDaemonRunning ? "secondary" : "destructive"}>
                  {isDaemonRunning
                    ? "Running"
                    : state.daemon === "missing-binary"
                      ? "Not installed"
                      : state.daemon === "stopped"
                        ? "Stopped"
                        : "Error"}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="tabular-nums">{state.version ?? "unknown"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Proxy</dt>
              <dd className="tabular-nums">
                {state.proxyPort === null ? "not listening" : `127.0.0.1:${state.proxyPort}`}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Binary</dt>
              <dd className="truncate font-mono text-xs">{state.binaryPath ?? "not found"}</dd>
            </div>
            <div className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-muted-foreground">Home</dt>
              <dd className="truncate font-mono text-xs">{state.home}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null || state.daemon === "missing-binary"}
              onClick={() => void actions.daemon(isDaemonRunning ? "stop" : "start")}
            >
              <Icon
                name={isDaemonRunning ? "Square" : "Play"}
                className="size-3.5"
                aria-hidden="true"
              />
              {isDaemonRunning ? "Stop daemon" : "Start daemon"}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => void runDoctor()}>
              <Icon name="Beaker" className="size-3.5" aria-hidden="true" />
              Re-run doctor
            </Button>
          </div>

          {state.daemonError === null ? null : (
            <p className="text-destructive text-sm">{state.daemonError}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Signing in runs the provider's own login in a bb terminal. Credentials go straight to
            the macOS Keychain.
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { cli: "claude", label: "Claude" },
                { cli: "codex", label: "Codex" },
              ] as const
            ).map((entry) => (
              <div key={entry.cli} className="flex items-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-r-none"
                  disabled={state.daemon === "missing-binary"}
                  onClick={() => onLogin({ apiKey: false, provider: entry.cli })}
                >
                  <Icon name="UserRoundPlus" className="size-3.5" aria-hidden="true" />
                  Sign in to {entry.label}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-l-none border-l-0 px-2"
                      aria-label={`More ${entry.label} sign-in options`}
                      disabled={state.daemon === "missing-binary"}
                    >
                      <Icon name="ChevronDown" className="size-3.5" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => onLogin({ apiKey: true, provider: entry.cli })}
                    >
                      Sign in with an API key
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Routing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Routing rewrites the native CLI configs so codex and claude send requests through the
            tokenmaxx proxy.
          </p>

          <div className="space-y-2">
            {(
              [
                { key: "native", names: ["codex", "claude"], title: "codex & claude" },
                { key: "pi", names: ["pi"], title: "pi" },
              ] as const
            ).map((row) => {
              const rowChecks = row.names
                .map((name) => routingCheck(name))
                .filter((check): check is DoctorCheck => check !== undefined);
              const isRouted = rowChecks.length > 0 && rowChecks.every((check) => check.status === "ok");
              return (
                <div
                  key={row.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{row.title}</div>
                    <div className="text-muted-foreground text-xs">
                      {rowChecks.length === 0
                        ? "Run doctor to read the current state."
                        : rowChecks.map((check) => check.detail).join(" · ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={isRouted ? "secondary" : "outline"}>
                      {isRouted ? "Routed" : "Not routed"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending !== null || state.daemon === "missing-binary"}
                      onClick={() =>
                        void changeRouting({
                          action: isRouted ? "uninstall" : "install",
                          target: row.key,
                        })
                      }
                    >
                      {isRouted ? "Undo routing" : "Route through tokenmaxx"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {commandOutput === null || commandOutput.length === 0 ? null : (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
              {commandOutput}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Doctor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks === null ? (
            <p className="text-muted-foreground text-sm">Running doctor…</p>
          ) : (
            <ul className="space-y-1.5">
              {checks.map((check, index) => (
                <li key={`${check.name}-${index}`} className="flex gap-3 text-sm">
                  <span
                    className={cn(
                      "w-16 shrink-0 font-medium text-xs uppercase tracking-wide",
                      STATUS_TONE[check.status] ?? "text-muted-foreground",
                    )}
                  >
                    {check.status}
                  </span>
                  <span className="min-w-0">
                    {check.name.length > 0 ? (
                      <span className="font-medium">{check.name} </span>
                    ) : null}
                    <span className="text-muted-foreground">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {raw.length === 0 ? null : (
            <details className="text-muted-foreground text-xs">
              <summary className="cursor-pointer">Raw output</summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono">{raw}</pre>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
