/**
 * The one boundary that turns untrusted page text and URLs into bounded,
 * credential-free diagnostics. Never promise perfect secret detection: this
 * strips URL userinfo/query/fragment and common credential forms (including
 * quoted values and `Authorization: Bearer <token>`), clamps length, and
 * leaves classification to the caller.
 */
const SECRET_PATTERN =
  /((?:authorization|bearer|token|api[_-]?key|apikey|secret|password|passwd|session[_-]?id)"?\s*[=:]\s*)((?:bearer)\s+)?("[^"\\]*(?:\\[\s\S][^"\\]*)*(?:"|\\?$)|'[^'\\]*(?:\\[\s\S][^'\\]*)*(?:'|\\?$)|[^\s,;"']{4,})/gi;

const BEARER_PATTERN = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi;

const LONG_HEX_PATTERN = /\b[a-f0-9]{40,}\b/gi;

const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`<>\\)\]]+/gi;

export function clampText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Protocol + host + path only: credentials, query, and fragment are dropped. */
export function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return scrubCredentials(value.split(/[?#]/, 1)[0] ?? value);
  }
}

function scrubCredentials(value: string): string {
  return value
    .replace(SECRET_PATTERN, "$1$2[redacted]")
    .replace(BEARER_PATTERN, "$1 [redacted]")
    .replace(LONG_HEX_PATTERN, "[redacted]");
}

/** Credential forms plus embedded URLs, for free text such as error messages. */
export function scrubText(value: string): string {
  return scrubCredentials(value).replace(URL_PATTERN, (match) => scrubUrl(match));
}

/** Bound producer work first, redact even cut-off quotes, then bound expansion. */
export function scrubBoundedText(value: string, maxChars: number): string {
  return clampText(scrubText(clampText(value, maxChars)), maxChars);
}
