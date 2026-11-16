import type { LocalBridge } from "./contract";

/** Never fall back to another machine when the local Mac cannot be verified. */
export async function findLocalMac(
  bridges: LocalBridge[],
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const probes = new AbortController();
  try {
    const hostId = await Promise.any(
      bridges.map(async (bridge) => {
        const response = await fetch(
          `http://127.0.0.1:${bridge.port}/alia-screenshot/identify`,
          {
            headers: { Authorization: `Bearer ${bridge.token}` },
            signal: AbortSignal.any([
              signal,
              probes.signal,
              AbortSignal.timeout(5000),
            ]),
            cache: "no-store",
          },
        );
        if (
          !response.ok ||
          (await response.json()).identity !== bridge.identity
        )
          throw new Error("Not this Mac");
        return bridge.hostId;
      }),
    );
    signal.throwIfAborted();
    return hostId;
  } catch {
    signal.throwIfAborted();
    throw new Error(
      "Could not connect to VesnALIA on this Mac. Keep this Mac connected to VesnALIA and allow local network access for this site, then retry.",
    );
  } finally {
    probes.abort();
  }
}
