import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { hostContract } from "../contract";
import { safe } from "./text";

export function hostClient(alia: AliaPluginApi) {
  return alia.hosts.experimental_client({ contract: hostContract });
}
export type HostClient = ReturnType<typeof hostClient>;

async function connectedHosts(alia: AliaPluginApi) {
  return ((await safe(() => alia.sdk.hosts.list())) ?? []).filter((entry) => entry.status === "connected");
}

/**
 * The first connected VesnALIA host; null when none is connected or the list is unreadable. A disconnected host would only
 * hold the call until its timeout.
 */
export async function connectedHostId(alia: AliaPluginApi): Promise<string | null> {
  return (await connectedHosts(alia))[0]?.id ?? null;
}

/**
 * The host that keeps the search index: `current` while it stays connected, else the first connected persistent
 * host. Sticking to one host avoids re-exporting every thread when VesnALIA lists hosts in another order; ephemeral
 * hosts are skipped because their files go away with them. Null when no such host is connected.
 */
export async function indexHostId(alia: AliaPluginApi, current: string | null): Promise<string | null> {
  const connected = await connectedHosts(alia);
  if (current && connected.some((entry) => entry.id === current)) return current;
  return connected.find((entry) => entry.type === "persistent")?.id ?? null;
}

/**
 * Whether a host command error means the CLI could not start: Node reports `spawn x ENOENT`, Bun
 * `Executable not found in $PATH: "x"`, and a shell `x: command not found`.
 */
export function commandMissing(error: string): boolean {
  return /ENOENT|not found in \$PATH|command not found/i.test(error);
}
