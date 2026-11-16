import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@vesnalia/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../../server";
import { errorMessage } from "./format";
import type { ProviderId, TokenmaxxState } from "./types";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export type PolicyPatch = {
  provider: ProviderId;
  enabled?: boolean;
  hiddenWindowIds?: string[];
  hysteresisPercent?: number;
  minimumDwellMilliseconds?: number;
  thresholdPercent?: number;
};

export const useTokenmaxx = () => {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<TokenmaxxState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await rpc.call("state");
      if (!mounted.current) return;
      setState(next);
      setLoadError(null);
    } catch (error) {
      if (!mounted.current) return;
      setLoadError(errorMessage(error));
    }
  }, [rpc]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRealtime("state", () => {
    void reload();
  });

  const act = useCallback(
    async <T,>(key: string, failure: string, action: (client: Rpc) => Promise<T>) => {
      setPending(key);
      try {
        return await action(rpc);
      } catch (error) {
        toast.error(failure, { description: errorMessage(error) });
        return null;
      } finally {
        if (mounted.current) setPending(null);
      }
    },
    [rpc],
  );

  const apply = useCallback((next: TokenmaxxState | null) => {
    if (next !== null && mounted.current) setState(next);
    return next;
  }, []);

  const actions = {
    consumeReset: (accountId: string) =>
      act("consume-reset", "Could not use the reset credit", async (client) => {
        const result = await client.call("consumeReset", { accountId });
        apply(result.state);
        return result.outcome;
      }),

    daemon: (action: "start" | "stop") =>
      act(`daemon-${action}`, `Could not ${action} the daemon`, async (client) => {
        const result = await client.call("daemonControl", { action });
        apply(result.state);
        return result.result;
      }),

    doctor: () => act("doctor", "Could not run doctor", (client) => client.call("doctor")),

    refresh: () =>
      act("refresh", "Could not refresh usage", async (client) =>
        apply(await client.call("refresh")),
      ),

    removeAccount: (accountId: string) =>
      act("remove-account", "Could not sign the account out", async (client) =>
        apply(await client.call("removeAccount", { accountId })),
      ),

    resetCredits: (accountId: string) =>
      act("reset-credits", "Could not read reset credits", (client) =>
        client.call("resetCredits", { accountId }),
      ),

    routing: (input: { action: "install" | "uninstall"; target: "native" | "pi" }) =>
      act(`routing-${input.target}`, "Could not change routing", (client) =>
        client.call("routing", input),
      ),

    setPolicy: (patch: PolicyPatch) =>
      act(`policy-${patch.provider}`, "Could not save the rotation policy", async (client) =>
        apply(await client.call("setPolicy", patch)),
      ),

    switchAccount: (input: { accountId: string; provider: ProviderId }) =>
      act(`switch-${input.accountId}`, "Could not switch accounts", async (client) =>
        apply(await client.call("switchAccount", input)),
      ),
  };

  return { actions, isLoading: state === null && loadError === null, loadError, pending, reload, state };
};
