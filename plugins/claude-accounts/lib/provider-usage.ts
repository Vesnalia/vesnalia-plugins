// Limits for the other providers VesnALIA is logged into (Cursor, Codex, …).
//
// These come from VesnALIA's own provider state, not from a snapshot: the plugin
// reads what VesnALIA already knows and never touches those logins.

import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { ProviderCard, Usage } from "../schema";

/** Claude is switchable above, so its card is not repeated in this block. */
const EXCLUDED = new Set(["claude-code"]);

function clampPercent(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
}

export async function listProviderCards(
  alia: AliaPluginApi,
  hostId: string | null,
): Promise<ProviderCard[]> {
  const states = await alia.sdk.system.providerStates(
    hostId === null ? {} : { hostId },
  );
  return states.providers
    .filter(
      (provider) =>
        !EXCLUDED.has(provider.providerId) &&
        provider.status !== "not_installed",
    )
    .map((provider) => ({
      providerId: provider.providerId,
      displayName: provider.displayName,
      accountEmail: provider.accountEmail,
      planLabel: provider.planLabel,
    }));
}

export async function providerUsage(
  alia: AliaPluginApi,
  providerId: string,
  hostId: string | null,
): Promise<Usage> {
  const response = await alia.sdk.system.usageLimits(
    hostId === null ? { providerId } : { providerId, hostId },
  );
  const entry = response[providerId];
  if (entry === undefined) {
    return { status: "error", message: "VesnALIA reported no usage for this provider." };
  }
  switch (entry.status) {
    case "ok":
      return {
        status: "ok",
        accountEmail: entry.accountEmail ?? null,
        planLabel: entry.planLabel ?? null,
        windows: entry.windows.map((window) => ({
          label: window.label,
          usedPercent: clampPercent(window.usedPercent),
          resetsAt: window.resetsAt ?? null,
        })),
      };
    case "error":
      return { status: "error", message: entry.message };
    case "expired":
      return { status: "expired" };
    case "unauthenticated":
      return { status: "unauthenticated" };
    default:
      return { status: "not_installed" };
  }
}
