// origin(): the Connect status RPC → ALIA_APP_URL → the loopback origin (DESIGN §C.3, D-alia-16); ownOrigins()
// (§C.5). Only a remote answer is cached, so a link is never stale long after Connect comes up.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { asRecord } from "../provider/errors.ts";

const passThrough = { parse: (value: unknown) => value } as never;

export function createOrigin(alia: AliaPluginApi, cacheMs = 30_000, now: () => number = Date.now): () => Promise<string | null> {
  let cached: { at: number; origin: string } | null = null;
  return async () => {
    if (cached && now() - cached.at < cacheMs) return cached.origin;
    const remote = (await connectOrigin(alia)) ?? appUrlOrigin(alia);
    cached = remote ? { at: now(), origin: remote } : null;
    return remote ?? loopbackOrigin(alia); // DR-29, 04 R6.7: the loopback URL where it reports none
  };
}

export async function connectStatus(alia: AliaPluginApi): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(await alia.sdk.plugins.callRpc({ pluginId: "connect", method: "status", input: null, outputSchema: passThrough }));
  } catch {
    return null; // Connect absent, disabled or unpaired: a normal local-only answer
  }
}

export async function connectOrigin(alia: AliaPluginApi): Promise<string | null> {
  const status = await connectStatus(alia);
  return status && status.state === "connected" && typeof status.url === "string" ? originOf(status.url) : null;
}

/** `<handle>--<port>.getbb.app` for each shared port the Connect status lists, when it does (shape unverified: O-10). */
export function connectPortShareOrigins(status: Record<string, unknown> | null): string[] {
  const ports = status?.sharedPorts ?? status?.ports;
  return (Array.isArray(ports) ? ports : []).map((p) => asRecord(p)?.url).filter((u): u is string => typeof u === "string").map(originOf).filter((o): o is string => o !== null);
}

export function appUrlOrigin(alia: AliaPluginApi): string | null {
  return originOf(alia.server.experimental_appUrl);
}

export function loopbackOrigin(alia: AliaPluginApi): string | null {
  try {
    return originOf(alia.server.loopbackBaseUrl); // bind-gated: read inside the call, never at load
  } catch {
    return null;
  }
}

/** The loopback origin under each name the same server answers to: `127.0.0.1`, `localhost`, `[::1]` (ALIA-8). */
export function loopbackAliases(origin: string | null): string[] {
  if (!origin) return [];
  try {
    const url = new URL(origin);
    return [...new Set(["127.0.0.1", "localhost", "[::1]"].map((host) => `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`))];
  } catch {
    return [origin];
  }
}

export function createOwnOrigins(alia: AliaPluginApi): () => Promise<string[]> {
  return async () => {
    const status = await connectStatus(alia);
    const connect = status && status.state === "connected" && typeof status.url === "string" ? originOf(status.url) : null;
    return [...new Set([...loopbackAliases(loopbackOrigin(alia)), appUrlOrigin(alia), connect, ...connectPortShareOrigins(status)].filter((o): o is string => o !== null))];
  };
}

export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
