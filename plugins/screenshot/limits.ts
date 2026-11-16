export const maxPngBytes = 10 * 1024 * 1024;
export const permissionTimeoutMs = 30_000;
export const captureTimeoutMs = 120_000;
export const captureRequestTimeoutMs =
  permissionTimeoutMs + captureTimeoutMs + 5_000;
export const resourceTtlMs = 120_000;
