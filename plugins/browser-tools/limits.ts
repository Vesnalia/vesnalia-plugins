/**
 * Canonical budgets for the whole plugin. One owner for every limit: tools,
 * session manager, and host executor import from here and never redefine a
 * bound locally. Values are acceptance targets from the reviewed plan; adjust
 * only with recorded measurement evidence.
 */
export const LIMITS = {
  session: {
    perThread: 4,
    perHost: 16,
    global: 64,
    queueDepth: 8,
    leaseTtlMs: 30 * 60_000,
    idleMs: 5 * 60_000,
    completedRecordRetentionMs: 24 * 60 * 60_000,
  },
  snapshot: {
    textChars: 60_000,
    nodes: 5_000,
    depth: 64,
    refs: 2_000,
    urlChars: 4_096,
    titleChars: 1_024,
  },
  screenshot: {
    /**
     * Sized so a large first capture stays under the broker's 1 MiB
     * WebSocket message cap, including base64 expansion.
     */
    maxPixels: 4_000_000,
    largePagePixels: 2_500_000,
    maxJpegBytes: 500 * 1_024,
    initialQuality: 60,
    fallbackQuality: 40,
    resultBytes: 7_000_000,
  },
  diagnostics: {
    entries: 200,
    entryChars: 2_000,
  },
  evaluate: {
    expressionChars: 128_000,
    outputChars: 60_000,
    depth: 6,
    items: 100,
    stringChars: 10_000,
  },
  navigation: {
    defaultTimeoutMs: 15_000,
    maxTimeoutMs: 120_000,
  },
  action: {
    maxDeadlineMs: 120_000,
  },
  cleanup: {
    concurrency: 4,
    disposeDrainMs: 4_000,
    stageTimeoutMs: 10_000,
    hostCallTimeoutMs: 15_000,
  },
  rpc: {
    hostResultBytes: 7_000_000,
  },
} as const;

export type Limits = typeof LIMITS;
