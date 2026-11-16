import { randomUUID } from "node:crypto";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { hostContract, hostSignals, rpcContract } from "./contract.js";

export { rpcContract } from "./contract.js";

export default function plugin(alia: AliaPluginApi) {
  const host = alia.hosts.experimental_client({
    contract: hostContract,
    experimental_signals: hostSignals,
  });

  function publishChanged(hostId: string): void {
    alia.realtime.publish("provider-authentication.changed", { hostId });
  }

  const unsubscribeSignal = host.experimental_onSignal(
    "attemptChanged",
    ({ hostId }) => publishChanged(hostId),
  );
  const unsubscribeExit = host.experimental_onWorkerExit(({ hostId }) =>
    publishChanged(hostId),
  );

  async function requireConnectedHost(hostId: string) {
    const machine = await alia.sdk.hosts.get({ hostId });
    if (machine.status !== "connected") {
      throw new Error("This machine is offline.");
    }
    return machine;
  }

  alia.rpc.register(rpcContract, {
    async listMachines() {
      const machines = await alia.sdk.hosts.list();
      return {
        machines: machines.map(({ id, name, status }) => ({ id, name, status })),
      };
    },
    async getOverview({ hostId }) {
      const machine = await alia.sdk.hosts.get({ hostId });
      if (machine.status !== "connected") {
        return {
          status: { kind: "unavailable" as const, message: "This machine is offline." },
          attempt: null,
        };
      }
      try {
        const [status, attempt] = await Promise.all([
          host.call("inspect", null, { hostId }),
          host.call("getAttempt", null, { hostId }),
        ]);
        return { status, attempt };
      } catch {
        return {
          status: {
            kind: "unavailable" as const,
            message: "Provider authentication is unavailable on this machine.",
          },
          attempt: null,
        };
      }
    },
    async beginAuthentication({ hostId }) {
      await requireConnectedHost(hostId);
      return host.call("begin", { attemptId: randomUUID() }, { hostId });
    },
    async submitAuthorizationCode({ hostId, attemptId, code }) {
      await requireConnectedHost(hostId);
      return host.call("submitCode", { attemptId, code }, { hostId });
    },
    async cancelAuthentication({ hostId, attemptId }) {
      await requireConnectedHost(hostId);
      return host.call("cancel", { attemptId }, { hostId });
    },
  });

  alia.onDispose(() => {
    unsubscribeSignal();
    unsubscribeExit();
  });
}
