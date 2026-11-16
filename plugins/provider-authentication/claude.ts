import type { ProviderStatus } from "./contract.js";

const MAX_OUTPUT_LENGTH = 65_536;

export function appendBoundedOutput(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_OUTPUT_LENGTH
    ? next
    : next.slice(next.length - MAX_OUTPUT_LENGTH);
}

export function extractClaudeConsentUrl(output: string): string | null {
  const matches = output.matchAll(
    /https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\s\u001b\u0007]+/g,
  );
  for (const match of matches) {
    try {
      const url = new URL(match[0]);
      if (
        url.protocol === "https:" &&
        url.hostname === "claude.com" &&
        url.pathname === "/cai/oauth/authorize" &&
        url.searchParams.get("response_type") === "code" &&
        url.searchParams.has("state") &&
        url.searchParams.has("code_challenge")
      ) {
        return url.toString();
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function parseClaudeStatus(output: string): ProviderStatus | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.loggedIn === false) return { kind: "signed-out" };
    if (value.loggedIn !== true) return null;
    return {
      kind: "signed-in",
      identity: typeof value.email === "string" ? value.email : null,
      organization: typeof value.orgName === "string" ? value.orgName : null,
      subscription:
        typeof value.subscriptionType === "string"
          ? value.subscriptionType
          : null,
    };
  } catch {
    return null;
  }
}
