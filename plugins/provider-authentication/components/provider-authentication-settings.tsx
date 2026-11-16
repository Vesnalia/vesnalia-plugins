import { useCallback, useEffect, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@vesnalia/plugin-sdk/app";
import type { Machine, Overview } from "../contract";
import type { rpcContract } from "../server";
import { AuthenticationDialog } from "./authentication-dialog";
import { ProviderRow } from "./provider-row";
import { Icon } from "./ui/icon";

const EMPTY_OVERVIEW: Overview = {
  status: { kind: "unavailable", message: "Select a machine to continue." },
  attempt: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export function ProviderAuthenticationSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (hostId === null) return;
    const next = await rpc.call("getOverview", { hostId });
    setOverview(next);
  }, [hostId, rpc]);

  useEffect(() => {
    let active = true;
    void rpc
      .call("listMachines")
      .then(({ machines: nextMachines }) => {
        if (!active) return;
        setMachines(nextMachines);
        setHostId((current) =>
          current !== null && nextMachines.some((machine) => machine.id === current)
            ? current
            : (nextMachines.find((machine) => machine.status === "connected")?.id ??
              nextMachines[0]?.id ??
              null),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  useEffect(() => {
    if (hostId === null) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [hostId, refresh]);

  useEffect(() => {
    if (connectionState === "connected") void refresh();
  }, [connectionState, refresh]);

  useRealtime("provider-authentication.changed", (payload) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "hostId" in payload &&
      payload.hostId === hostId
    ) {
      void refresh();
    }
  });

  async function beginAuthentication(): Promise<void> {
    if (hostId === null) return;
    setBusy(true);
    setDialogError(null);
    try {
      const attempt = await rpc.call("beginAuthentication", {
        hostId,
        providerId: "claude-code",
      });
      setOverview((current) => ({ ...current, attempt }));
      setDialogOpen(true);
    } catch (error) {
      setDialogError(errorMessage(error));
      setDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(code: string): Promise<void> {
    const attempt = overview.attempt;
    if (hostId === null || attempt === null) return;
    setDialogError(null);
    try {
      const next = await rpc.call("submitAuthorizationCode", {
        hostId,
        providerId: "claude-code",
        attemptId: attempt.id,
        code,
      });
      setOverview((current) => ({ ...current, attempt: next }));
      await refresh();
    } catch (error) {
      setDialogError(errorMessage(error));
    }
  }

  async function cancelAuthentication(): Promise<void> {
    const attempt = overview.attempt;
    if (hostId === null || attempt === null) return;
    setDialogError(null);
    try {
      const next = await rpc.call("cancelAuthentication", {
        hostId,
        providerId: "claude-code",
        attemptId: attempt.id,
      });
      setOverview((current) => ({ ...current, attempt: next }));
    } catch (error) {
      setDialogError(errorMessage(error));
    }
  }

  const selectedMachine = machines.find((machine) => machine.id === hostId) ?? null;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-2">
        <label htmlFor="provider-authentication-machine" className="text-sm font-medium">
          Machine
        </label>
        <div className="relative">
          <select
            id="provider-authentication-machine"
            value={hostId ?? ""}
            disabled={machines.length === 0}
            className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pe-9 text-base text-foreground shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
            onChange={(event) => setHostId(event.target.value || null)}
          >
            {machines.length === 0 ? <option value="">No machines available</option> : null}
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.name}{machine.status === "disconnected" ? " — Offline" : ""}
              </option>
            ))}
          </select>
          <Icon name="ChevronDown" className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </div>
        {selectedMachine !== null ? (
          <p className="text-xs text-muted-foreground">
            Authentication applies to provider CLIs installed on {selectedMachine.name}.
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground" aria-busy="true">
          <Icon name="Spinner" className="me-2 animate-spin" aria-hidden />
          Checking providers…
        </div>
      ) : (
        <ProviderRow status={overview.status} busy={busy} onAuthenticate={() => void beginAuthentication()} />
      )}

      <AuthenticationDialog
        open={dialogOpen}
        attempt={overview.attempt}
        error={dialogError}
        onOpenChange={setDialogOpen}
        onSubmit={submitCode}
        onCancel={cancelAuthentication}
      />
    </div>
  );
}
