import { defineRpcContract } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { LIMITS } from "./limits.js";

/** Stable error codes shared by tools, session manager, and host executor. */
export const BROWSER_TOOL_ERROR_CODES = [
  "SESSION_STOPPED",
  "SESSION_NOT_FOUND",
  "STALE_REF",
  "TARGET_UNAVAILABLE",
  "TARGET_AMBIGUOUS",
  "ACTION_OUTCOME_UNKNOWN",
  "DEADLINE_EXCEEDED",
  "QUEUE_FULL",
  "SESSION_LIMIT",
  "OUTPUT_LIMIT",
  "UNSUPPORTED_CAPABILITY",
  "INVALID_INPUT",
  "EVALUATE_DISABLED",
  "INTERNAL",
] as const;

export const browserToolErrorCodeSchema = z.enum(BROWSER_TOOL_ERROR_CODES);
export type BrowserToolErrorCode = z.infer<typeof browserToolErrorCodeSchema>;

/** A safe, classified failure. `message` never contains endpoints or secrets. */
export class BrowserToolError extends Error {
  readonly code: BrowserToolErrorCode;

  constructor(code: BrowserToolErrorCode, message: string) {
    super(message);
    this.name = "BrowserToolError";
    this.code = code;
  }
}

export const errorEnvelopeSchema = z
  .object({
    code: browserToolErrorCodeSchema,
    message: z.string().min(1).max(2_000),
  })
  .strict();
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof BrowserToolError) {
    return { code: error.code, message: error.message };
  }
  return { code: "INTERNAL", message: "Browser operation failed" };
}

/** Short human label for a tool result without leaking internals. */
export function describeError(error: ErrorEnvelope): string {
  return `${error.code}: ${error.message}`;
}

// ---------------------------------------------------------------------------
// Navigation policy: shared by browser_open and browser_navigate.
// ---------------------------------------------------------------------------

export const NAVIGATION_URL_MAX_CHARS = LIMITS.snapshot.urlChars;

export const navigationUrlSchema = z
  .string()
  .min(1)
  .max(NAVIGATION_URL_MAX_CHARS)
  .superRefine((value, context) => {
    if (value !== value.trim() || /\s/.test(value)) {
      context.addIssue({
        code: "custom",
        message: "URL must not contain whitespace",
      });
      return;
    }
    if (value === "about:blank") return;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "URL must be an absolute http(s) URL or about:blank",
      });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "Only http, https, and about:blank URLs are supported",
      });
      return;
    }
    if (url.username !== "" || url.password !== "") {
      context.addIssue({
        code: "custom",
        message: "URLs with embedded credentials are not allowed",
      });
    }
  });

// ---------------------------------------------------------------------------
// Refs: snapshot-versioned labels. A ref is only valid for the snapshot that
// issued it; the host never reassigns an index to a different node.
// ---------------------------------------------------------------------------

export const SNAPSHOT_ID_PATTERN = /^[a-z0-9]{4,16}\.[0-9]{1,9}$/;
export const REF_PATTERN = /^[a-z0-9]{4,16}\.[0-9]{1,9}:e[0-9]{1,7}$/;

export const snapshotIdSchema = z.string().regex(SNAPSHOT_ID_PATTERN);
export const refSchema = z.string().regex(REF_PATTERN);

export function snapshotIdForRef(ref: string): string | null {
  const index = ref.lastIndexOf(":e");
  if (index <= 0) return null;
  const snapshotId = ref.slice(0, index);
  return SNAPSHOT_ID_PATTERN.test(snapshotId) ? snapshotId : null;
}

// ---------------------------------------------------------------------------
// Press keys: validated allowlist, no TypeScript casting of arbitrary strings.
// ---------------------------------------------------------------------------

export const KEY_MODIFIERS = ["Alt", "Control", "Meta", "Shift"] as const;
export const NAMED_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Space",
] as const;

const modifierSet = new Set<string>(KEY_MODIFIERS);
const namedKeySet = new Set<string>(NAMED_KEYS);

/** Returns null for a supported key, otherwise a short reason. */
export function validatePressKey(value: string): string | null {
  const parts = value.split("+");
  if (parts.some((part) => part.length === 0)) return "Key combination is malformed";
  const key = parts[parts.length - 1]!;
  const modifiers = parts.slice(0, -1);
  if (modifiers.some((modifier) => !modifierSet.has(modifier))) {
    return "Only Alt, Control, Meta, and Shift modifiers are supported";
  }
  if (new Set(modifiers).size !== modifiers.length) {
    return "Key combination repeats a modifier";
  }
  if (namedKeySet.has(key)) return null;
  if ([...key].length === 1 && key.codePointAt(0)! > 0x1f) return null;
  return `Unsupported key "${key}"`;
}

export const pressKeySchema = z
  .string()
  .min(1)
  .max(32)
  .superRefine((value, context) => {
    const reason = validatePressKey(value);
    if (reason) context.addIssue({ code: "custom", message: reason });
  });

// ---------------------------------------------------------------------------
// Public operation inputs. Session selection is optional per call; the
// session manager owns the trusted thread identity and default session.
// ---------------------------------------------------------------------------

export const sessionIdSchema = z.string().min(1).max(64);
export const identifierSchema = z.string().min(1).max(256);
export const typedTextSchema = z.string().max(4_000);

const sessionSelectionShape = { sessionId: sessionIdSchema.optional() };

export const browserOpenInputSchema = z
  .object({
    hostId: identifierSchema.optional(),
    instanceId: identifierSchema.optional(),
    tabId: identifierSchema.optional(),
    url: navigationUrlSchema.optional(),
    allowPersonal: z.boolean().default(false),
    ...sessionSelectionShape,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.allowPersonal && value.tabId === undefined) {
      context.addIssue({
        code: "custom",
        message: "allowPersonal requires an explicit tabId",
      });
    }
    if (value.tabId !== undefined && value.url !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          "browser_open cannot combine tabId and url; open the tab, then use browser_navigate",
      });
    }
    if (value.instanceId !== undefined && value.hostId === undefined) {
      context.addIssue({
        code: "custom",
        message: "instanceId requires hostId",
      });
    }
  });

export const browserNavigateInputSchema = z
  .object({
    url: navigationUrlSchema,
    ...sessionSelectionShape,
  })
  .strict();

export const browserSnapshotInputSchema = z.object({ ...sessionSelectionShape }).strict();

export const browserClickInputSchema = z
  .object({
    ref: refSchema,
    ...sessionSelectionShape,
  })
  .strict();

export const browserTypeInputSchema = z
  .object({
    ref: refSchema,
    text: typedTextSchema,
    replace: z.boolean().default(true),
    ...sessionSelectionShape,
  })
  .strict();

export const browserPressInputSchema = z
  .object({
    key: pressKeySchema,
    ...sessionSelectionShape,
  })
  .strict();

export const browserScreenshotInputSchema = z
  .object({
    fullPage: z.boolean().default(false),
    ...sessionSelectionShape,
  })
  .strict();

export const browserEvaluateInputSchema = z
  .object({
    expression: z.string().min(1).max(LIMITS.evaluate.expressionChars),
    ...sessionSelectionShape,
  })
  .strict();

export const browserConsoleInputSchema = z
  .object({
    cursor: z.number().int().nonnegative().optional(),
    ...sessionSelectionShape,
  })
  .strict();

export const browserCloseInputSchema = z
  .object({
    closeTab: z.boolean().default(false),
    ...sessionSelectionShape,
  })
  .strict();

export const browserToolInputSchemas = {
  browser_open: browserOpenInputSchema,
  browser_navigate: browserNavigateInputSchema,
  browser_snapshot: browserSnapshotInputSchema,
  browser_click: browserClickInputSchema,
  browser_type: browserTypeInputSchema,
  browser_press: browserPressInputSchema,
  browser_screenshot: browserScreenshotInputSchema,
  browser_evaluate: browserEvaluateInputSchema,
  browser_console: browserConsoleInputSchema,
  browser_close: browserCloseInputSchema,
} as const;

export type BrowserToolName = keyof typeof browserToolInputSchemas;

export type BrowserOpenInput = z.infer<typeof browserOpenInputSchema>;
export type BrowserNavigateInput = z.infer<typeof browserNavigateInputSchema>;
export type BrowserSnapshotInput = z.infer<typeof browserSnapshotInputSchema>;
export type BrowserClickInput = z.infer<typeof browserClickInputSchema>;
export type BrowserTypeInput = z.infer<typeof browserTypeInputSchema>;
export type BrowserPressInput = z.infer<typeof browserPressInputSchema>;
export type BrowserScreenshotInput = z.infer<typeof browserScreenshotInputSchema>;
export type BrowserEvaluateInput = z.infer<typeof browserEvaluateInputSchema>;
export type BrowserConsoleInput = z.infer<typeof browserConsoleInputSchema>;
export type BrowserCloseInput = z.infer<typeof browserCloseInputSchema>;

// ---------------------------------------------------------------------------
// Shared results.
// ---------------------------------------------------------------------------

export const actionOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: errorEnvelopeSchema,
    })
    .strict(),
]);
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>;

export const snapshotRefSchema = z
  .object({
    ref: refSchema,
    role: z.string().min(1).max(120),
    name: z.string().max(1_000).nullable(),
  })
  .strict();

export const snapshotTruncationSchema = z
  .object({
    text: z.boolean(),
    nodes: z.boolean(),
    depth: z.boolean(),
    refs: z.boolean(),
    droppedNodes: z.number().int().nonnegative(),
  })
  .strict();

export const snapshotPayloadSchema = z
  .object({
    snapshotId: snapshotIdSchema,
    text: z.string().max(LIMITS.snapshot.textChars),
    refs: z.array(snapshotRefSchema).max(LIMITS.snapshot.refs),
    url: z.string().max(LIMITS.snapshot.urlChars),
    title: z.string().max(LIMITS.snapshot.titleChars),
    truncated: snapshotTruncationSchema,
  })
  .strict();
export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

export const actionWithSnapshotSchema = z
  .object({
    action: actionOutcomeSchema,
    snapshot: snapshotPayloadSchema.nullable(),
    snapshotError: errorEnvelopeSchema.nullable(),
  })
  .strict();
export type ActionWithSnapshot = z.infer<typeof actionWithSnapshotSchema>;

/** Interpret the validated nested action envelope once for lifecycle and adapters. */
export function interpretActionResult(value: unknown): { failed: boolean; stopSession: boolean } {
  const parsed = actionWithSnapshotSchema.safeParse(value);
  if (!parsed.success) return { failed: false, stopSession: false };
  const result = parsed.data;
  const code = !result.action.ok ? result.action.error.code : result.snapshotError?.code;
  return {
    failed: !result.action.ok,
    stopSession: code === "ACTION_OUTCOME_UNKNOWN" || code === "SESSION_STOPPED",
  };
}


export const screenshotPayloadSchema = z
  .object({
    data: z.string().min(1),
    mimeType: z.literal("image/jpeg"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mode: z.enum(["viewport", "full-page"]),
    reduced: z.boolean(),
    truncated: z.boolean(),
    bytes: z.number().int().positive(),
  })
  .strict();
export type ScreenshotPayload = z.infer<typeof screenshotPayloadSchema>;

export const evaluatePayloadSchema = z
  .object({
    value: z.json(),
    truncated: z.boolean(),
    notice: z.string().max(500).nullable(),
  })
  .strict();
export type EvaluatePayload = z.infer<typeof evaluatePayloadSchema>;

export const consoleEntrySchema = z
  .object({
    seq: z.number().int().nonnegative(),
    kind: z.enum(["console", "pageerror", "http"]),
    level: z.string().max(40).nullable(),
    text: z.string().max(LIMITS.diagnostics.entryChars),
    url: z.string().max(LIMITS.snapshot.urlChars).nullable(),
  })
  .strict();

export const consolePayloadSchema = z
  .object({
    entries: z.array(consoleEntrySchema).max(LIMITS.diagnostics.entries),
    nextCursor: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
  })
  .strict();
export type ConsolePayload = z.infer<typeof consolePayloadSchema>;

export const closePayloadSchema = z
  .object({
    closed: z.literal(true),
    tabClosed: z.boolean(),
  })
  .strict();
export type ClosePayload = z.infer<typeof closePayloadSchema>;

// ---------------------------------------------------------------------------
// Persisted session records: versioned, compact, and resource-identity only.
// ---------------------------------------------------------------------------

export const SESSION_RECORD_VERSION = 1 as const;

export const sessionPhaseSchema = z.enum(["opening", "ready", "stopping", "stopped"]);
export type SessionPhase = z.infer<typeof sessionPhaseSchema>;

export const tabProvenanceSchema = z
  .object({
    instanceId: identifierSchema,
    generation: identifierSchema,
    // Empty while a session is still opening, before the lease is acquired.
    leaseId: z.string().max(256),
    tabId: identifierSchema,
    borrowed: z.boolean(),
    profileId: identifierSchema.nullable(),
    pendingClose: z.boolean(),
  })
  .strict();
export type TabProvenance = z.infer<typeof tabProvenanceSchema>;

export const cleanupStepsSchema = z
  .object({
    hostConnectionClosed: z.boolean(),
    leaseReleased: z.boolean(),
    tabClosed: z.boolean(),
  })
  .strict();
export type CleanupSteps = z.infer<typeof cleanupStepsSchema>;

export const sessionRecordSchema = z
  .object({
    version: z.literal(SESSION_RECORD_VERSION),
    id: sessionIdSchema,
    threadId: identifierSchema,
    hostId: identifierSchema,
    phase: sessionPhaseSchema,
    createdAt: z.number().int(),
    expiresAt: z.number().int(),
    lastUsedAt: z.number().int(),
    stoppedAt: z.number().int().nullable(),
    desktop: tabProvenanceSchema.nullable(),
    cleanup: cleanupStepsSchema,
  })
  .strict();
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export function newCleanupSteps(): CleanupSteps {
  return { hostConnectionClosed: false, leaseReleased: false, tabClosed: false };
}

export function cleanupComplete(record: SessionRecord): boolean {
  return (
    record.cleanup.hostConnectionClosed &&
    record.cleanup.leaseReleased &&
    record.desktop?.pendingClose !== true
  );
}

// ---------------------------------------------------------------------------
// Host RPC contract. Expected browser failures travel inside a result
// envelope (host RPC only carries a generic `handler_error` for throws);
// throws are reserved for contract violations and bugs.
// ---------------------------------------------------------------------------

const hostFailureSchema = z
  .object({
    ok: z.literal(false),
    error: errorEnvelopeSchema,
  })
  .strict();

function hostResultSchema<const T extends z.ZodType>(data: T) {
  return z.union([z.object({ ok: z.literal(true), data }).strict(), hostFailureSchema]);
}

const deadlineSchema = z.number().int().positive();

export const hostOpenInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    wsEndpoint: z.string().min(1),
    expiresAt: z.number().int().positive(),
    deadlineAt: deadlineSchema,
  })
  .strict();

export const hostSessionInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    deadlineAt: deadlineSchema,
  })
  .strict();

export const hostNavigateInputSchema = hostSessionInputSchema
  .extend({ url: navigationUrlSchema })
  .strict();

export const hostClickInputSchema = hostSessionInputSchema
  .extend({ ref: refSchema })
  .strict();

export const hostTypeInputSchema = hostSessionInputSchema
  .extend({
    ref: refSchema,
    text: typedTextSchema,
    replace: z.boolean(),
  })
  .strict();

export const hostPressInputSchema = hostSessionInputSchema
  .extend({ key: pressKeySchema })
  .strict();

export const hostScreenshotInputSchema = hostSessionInputSchema
  .extend({ fullPage: z.boolean() })
  .strict();

export const hostEvaluateInputSchema = hostSessionInputSchema
  .extend({ expression: z.string().min(1).max(LIMITS.evaluate.expressionChars) })
  .strict();

export const hostConsoleInputSchema = hostSessionInputSchema
  .extend({ cursor: z.number().int().nonnegative().nullable() })
  .strict();

export const hostCloseInputSchema = z.object({ sessionId: sessionIdSchema }).strict();

export const hostContract = defineRpcContract({
  open: {
    input: hostOpenInputSchema,
    output: hostResultSchema(z.object({ snapshot: snapshotPayloadSchema }).strict()),
  },
  navigate: {
    input: hostNavigateInputSchema,
    output: hostResultSchema(actionWithSnapshotSchema),
  },
  snapshot: {
    input: hostSessionInputSchema,
    output: hostResultSchema(z.object({ snapshot: snapshotPayloadSchema }).strict()),
  },
  click: {
    input: hostClickInputSchema,
    output: hostResultSchema(actionWithSnapshotSchema),
  },
  type: {
    input: hostTypeInputSchema,
    output: hostResultSchema(actionWithSnapshotSchema),
  },
  press: {
    input: hostPressInputSchema,
    output: hostResultSchema(actionWithSnapshotSchema),
  },
  screenshot: {
    input: hostScreenshotInputSchema,
    output: hostResultSchema(screenshotPayloadSchema),
  },
  evaluate: {
    input: hostEvaluateInputSchema,
    output: hostResultSchema(evaluatePayloadSchema),
  },
  console: {
    input: hostConsoleInputSchema,
    output: hostResultSchema(consolePayloadSchema),
  },
  close: {
    input: hostCloseInputSchema,
    output: z.null(),
  },
});

export type HostContract = typeof hostContract;
