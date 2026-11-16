// Token Guard page: whether the guard is on, and what a history scan found.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { GuardState, rpcContract } from "./server";
import { ICONS } from "./lib/icons";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function GuardPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<GuardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("state").then((next) => {
      setState(next);
      setError(null);
    }, report);
  }, [rpc, report]);
  useEffect(refetch, [refetch]);
  useRealtime("state-changed", refetch);

  const scanReport = state?.report ?? null;
  const shownError = error ?? state?.error ?? null;
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <p className="text-sm text-muted-foreground">
          {state === null
            ? "Loading…"
            : state.enabled
              ? `Guard is on. Messages stopped so far: ${state.blocked}.`
              : "Guard is off. Turn it on in Settings → Installed plugins → Token Guard."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Checks message text and uploaded UTF-8 or UTF-16 text files. Images, PDFs,
          office documents and archives are not checked. BB stores uploads before
          the check; Token Guard stops dispatch to the agent.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button
            disabled={state === null || state.scanning}
            onClick={() => {
              rpc.call("scan_start").then(setState, report);
            }}
          >
            <Icon name="token-guard/search" className="size-4" />
            {state?.scanning ? "Scanning…" : "Scan my agent history"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Runs on this server. Values are never shown or stored.
          </span>
        </div>
        {shownError === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {shownError}
          </p>
        )}
        {scanReport === null ? null : (
          <div className="mt-5">
            <h2 className="text-base font-medium">
              {scanReport.rows.length === 0
                ? "No credentials found"
                : `${scanReport.rows.length} credentials in your history`}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {scanReport.filesScanned} files, {formatBytes(scanReport.bytesScanned)}
              {scanReport.unreadable > 0 ? `, ${scanReport.unreadable} unreadable` : ""}
              {scanReport.truncated ? ", first 500 shown" : ""}. Assume any of these can be read by whatever has access to this machine: revoke them.
            </p>
            {scanReport.rows.length === 0 ? null : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 font-normal">Kind</th>
                      <th className="px-3 py-2 font-normal">Fingerprint</th>
                      <th className="px-3 py-2 text-right font-normal">Seen</th>
                      <th className="px-3 py-2 font-normal">Where</th>
                      <th className="px-3 py-2 font-normal">Last</th>
                      <th className="px-3 py-2 font-normal" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {scanReport.rows.map((row) => (
                      <tr key={row.fingerprint}>
                        <td className="whitespace-nowrap px-3 py-2">{row.kind}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.fingerprint}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.occurrences}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{row.sources.join(", ")}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{row.lastSeen.slice(0, 10)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {row.revokeUrl === "" ? null : (
                            <a className="text-xs underline" href={row.revokeUrl} target="_blank" rel="noreferrer">
                              Revoke
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  for (const [name, component] of Object.entries(ICONS)) {
    app.experimental_icons.register({ name, component });
  }
  app.slots.navPanel({
    id: "token-guard",
    title: "Token Guard",
    icon: "token-guard/shield",
    path: "token-guard",
    component: GuardPage,
  });
});
