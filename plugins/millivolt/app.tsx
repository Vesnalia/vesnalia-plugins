// alia-plugin-millivolt — frontend entry.
//
// One sidebar page:
//   setup     — when nothing is installed yet: install, or adopt what exists
//   Overview  — live counters, install location, update state
//   Requests  — the retained request log
//   Dashboard — the real millivolt dashboard, framed through the plugin's
//               credential-injecting loopback proxy
//
// Everything is read over RPC; the operator token never reaches this bundle.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import type {
  MillivoltCandidate,
  MillivoltDiscovery,
  MillivoltOverview,
  MillivoltRequestPage,
  MillivoltRequestRow,
  MillivoltStatus,
  rpcContract,
} from "./server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Tab = "overview" | "requests" | "dashboard";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "BarChart3" },
  { id: "requests", label: "Requests", icon: "List" },
  { id: "dashboard", label: "Dashboard", icon: "LayoutDashboard" },
];

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatCost(value: number): string {
  if (value > 0 && value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatMs(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1) return "—";
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function formatAgo(iso: string | null): string {
  if (iso === null) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "bad" | "warn" | "good";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            tone === "bad" && "text-destructive",
            tone === "warn" && "text-amber-500",
            tone === "good" && "text-emerald-500",
          )}
        >
          {value}
        </p>
        {hint === undefined ? null : (
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: MillivoltStatus | null }) {
  const state = status?.installed === false ? "not installed" : (status?.state ?? "unknown");
  const tone =
    state === "running"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : state === "starting"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : state === "error" || state === "not installed"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {state}
      {status?.healthy === true ? " · healthy" : ""}
    </span>
  );
}

function CandidateRow({
  candidate,
  disabled,
  onUse,
}: {
  candidate: MillivoltCandidate;
  disabled: boolean;
  onUse: () => void;
}) {
  const usable = candidate.deployDir !== null && candidate.port !== null;
  return (
    <li className="flex items-start gap-3 border-b border-border/60 py-2.5 last:border-0">
      <Icon
        name={candidate.kind === "container" ? "Container" : candidate.kind === "port" ? "Radio" : "FolderSearch"}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {candidate.deployDir ?? "directory unknown"}
          {candidate.port === null ? "" : ` · port ${candidate.port}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">{candidate.evidence}</p>
        {candidate.hasToken ? null : (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No operator token found in that directory; paste one in Settings after
            adopting.
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !usable}
        onClick={onUse}
      >
        Use this
      </Button>
    </li>
  );
}

function SetupPanel({
  status,
  busy,
  discovery,
  onInstall,
  onDiscover,
  onAdopt,
}: {
  status: MillivoltStatus | null;
  busy: boolean;
  discovery: MillivoltDiscovery | null;
  onInstall: () => void;
  onDiscover: () => void;
  onAdopt: (candidate: MillivoltCandidate) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Icon name="Activity" className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Set up millivolt</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            millivolt is a self-hosted proxy that records what your agents send,
            what comes back, and what it cost. Installing it here creates a Docker
            compose deployment with a generated operator token, then starts it.
            Nothing leaves this machine.
          </p>
          {status?.detail === null || status?.detail === undefined ? null : (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {status.detail}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={onInstall}>
              <Icon name="Download" className={cn("size-3.5", busy && "animate-pulse")} />
              Install millivolt
            </Button>
            <Button variant="outline" disabled={busy} onClick={onDiscover}>
              <Icon name="Search" className={cn("size-3.5", busy && "animate-pulse")} />
              Find an existing install
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Already have millivolt? Find it instead of installing a second copy.
            Discovery reads Docker labels, probes loopback ports, then scans common
            folders for a compose file.
          </p>
        </CardContent>
      </Card>

      {discovery === null ? null : (
        <Card>
          <CardContent className="space-y-2 p-5">
            <h3 className="text-sm font-medium">
              {discovery.candidates.length === 0
                ? "Nothing found"
                : `${discovery.candidates.length} candidate${discovery.candidates.length === 1 ? "" : "s"}`}
            </h3>
            {discovery.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Checked {discovery.scannedPorts.length} loopback port
                {discovery.scannedPorts.length === 1 ? "" : "s"}
                {discovery.scannedDirs === 0
                  ? "."
                  : ` and ${discovery.scannedDirs} folder${discovery.scannedDirs === 1 ? "" : "s"}.`}
                {discovery.volumes.length === 0
                  ? ""
                  : ` Docker volumes exist (${discovery.volumes.join(", ")}) but no container uses them.`}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {discovery.candidates.map((candidate) => (
                  <CandidateRow
                    key={`${candidate.kind}-${candidate.deployDir ?? candidate.port}`}
                    candidate={candidate}
                    disabled={busy}
                    onUse={() => onAdopt(candidate)}
                  />
                ))}
              </ul>
            )}
            {discovery.truncated ? (
              <p className="text-xs text-muted-foreground">
                The folder scan hit its time budget, so results may be partial.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OverviewTab({
  overview,
  status,
  error,
  onUpdate,
  updating,
  onRevert,
  onResume,
}: {
  overview: MillivoltOverview | null;
  status: MillivoltStatus | null;
  error: string | null;
  onUpdate: () => void;
  updating: boolean;
  onRevert: () => void;
  onResume: () => void;
}) {
  if (error !== null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (overview === null) return <EmptyState>Loading metrics…</EmptyState>;
  const { kpi, storage, pause, throttle, debug } = overview;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {pause.paused ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-600 dark:text-amber-400">
            paused · {pause.queued} queued
          </span>
        ) : null}
        {throttle.active > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-600 dark:text-amber-400">
            {throttle.active} throttled provider{throttle.active === 1 ? "" : "s"}
          </span>
        ) : null}
        {debug.enabled ? (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-600 dark:text-sky-400">
            debug capture on
          </span>
        ) : null}
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          storage {storage.enabled ? "on" : "off"}
          {storage.dropped > 0 ? ` · ${storage.dropped} dropped` : ""}
        </span>
        {status === null ? null : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            :{status.port}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Requests" value={String(kpi.requests)} hint={`${kpi.inFlight} in flight`} />
        <Stat
          label="Errors"
          value={String(kpi.errors)}
          tone={kpi.errors > 0 ? "bad" : undefined}
          hint={
            kpi.requests > 0
              ? `${((kpi.errors / kpi.requests) * 100).toFixed(1)}% of traffic`
              : undefined
          }
        />
        <Stat label="Cost" value={formatCost(kpi.cost)} hint="provider-reported" />
        <Stat
          label="Tokens"
          value={formatTokens(kpi.inputTokens + kpi.outputTokens)}
          hint={`${formatTokens(kpi.inputTokens)} in · ${formatTokens(kpi.outputTokens)} out`}
        />
        <Stat label="Avg TTFT" value={formatMs(kpi.avgTtftMs)} hint="time to first token" />
        <Stat
          label="Avg TPS"
          value={kpi.avgTps === null ? "—" : kpi.avgTps.toFixed(1)}
          hint="tokens/sec"
        />
        <Stat
          label="Cache reads"
          value={formatTokens(kpi.cacheReadTokens)}
          hint={`${formatTokens(kpi.reasoningTokens)} reasoning`}
        />
        <Stat label="Dashboard" value={overview.dashboardVersion.slice(0, 8)} hint="millivolt build" />
      </div>

      <div className="rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="FolderCog" className="size-3.5" />
            {status?.deployDir ?? "—"}
            {status?.managed === null || status?.managed === undefined
              ? null
              : ` (${status.managed})`}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="RefreshCw" className="size-3.5" />
            updates {status?.autoUpdate === true ? "on" : "off"} · last check{" "}
            {formatAgo(status?.lastUpdateCheck ?? null)}
            {status?.lastUpdateResult === null || status?.lastUpdateResult === undefined
              ? ""
              : ` · ${status.lastUpdateResult}`}
          </span>
          {status?.rolledBackTo === null || status?.rolledBackTo === undefined ? null : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-600 dark:text-amber-400">
              <Icon name="Undo2" className="size-3.5" />
              pinned to {status.rolledBackTo}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {status?.rolledBackTo === null || status?.rolledBackTo === undefined ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={updating}
                onClick={onUpdate}
              >
                <Icon name="RefreshCw" className={cn("size-3.5", updating && "animate-spin")} />
                Check for updates
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-7" disabled={updating} onClick={onResume}>
                <Icon name="ArrowUpCircle" className="size-3.5" />
                Resume updates
              </Button>
            )}
            {/* Always rendered: a hidden affordance is not an affordance. The
                reason it cannot be used sits in the tooltip and the label. */}
            <span
              className="inline-flex"
              title={
                status?.rolledBackTo !== null && status?.rolledBackTo !== undefined
                  ? `already pinned to ${status.rolledBackTo}`
                  : status?.canRevert === true
                    ? `pin ${status.previousImage} and recreate the container`
                    : "no previous image recorded yet: the target appears after the first update"
              }
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={updating || status?.canRevert !== true}
                onClick={onRevert}
              >
                <Icon name="Undo2" className="size-3.5" />
                {status?.canRevert === true
                  ? `Revert last update (${status.previousImage})`
                  : "Revert last update"}
              </Button>
            </span>
          </div>
        </div>
      </div>
      {storage.totalsDegraded || storage.dropped > 0 ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Storage dropped {storage.dropped} record{storage.dropped === 1 ? "" : "s"}
          {storage.totalsDegraded ? "; aggregates are degraded" : ""}. History is
          best-effort under sustained overload.
        </p>
      ) : null}
    </div>
  );
}

function StatusCell({ row }: { row: MillivoltRequestRow }) {
  const failed = row.status >= 400 || row.errorType !== null;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        failed ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {row.status === 0 ? "err" : row.status}
    </span>
  );
}

function RequestsTab({
  page,
  error,
  loading,
  onRefresh,
  onOlder,
}: {
  page: MillivoltRequestPage | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
  onOlder: () => void;
}) {
  if (error !== null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (page === null) return <EmptyState>Loading requests…</EmptyState>;
  if (page.rows.length === 0) return <EmptyState>No requests recorded yet.</EmptyState>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Provider / model</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">TTFT</th>
              <th className="px-3 py-2 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                title={row.errorType ?? row.id}
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {formatClock(row.start)}
                </td>
                <td className="px-3 py-1.5">
                  <StatusCell row={row} />
                  {row.retries > 0 ? (
                    <span className="ml-1 text-xs text-muted-foreground">×{row.retries}</span>
                  ) : null}
                </td>
                <td className="max-w-[22rem] truncate px-3 py-1.5">
                  <span className="text-muted-foreground">{row.provider}</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span>{row.model}</span>
                </td>
                <td className="max-w-[12rem] truncate px-3 py-1.5 text-muted-foreground">
                  {row.client}
                  {row.stream ? " · stream" : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                  {formatTokens(row.inputTokens)} / {formatTokens(row.outputTokens)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatMs(row.ttftMs)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatMs(row.durationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <Icon name="RefreshCw" className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
        {page.more ? (
          <Button variant="ghost" size="sm" onClick={onOlder} disabled={loading}>
            Load older
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {page.rows.length} row{page.rows.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function MillivoltPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [tab, setTab] = useState<Tab>("overview");
  const [status, setStatus] = useState<MillivoltStatus | null>(null);
  const [overview, setOverview] = useState<MillivoltOverview | null>(null);
  const [page, setPage] = useState<MillivoltRequestPage | null>(null);
  const [discovery, setDiscovery] = useState<MillivoltDiscovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const report = useCallback((cause: unknown) => {
    if (!mounted.current) return;
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const loadStatus = useCallback(() => {
    rpc.call("status").then(setStatus, report);
  }, [rpc, report]);

  const loadOverview = useCallback(() => {
    rpc.call("overview").then(
      (next) => {
        if (!mounted.current) return;
        setOverview(next);
        setError(null);
      },
      report,
    );
  }, [rpc, report]);

  const loadRequests = useCallback(
    (older?: { beforeMs: number; beforeId: string }) => {
      setLoading(true);
      rpc
        .call(
          "requests",
          older === undefined
            ? { limit: 50 }
            : { limit: 50, beforeMs: older.beforeMs, beforeId: older.beforeId },
        )
        .then(
          (next) => {
            if (!mounted.current) return;
            setPage((previous) =>
              older === undefined || previous === null
                ? next
                : { ...next, rows: [...previous.rows, ...next.rows] },
            );
            setError(null);
          },
          report,
        )
        .finally(() => {
          if (mounted.current) setLoading(false);
        });
    },
    [rpc, report],
  );

  useEffect(() => {
    loadStatus();
    loadOverview();
    loadRequests();
  }, [loadStatus, loadOverview, loadRequests]);

  useRealtime("millivolt-status", (payload) => {
    if (payload !== null && typeof payload === "object") {
      setStatus(payload as MillivoltStatus);
    }
  });

  // 5s polling keeps numbers honest without hammering the proxy; the setup
  // screen does not poll, because nothing is running yet.
  useEffect(() => {
    if (status?.installed === false) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (tab === "overview") loadOverview();
      if (tab === "requests") loadRequests();
      loadStatus();
    }, 5_000);
    return () => clearInterval(timer);
  }, [tab, status?.installed, loadOverview, loadRequests, loadStatus]);

  const control = async (
    action: "start" | "stop" | "restart" | "update" | "revert" | "resume" | "repair",
  ) => {
    setBusy(true);
    if (action === "update") setUpdating(true);
    try {
      const next = await rpc.call("control", { action });
      if (mounted.current) {
        setStatus(next);
        setError(null);
        if (next.state === "running") loadOverview();
      }
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) {
        setBusy(false);
        setUpdating(false);
      }
    }
  };

  const runUpdate = async () => {
    setUpdating(true);
    try {
      await rpc.call("update");
      const next = await rpc.call("status");
      if (mounted.current) {
        setStatus(next);
        setError(null);
      }
      loadOverview();
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) setUpdating(false);
    }
  };

  const runDiscover = async () => {
    setBusy(true);
    try {
      setDiscovery(await rpc.call("discover"));
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const runInstall = async () => {
    setBusy(true);
    try {
      const next = await rpc.call("setup", { adopt: false });
      if (mounted.current) {
        setStatus(next);
        setDiscovery(null);
        setError(next.detail);
      }
      if (next.state === "running") loadOverview();
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const runAdopt = async (candidate: MillivoltCandidate) => {
    if (candidate.deployDir === null || candidate.port === null) return;
    setBusy(true);
    try {
      const next = await rpc.call("setup", {
        adopt: true,
        dir: candidate.deployDir,
        port: candidate.port,
      });
      if (mounted.current) {
        setStatus(next);
        setDiscovery(null);
        setError(next.detail);
      }
      if (next.state === "running") loadOverview();
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const dashboardUrl = status === null ? null : `http://127.0.0.1:${status.port}/`;
  const needsSetup = status !== null && status.installed === false;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2.5 md:px-5">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {needsSetup ? null : (
            <div className="flex shrink-0 items-center gap-1">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
                    tab === entry.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon name={entry.icon} className="size-3.5" />
                  {entry.label}
                </button>
              ))}
            </div>
          )}
          {needsSetup ? null : (
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || status?.state === "running"}
                onClick={() => void control("start")}
              >
                <Icon name="Play" className="size-3.5" />
                Start
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || status?.state !== "running"}
                onClick={() => void control("stop")}
              >
                <Icon name="Square" className="size-3.5" />
                Stop
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void control("restart")}
              >
                <Icon name="RotateCw" className={cn("size-3.5", busy && "animate-spin")} />
                Restart
              </Button>
              <span
                className="inline-flex"
                title="diagnose and fix a deployment that stopped answering"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void control("repair")}
                >
                  <Icon name="Wrench" className="size-3.5" />
                  Auto-fix
                </Button>
              </span>
              {dashboardUrl === null ? null : (
                <Button variant="ghost" size="sm" asChild>
                  <a href={dashboardUrl} target="_blank" rel="noreferrer">
                    <Icon name="ExternalLink" className="size-3.5" />
                    Browser
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
        {status?.detail === null || status?.detail === undefined || needsSetup ? null : (
          <p className="mx-auto mt-1 w-full max-w-5xl text-xs text-destructive">
            {status.detail}
          </p>
        )}
        {status?.repairReport === null || status?.repairReport === undefined ? null : (
          <p className="mx-auto mt-1 w-full max-w-5xl text-xs text-muted-foreground">
            Auto-fix: {status.repairReport}
          </p>
        )}
      </div>

      {needsSetup ? (
        <div className="h-full min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto box-border w-full max-w-5xl px-4 pb-6 pt-4 md:px-5">
            <SetupPanel
              status={status}
              busy={busy}
              discovery={discovery}
              onInstall={() => void runInstall()}
              onDiscover={() => void runDiscover()}
              onAdopt={(candidate) => void runAdopt(candidate)}
            />
          </div>
        </div>
      ) : tab === "dashboard" ? (
        <div className="min-h-0 flex-1 bg-background">
          {status?.embedUrl === null || status?.embedUrl === undefined ? (
            <div className="p-4">
              <EmptyState>
                The in-alia dashboard needs a running millivolt and an operator token
                (Settings → millivolt). Use the Browser button in the meantime.
              </EmptyState>
            </div>
          ) : (
            <iframe
              title="millivolt dashboard"
              src={status.embedUrl}
              className="size-full border-0"
              allow="clipboard-read; clipboard-write"
            />
          )}
        </div>
      ) : (
        <div className="h-full min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto box-border w-full max-w-5xl px-4 pb-6 pt-3 md:px-5 md:pt-4">
            {tab === "overview" ? (
              <OverviewTab
                overview={overview}
                status={status}
                error={error}
                onUpdate={() => void runUpdate()}
                updating={updating}
                onRevert={() => void control("revert")}
                onResume={() => void control("resume")}
              />
            ) : (
              <RequestsTab
                page={page}
                error={error}
                loading={loading}
                onRefresh={() => loadRequests()}
                onOlder={() =>
                  page?.cursorMs !== null &&
                  page?.cursorMs !== undefined &&
                  page.cursorId !== null &&
                  loadRequests({ beforeMs: page.cursorMs, beforeId: page.cursorId })
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "millivolt",
    title: "Millivolt",
    icon: "Activity",
    path: "millivolt",
    component: MillivoltPage,
  });
});
