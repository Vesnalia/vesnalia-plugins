import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import type { AliaPluginApi, PluginAgentToolResult } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import {
  filePathsSchema,
  hostContract,
  type AttachmentFile,
} from "./attachments.js";
import {
  CONNECTION_SIGNAL_CHANNEL,
  connectionRpcContract,
  OPERATION_RESOLUTION_RENDERER_ID,
  operationResolutionPayloadSchema,
  operationResolutionResponseSchema,
  operationRequestSchema,
  consultationRequestSchema,
  type ConnectionView,
  type OperationRequest,
  type ShortcutRequest,
  type ShortcutAttachmentSummary,
} from "./contracts.js";
import { callbackPage, KoreyConnection } from "./connection.js";
import {
  beginMappingCreate,
  completeMappingCreate,
  createOperation,
  getMapping,
  getOperation,
  listOperations,
  listUnresolvedOperations,
  migrations,
  recoverInterruptedOperations,
  rejectMappingCreate,
  requireMappingReconciliation,
  reserveMapping,
  setLinkedMapping,
  setUnlinkedMapping,
  transitionOperation,
  updateOperationError,
  type MappingRecord,
  type OperationRecord,
} from "./data.js";
import {
  formatKoreyMessages,
  KoreyApiError,
  KoreyClient,
  KoreyResponsePendingError,
  type KoreyIdentity,
  type KoreyMessage,
  type KoreyThread,
} from "./korey-client.js";
import { OAUTH_CALLBACK_PATH } from "./oauth.js";

const CONSULT_PREFIX = [
  "This request is consultation-only.",
  "Do not create, update, archive, assign, or delete anything in Shortcut or any other connected system.",
  "Return analysis or a draft only.",
  "",
].join("\n");
const MAPPING_MARKER_PREFIX = "alia-korey";
const MAX_STORED_RESPONSE_BYTES = 64 * 1024;
const INTERACTION_TIMEOUT_MS = 10 * 60_000;
const API_TOKEN_URL = "https://app.korey.ai/settings/api-tokens";
const TOKEN_SETUP_GUIDANCE = `Connect your Korey account with \`alia korey login\` or under Settings -> Installed plugins -> Korey. Alternatively, create a Korey personal access token at ${API_TOKEN_URL} and add it there.`;

const CLI_COMMANDS = [
  {
    name: "status",
    summary: "Check Korey authentication",
    usage: "alia korey status [--json]",
  },
  {
    name: "login",
    summary: "Connect your Korey account with OAuth",
    usage: "alia korey login [<redirect-url>] [--json]",
  },
  {
    name: "logout",
    summary: "Disconnect your Korey account",
    usage: "alia korey logout [--json]",
  },
  {
    name: "threads",
    summary: "List owned Korey threads",
    usage:
      "alia korey threads [query...] [--after <cursor>] [--limit <count>] [--json]",
  },
  {
    name: "show",
    summary: "Show a Korey thread and one page of messages",
    usage:
      "alia korey show <korey-thread-id> [--after <cursor>] [--limit <count>] [--json]",
  },
  {
    name: "link",
    summary: "Link a private Korey thread to a VesnALIA thread",
    usage: "alia korey link <korey-thread-id> [--alia-thread <id>] [--json]",
  },
  {
    name: "unlink",
    summary: "Remove a alia-to-Korey thread link",
    usage: "alia korey unlink [--alia-thread <id>] [--json]",
  },
  {
    name: "ask",
    summary:
      "Ask Korey to research connected tools or carry out a requested change",
    usage:
      "alia korey ask <message...> [--change] [--file <path> ...] [--alia-thread <id>] [--json]",
  },
  {
    name: "shortcut",
    summary:
      "Ask Korey to create or update a Shortcut Story at the user's request",
    usage: [
      "alia korey shortcut create <instruction...> [--file <path> ...] [--alia-thread <id>] [--json]",
      "alia korey shortcut update <story-id> <instruction...> [--file <path> ...] [--alia-thread <id>] [--json]",
    ].join("\n  "),
  },
  {
    name: "operation",
    summary: "Inspect or safely recover a Korey operation",
    usage: [
      "alia korey operation list [--limit <count>] [--alia-thread <id>] [--json]",
      "alia korey operation show <operation-id> [--alia-thread <id>] [--json]",
      "alia korey operation resume <operation-id> [--alia-thread <id>] [--json]",
      "alia korey operation reconcile <operation-id> [--alia-thread <id>] [--json]",
      "alia korey operation resolve <operation-id> <note...> [--alia-thread <id>] [--json]",
    ].join("\n  "),
  },
];

const askInputSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(20_000),
  mode: z
    .enum(["consult", "change"])
    .default("consult")
    .describe(
      "Use change when the user requested an action in a connected service, such as updating a feature flag. Use consult for research, questions, and drafts without changes. Prefer korey_shortcut_change for Shortcut Story creation and updates.",
    ),
  files: filePathsSchema
    .optional()
    .describe(
      "Files to attach. Paths are relative to this thread's workspace. Up to 5 files.",
    ),
});

const shortcutChangeInputSchema = z
  .object({
    action: z.enum(["create", "update"]),
    storyId: z.string().optional(),
    instruction: z.string().trim().min(1).max(20_000),
    files: filePathsSchema
      .optional()
      .describe(
        "Files to send with the Shortcut request. Paths are relative to this thread's workspace. Up to 5 files.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "update" && value.storyId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["storyId"],
        message: "storyId is required for an update",
      });
    }
    if (value.action === "create" && value.storyId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["storyId"],
        message: "storyId is not allowed for a create",
      });
    }
  });

type ShortcutChangeInput = z.infer<typeof shortcutChangeInputSchema>;
type ChangeInput =
  | ShortcutChangeInput
  | {
      action: "change";
      instruction: string;
      files?: string[];
    };

interface LinkedThread {
  created: boolean;
  koreyThread: KoreyThread;
  operation: OperationRecord;
}

interface PreparedAttachment {
  file: AttachmentFile;
  identity: string;
  summary: ShortcutAttachmentSummary;
}

function toolError(error: unknown): PluginAgentToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

async function executeJsonTool(
  execute: () => Promise<unknown>,
): Promise<string | PluginAgentToolResult> {
  try {
    return JSON.stringify(await execute(), null, 2);
  } catch (error) {
    return toolError(error);
  }
}

function cliOutput(json: boolean, value: unknown, text: string) {
  return {
    exitCode: 0,
    stdout: json ? JSON.stringify(value, null, 2) : text,
  };
}

function normalizeStoryId(value: string): string | null {
  const match = /^(?:sc-)?([1-9][0-9]*)$/iu.exec(value.trim());
  return match?.[1] === undefined ? null : `sc-${match[1]}`;
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function mutationWasRejected(error: unknown): boolean {
  return error instanceof KoreyApiError && error.mutationRejected;
}

function boundedText(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= MAX_STORED_RESPONSE_BYTES) {
    return { text, truncated: false };
  }
  const prefix = bytes
    .subarray(0, MAX_STORED_RESPONSE_BYTES)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
  return {
    text: `${prefix}\n\n[Response truncated by alia-plugin-korey; open the Korey conversation to read the full response.]`,
    truncated: true,
  };
}

// Keep history readable across request schema versions. Missing future fields
// are shown as unknown; this projection is never used to authorize a write.
const storedRequestSummarySchema = z.object({
  action: z
    .enum(["create", "update", "change", "consult", "unknown"])
    .catch("unknown"),
  storyId: z.string().nullable().catch(null),
  instruction: z.string().catch("[Unavailable in this request version]"),
  attachments: z.array(z.unknown()).catch([]),
  koreyOrganization: z.string().nullable().catch("Unknown"),
});

function operationView(operation: OperationRecord) {
  const summary = storedRequestSummarySchema.parse(operation.request);
  return {
    operationId: operation.id,
    status: operation.status,
    ...summary,
    requestVersion: operation.requestVersion,
    requestHash: operation.requestHash,
    koreyThreadId: operation.koreyThreadId,
    koreyMessageId: operation.koreyMessageId,
    attachmentIds: operation.attachmentIds,
    response: operation.responseText,
    responseTruncated: operation.responseTruncated,
    resolutionNote: operation.resolutionNote,
    error: operation.error,
    nextStep:
      operation.status === "awaiting-response"
        ? `Use korey_resume_operation or VesnALIA korey operation resume ${operation.id}; this only reads the accepted message.`
        : operation.status === "reconcile-required"
          ? `Use korey_reconcile_operation or VesnALIA korey operation reconcile ${operation.id}; do not send the request again.`
          : null,
    createdAt: new Date(operation.createdAt).toISOString(),
    updatedAt: new Date(operation.updatedAt).toISOString(),
    approvedAt:
      operation.approvedAt === null
        ? null
        : new Date(operation.approvedAt).toISOString(),
    completedAt:
      operation.completedAt === null
        ? null
        : new Date(operation.completedAt).toISOString(),
  };
}

function plainOperation(
  operation: ReturnType<typeof operationView>,
  appUrl?: string,
): string {
  return [
    `Operation ${operation.operationId} (${operation.status})`,
    operation.response ??
      (operation.status === "awaiting-response"
        ? "Korey accepted the request. Its response is still pending."
        : "No response recorded."),
    operation.responseTruncated
      ? "Response truncated; inspect the Korey conversation for the full answer."
      : null,
    operation.error,
    operation.nextStep,
    appUrl,
  ]
    .filter((part) => part !== null && part !== undefined)
    .join("\n\n");
}

function parseCommonCliArgs(argv: string[]) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      after: { type: "string", multiple: true },
      change: { type: "boolean" },
      "alia-thread": { type: "string", multiple: true },
      file: { type: "string", multiple: true },
      json: { type: "boolean" },
      limit: { type: "string", multiple: true },
    },
    strict: true,
  });
  const aliaThreadIds = values["alia-thread"];
  const afterValues = values.after;
  const limitValues = values.limit;
  if (aliaThreadIds !== undefined && aliaThreadIds.length > 1) {
    throw new Error("--alia-thread may be provided only once");
  }
  if (afterValues !== undefined && afterValues.length > 1) {
    throw new Error("--after may be provided only once");
  }
  if (limitValues !== undefined && limitValues.length > 1) {
    throw new Error("--limit may be provided only once");
  }
  const rawLimit = limitValues?.[0];
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > 200)
  ) {
    throw new Error("--limit must be an integer from 1 to 200");
  }
  return {
    after: afterValues?.[0],
    change: values.change ?? false,
    aliaThreadId: aliaThreadIds?.[0],
    files: values.file === undefined ? [] : filePathsSchema.parse(values.file),
    json: values.json ?? false,
    limit,
    positional: positionals,
  };
}

function cliThreadId(
  explicitThreadId: string | undefined,
  contextThreadId: string | undefined,
): string {
  const threadId = explicitThreadId ?? contextThreadId;
  if (threadId === undefined) {
    throw new Error(
      "This command needs a VesnALIA thread. Run it inside an agent thread or pass --alia-thread <thread-id>.",
    );
  }
  return threadId;
}

function plainThreadList(threads: readonly KoreyThread[]): string {
  if (threads.length === 0) return "No owned Korey threads found.";
  return threads
    .map(
      (thread) =>
        `${thread.id}\t${thread.state}\t${thread.is_private ? "private" : "shared"}\t${thread.name ?? "Untitled"}`,
    )
    .join("\n");
}

function plainConversation(
  thread: KoreyThread,
  messages: readonly KoreyMessage[],
  hasMore: boolean,
): string {
  const transcript = messages
    .map((message) => {
      const text = message.contents
        .map((content) => {
          if (content.type === "text") return content.text;
          if (content.type === "user_get_choice") {
            return `${content.question} [${content.choices.join(" / ")}]`;
          }
          if (content.type === "unknown") {
            return `[Unsupported Korey content: ${content.originalType}; view ${message.app_url}]`;
          }
          return `[${content.type} attachment ${content.attachment_id}]`;
        })
        .join("\n");
      return `${message.role}: ${text}`;
    })
    .join("\n\n");
  return [
    thread.name ?? "Untitled Korey thread",
    thread.app_url,
    "",
    transcript,
    ...(hasMore
      ? ["", "More messages are available; continue with --after."]
      : []),
  ].join("\n");
}

function accountLabel(identity: KoreyIdentity): string {
  return `${identity.name ?? identity.email ?? identity.sub} in ${identity.korey_organization_slug}`;
}

function usage(): string {
  return ["Usage:", ...CLI_COMMANDS.map(({ usage }) => `  ${usage}`)].join(
    "\n",
  );
}

function assertPrivateThread(thread: KoreyThread): void {
  if (!thread.is_private) {
    throw new Error(
      `Korey thread ${thread.id} is shared. alia-plugin-korey links only private conversations.`,
    );
  }
}

function operationMarker(operationId: string, legacy = false): string {
  // Version 1 reconciliation requires the original uppercase marker.
  const productName = legacy ? "alia".toUpperCase() : "alia";
  return `${productName} operation reference: ${operationId}`;
}

function consultationMarker(consultationId: string): string {
  return `alia consultation reference: ${consultationId}`;
}

export default async function plugin(alia: AliaPluginApi) {
  const host = alia.hosts.experimental_client({ contract: hostContract });
  const db = alia.storage.database();
  alia.storage.migrate(db, migrations);
  recoverInterruptedOperations(db);

  const settings = alia.settings.define({
    apiToken: {
      type: "string",
      label: "Korey personal access token",
      description: `Create a token at ${API_TOKEN_URL} with threads:read and threads:write scopes.`,
      secret: true,
    },
    oauthCredentials: {
      type: "string",
      label: "Korey account connection",
      description:
        "Saved by Connect Korey and `alia korey login`. Remove it with Disconnect below or `alia korey logout`.",
      secret: true,
    },
  });

  const connection = new KoreyConnection({
    kv: alia.storage.kv,
    callbackUrl: () =>
      `${alia.server.loopbackBaseUrl}/api/v1/plugins/${alia.pluginId}/http${OAUTH_CALLBACK_PATH}`,
    readCredentials: async () => (await settings.get()).oauthCredentials,
    writeCredentials: async (value) => {
      await settings.experimental_set({ oauthCredentials: value });
    },
  });

  // Covers sign-in, token refresh, and edits from the settings form or CLI.
  settings.onChange(() => alia.realtime.publish(CONNECTION_SIGNAL_CHANNEL, null));

  async function authState() {
    const values = await settings.get();
    const apiToken = values.apiToken?.trim() || null;
    // A connected Korey account takes precedence over the personal access token.
    const method: ConnectionView["method"] = values.oauthCredentials?.trim()
      ? "oauth"
      : apiToken !== null
        ? "token"
        : "none";
    return { method, apiToken };
  }

  // VesnALIA clears this notice only when the plugin reloads.
  const setupNoticeShown = (await authState()).method === "none";
  if (setupNoticeShown) {
    alia.status.needsConfiguration(TOKEN_SETUP_GUIDANCE);
  }
  const RELOAD_HINT = "Run `alia plugin reload korey` to clear the setup notice.";

  function clientFor(state: Awaited<ReturnType<typeof authState>>) {
    if (state.method === "oauth") {
      return new KoreyClient({ token: connection.tokens });
    }
    if (state.apiToken === null) {
      throw new Error(`Korey is not configured. ${TOKEN_SETUP_GUIDANCE}`);
    }
    return new KoreyClient({ token: state.apiToken });
  }

  async function client(): Promise<KoreyClient> {
    return clientFor(await authState());
  }

  async function connectionView(): Promise<ConnectionView> {
    const state = await authState();
    const { method } = state;
    const tokenSaved = state.apiToken !== null;
    if (method === "none") {
      return { method, account: null, error: null, tokenSaved };
    }
    try {
      const identity = await clientFor(state).identity();
      return {
        method,
        account: accountLabel(identity),
        error: null,
        tokenSaved,
      };
    } catch (error) {
      return {
        method,
        account: null,
        error: error instanceof Error ? error.message : String(error),
        tokenSaved,
      };
    }
  }

  alia.rpc.register(connectionRpcContract, {
    "connection.status": () => connectionView(),
    "connection.start": async () => ({
      authorizationUrl: (await connection.start()).authorizationUrl,
    }),
    "connection.complete": async ({ redirectUrl }) => {
      await connection.complete(redirectUrl);
      return connectionView();
    },
    "connection.disconnect": async () => {
      await connection.disconnect();
      return connectionView();
    },
    // Deletes only VesnALIA's copy; the token stays valid in Korey until revoked there.
    "connection.removeToken": async () => {
      await settings.experimental_set({ apiToken: null });
      return connectionView();
    },
  });

  alia.http.route("GET", OAUTH_CALLBACK_PATH, async (context) => {
    try {
      await connection.complete(context.req.url);
    } catch (error) {
      return callbackPage(
        "Korey sign-in failed",
        `${error instanceof Error ? error.message : String(error)} You can start again from VesnALIA.`,
        400,
      );
    }
    const view = await connectionView();
    const connected =
      view.account === null
        ? "alia is connected to Korey."
        : `alia is connected to Korey as ${view.account}.`;
    return callbackPage(
      "Connected to Korey",
      `${connected} ${setupNoticeShown ? `${RELOAD_HINT} ` : ""}You can close this tab.`,
      200,
    );
  });

  const threadTails = new Map<string, Promise<void>>();
  async function withThreadLock<T>(
    aliaThreadId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = threadTails.get(aliaThreadId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    threadTails.set(aliaThreadId, tail);
    await previous.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
      if (threadTails.get(aliaThreadId) === tail) {
        threadTails.delete(aliaThreadId);
      }
    }
  }

  async function aliaThreadName(
    aliaThreadId: string,
    marker: string,
  ): Promise<string> {
    const thread = await alia.sdk.threads.get({ threadId: aliaThreadId });
    const label = thread.title?.trim() || thread.id;
    const suffix = ` [${MAPPING_MARKER_PREFIX}:${marker}]`;
    return (
      `alia: ${label}`
        .slice(0, 120 - suffix.length)
        .replace(/[\uD800-\uDBFF]$/u, "") + suffix
    );
  }

  async function findMappedThread(
    api: KoreyClient,
    marker: string,
    signal?: AbortSignal,
  ): Promise<KoreyThread | null> {
    const token = `${MAPPING_MARKER_PREFIX}:${marker}`;
    const matches: KoreyThread[] = [];
    // Search indexes can tokenize the marker differently. Fall back to an
    // owned-thread scan when search misses, and bound both traversals.
    for (const query of [token, undefined]) {
      let after: string | undefined;
      const cursors = new Set<string>();
      for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
        const page = await api.listThreads({ after, limit: 50, query, signal });
        for (const thread of page.data) {
          if (
            thread.name?.includes(`[${token}]`) &&
            !matches.some((match) => match.id === thread.id)
          )
            matches.push(thread);
        }
        if (!page.has_more || matches.length > 1) break;
        if (page.last_id === null || cursors.has(page.last_id)) {
          throw new Error("Korey thread pagination did not advance");
        }
        if (pageNumber === 19) {
          throw new Error(
            "Korey mapping reconciliation exceeded 20 pages; inspect Korey and link the conversation manually.",
          );
        }
        cursors.add(page.last_id);
        after = page.last_id;
      }
      if (matches.length > 0) break;
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple Korey threads match mapping marker ${marker}; link the intended thread manually.`,
      );
    }
    const match = matches[0] ?? null;
    if (match !== null) assertPrivateThread(match);
    return match;
  }

  async function reconcileMapping(
    api: KoreyClient,
    mapping: MappingRecord,
    signal?: AbortSignal,
  ): Promise<MappingRecord> {
    if (mapping.marker === null) {
      throw new Error(
        `Korey mapping for ${mapping.aliaThreadId} requires manual relinking.`,
      );
    }
    const found = await findMappedThread(api, mapping.marker, signal);
    if (found === null) {
      throw new Error(
        `Korey mapping creation for ${mapping.aliaThreadId} has an unknown outcome. No exact marker match is visible yet; inspect Korey, then use VesnALIA korey link or unlink.`,
      );
    }
    completeMappingCreate(db, {
      aliaThreadId: mapping.aliaThreadId,
      generation: mapping.generation,
      koreyThreadId: found.id,
    });
    return getMapping(db, mapping.aliaThreadId)!;
  }

  async function ensureMapping(
    api: KoreyClient,
    aliaThreadId: string,
    signal?: AbortSignal,
    newMappingClaim?: { previousGeneration: number; marker: string },
  ): Promise<{ created: boolean; mapping: MappingRecord }> {
    let mapping = getMapping(db, aliaThreadId);
    if (newMappingClaim !== undefined) {
      const claimMatches =
        mapping === null
          ? newMappingClaim.previousGeneration === 0
          : mapping.state === "unlinked"
            ? mapping.generation === newMappingClaim.previousGeneration
            : mapping.marker === newMappingClaim.marker &&
              mapping.generation === newMappingClaim.previousGeneration + 1;
      if (!claimMatches) {
        throw new Error(
          "The Korey destination changed while preparing the request; inspect the linked conversation before trying again.",
        );
      }
    }
    if (mapping?.state === "ready") {
      if (mapping.koreyThreadId === null) {
        throw new Error(`Stored Korey mapping for ${aliaThreadId} is invalid`);
      }
      return { created: false, mapping };
    }
    if (
      mapping?.state === "create-dispatching" ||
      mapping?.state === "reconcile-required"
    ) {
      mapping = await reconcileMapping(api, mapping, signal);
      return { created: true, mapping };
    }
    if (mapping === null || mapping.state === "unlinked") {
      mapping = reserveMapping(
        db,
        aliaThreadId,
        newMappingClaim?.marker ?? randomUUID(),
      );
    }
    if (
      newMappingClaim !== undefined &&
      (mapping.marker !== newMappingClaim.marker ||
        mapping.generation !== newMappingClaim.previousGeneration + 1)
    ) {
      throw new Error(
        "The Korey destination changed while preparing the request; inspect the linked conversation before trying again.",
      );
    }
    if (mapping.state !== "reserved" || mapping.marker === null) {
      throw new Error(`Stored Korey mapping for ${aliaThreadId} is invalid`);
    }
    let name: string;
    try {
      name = await aliaThreadName(aliaThreadId, mapping.marker);
      signal?.throwIfAborted();
    } catch (error) {
      rejectMappingCreate(db, aliaThreadId, mapping.generation, "reserved");
      throw error;
    }
    if (!beginMappingCreate(db, aliaThreadId, mapping.generation)) {
      const current = getMapping(db, aliaThreadId);
      if (current?.state === "ready" && current.koreyThreadId !== null) {
        return { created: false, mapping: current };
      }
      throw new Error(`Korey mapping for ${aliaThreadId} changed concurrently`);
    }
    try {
      const created = await api.createEmptyThread(
        {
          name,
          isPrivate: true,
        },
        signal,
      );
      completeMappingCreate(db, {
        aliaThreadId,
        generation: mapping.generation,
        koreyThreadId: created.thread_id,
      });
      return { created: true, mapping: getMapping(db, aliaThreadId)! };
    } catch (error) {
      if (mutationWasRejected(error)) {
        rejectMappingCreate(db, aliaThreadId, mapping.generation);
        throw error;
      }
      requireMappingReconciliation(db, aliaThreadId, mapping.generation);
      try {
        const reconciled = await reconcileMapping(
          api,
          getMapping(db, aliaThreadId)!,
          signal,
        );
        return { created: true, mapping: reconciled };
      } catch {
        throw new Error(
          `Korey thread creation has an unknown outcome and will not be retried automatically. Inspect Korey, then link or unlink the conversation. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async function linkThread(
    aliaThreadId: string,
    koreyThreadId: string,
    signal?: AbortSignal,
  ): Promise<KoreyThread> {
    return withThreadLock(aliaThreadId, async () => {
      assertCanChangeMapping(aliaThreadId, koreyThreadId);
      const api = await client();
      const thread = await api.getThread(koreyThreadId, signal);
      assertPrivateThread(thread);
      assertCanChangeMapping(aliaThreadId, thread.id);
      setLinkedMapping(db, aliaThreadId, thread.id);
      return thread;
    });
  }

  async function unlinkThread(aliaThreadId: string): Promise<boolean> {
    return withThreadLock(aliaThreadId, async () => {
      assertCanChangeMapping(aliaThreadId, null);
      return setUnlinkedMapping(db, aliaThreadId);
    });
  }

  function assertCanChangeMapping(
    aliaThreadId: string,
    destination: string | null,
  ): void {
    const current = getMapping(db, aliaThreadId)?.koreyThreadId ?? null;
    if (current === destination) return;
    const inherited = listUnresolvedOperations(db, aliaThreadId, current).filter(
      (operation) => operation.aliaThreadId !== aliaThreadId,
    );
    if (inherited.length > 0) {
      throw new Error(
        `Recover the unresolved Korey operations in this conversation before changing its link: ${inherited.map(({ id }) => id).join(", ")}. Inspect them here with korey_get_operation, then resume, reconcile, or manually resolve them. Changing the link would bypass their recovery safeguards.`,
      );
    }
  }

  async function readAttachments(
    aliaThreadId: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<PreparedAttachment[]> {
    if (paths.length === 0) return [];
    const thread = await alia.sdk.threads.get({ threadId: aliaThreadId });
    if (thread.environmentId === null) {
      throw new Error("File attachments require a thread environment");
    }
    const environment = await alia.sdk.environments.get({
      environmentId: thread.environmentId,
      signal,
    });
    if (environment.path === null) {
      throw new Error("File attachments require a thread workspace");
    }
    const prepared = await Promise.all(
      paths.map(async (path) => {
        const attachment = await host.call(
          "readAttachment",
          { path, workspaceRoot: environment.path! },
          { hostId: environment.hostId, signal },
        );
        const { identity, ...file } = attachment;
        const bytes = Buffer.from(file.base64, "base64");
        return {
          file,
          identity,
          summary: {
            sourcePath: path,
            filename: file.filename,
            contentType: file.contentType,
            size: bytes.length,
            sha256: hash(bytes),
          },
        };
      }),
    );
    const identities = new Set<string>();
    for (const attachment of prepared) {
      if (identities.has(attachment.identity)) {
        throw new Error(
          `Duplicate attachment file: ${attachment.summary.sourcePath}`,
        );
      }
      identities.add(attachment.identity);
    }
    return prepared;
  }

  async function sendConsultation(
    aliaThreadId: string,
    prompt: string,
    signal?: AbortSignal,
    paths: readonly string[] = [],
  ): Promise<LinkedThread> {
    const prepared = await readAttachments(aliaThreadId, paths, signal);
    return withThreadLock(aliaThreadId, async () => {
      const api = await client();
      const linked = await ensureMapping(api, aliaThreadId, signal);
      const koreyThreadId = linked.mapping.koreyThreadId;
      if (koreyThreadId === null)
        throw new Error("Korey mapping is incomplete");
      const koreyThread = await api.getThread(koreyThreadId, signal);
      assertPrivateThread(koreyThread);
      if (koreyThread.state !== "ready") {
        throw new Error(
          `Linked Korey thread ${koreyThread.id} is ${koreyThread.state}, not ready`,
        );
      }
      const unsigned = {
        operationId: `korey-consult-${randomUUID()}`,
        aliaThreadId,
        action: "consult" as const,
        storyId: null,
        instruction: prompt.trim(),
        koreyOrganization: null,
        destination: {
          kind: "linked-private-thread" as const,
          koreyThreadId,
          koreyThreadRevision: koreyThread.updated_at,
          mappingGeneration: linked.mapping.generation,
        },
        attachments: prepared.map(({ summary }) => summary),
      };
      const request = consultationRequestSchema.parse({
        ...unsigned,
        requestHash: hash(JSON.stringify(unsigned)),
      });
      let operation = createOperation(db, request);
      operation = transitionOperation(db, {
        id: operation.id,
        from: "requested",
        to: "attachment-upload-dispatching",
        patch: { koreyThreadId },
      });
      let uploaded: Awaited<ReturnType<KoreyClient["uploadAttachments"]>> = [];
      try {
        uploaded = prepared.length
          ? await api.uploadAttachments(
              koreyThread.id,
              prepared.map(({ file }) => file),
              signal,
            )
          : [];
        signal?.throwIfAborted();
      } catch (error) {
        const outcome = mutationWasRejected(error)
          ? "Korey rejected the attachment upload."
          : "The attachment upload outcome may be unknown and files may still consume conversation quota.";
        const detail = `${outcome} No consultation message was knowingly sent; inspect Korey before retrying. ${error instanceof Error ? error.message : String(error)}`;
        transitionOperation(db, {
          id: operation.id,
          from: "attachment-upload-dispatching",
          to: "definite-failure",
          patch: { error: detail },
        });
        throw new Error(`Korey consultation ${operation.id}: ${detail}`);
      }
      const consultationText = operationPrompt(request);
      const attachmentIds = uploaded.map((file) => file.id);
      // Record exact bytes and attachment IDs before the only message POST.
      operation = transitionOperation(db, {
        id: operation.id,
        from: "attachment-upload-dispatching",
        to: "message-dispatching",
        patch: { dispatchedText: consultationText, attachmentIds },
      });
      try {
        const sent = await api.sendMessage(
          koreyThread.id,
          consultationText,
          signal,
          attachmentIds,
        );
        operation = transitionOperation(db, {
          id: operation.id,
          from: "message-dispatching",
          to: "awaiting-response",
          patch: { koreyMessageId: sent.message_id },
        });
      } catch (error) {
        if (mutationWasRejected(error)) {
          const detail = `Korey rejected consultation ${operation.id} before accepting it. ${error instanceof Error ? error.message : String(error)}`;
          transitionOperation(db, {
            id: operation.id,
            from: "message-dispatching",
            to: "definite-failure",
            patch: { error: detail },
          });
          throw new Error(detail);
        }
        operation = transitionOperation(db, {
          id: operation.id,
          from: "message-dispatching",
          to: "reconcile-required",
          patch: {
            error: `Consultation dispatch outcome is unknown. ${error instanceof Error ? error.message : String(error)}`,
          },
        });
        let reconciledMessageId: string | null;
        try {
          reconciledMessageId = await findOperationMessage(
            api,
            operation,
            signal,
          );
        } catch (reconcileError) {
          const detail = `Korey consultation ${operation.id} has an unknown dispatch outcome and reconciliation failed. Use korey_reconcile_operation; do not resend automatically. ${reconcileError instanceof Error ? reconcileError.message : String(reconcileError)}`;
          updateOperationError(db, operation.id, detail);
          throw new Error(detail);
        }
        if (reconciledMessageId === null) {
          throw new Error(
            `Korey consultation ${operation.id} has an unknown dispatch outcome and no exact history match is visible. Use korey_reconcile_operation; do not resend automatically. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        operation = transitionOperation(db, {
          id: operation.id,
          from: "reconcile-required",
          to: "awaiting-response",
          patch: { koreyMessageId: reconciledMessageId, error: null },
        });
      }
      return {
        created: linked.created,
        koreyThread,
        operation: await finishOperationPolling(api, operation, signal),
      };
    });
  }

  function mappingDestination(aliaThreadId: string) {
    const mapping = getMapping(db, aliaThreadId);
    if (mapping === null) {
      return {
        kind: "new-private-thread" as const,
        koreyThreadId: null,
        koreyThreadRevision: null,
        mappingGeneration: 0,
      };
    }
    if (mapping.state === "unlinked") {
      return {
        kind: "new-private-thread" as const,
        koreyThreadId: null,
        koreyThreadRevision: null,
        mappingGeneration: mapping.generation,
      };
    }
    if (mapping.state === "ready" && mapping.koreyThreadId !== null) {
      return {
        kind: "linked-private-thread" as const,
        koreyThreadId: mapping.koreyThreadId,
        koreyThreadRevision: null,
        mappingGeneration: mapping.generation,
      };
    }
    throw new Error(
      `The Korey mapping for this VesnALIA thread is ${mapping.state}. Reconcile it with VesnALIA korey link or unlink before requesting a connector change.`,
    );
  }

  async function requestDestination(
    api: KoreyClient,
    aliaThreadId: string,
    signal?: AbortSignal,
  ) {
    const destination = mappingDestination(aliaThreadId);
    if (destination.kind === "new-private-thread") return destination;
    const thread = await api.getThread(destination.koreyThreadId, signal);
    assertPrivateThread(thread);
    if (thread.state !== "ready") {
      throw new Error(
        `Linked Korey thread ${thread.id} is ${thread.state}, not ready. Wait for Korey to finish or link a ready conversation before sending the request.`,
      );
    }
    return { ...destination, koreyThreadRevision: thread.updated_at };
  }

  function mappingStillMatches(request: OperationRequest): boolean {
    const mapping = getMapping(db, request.aliaThreadId);
    if (request.destination.kind === "new-private-thread") {
      return mapping === null
        ? request.destination.mappingGeneration === 0
        : mapping.state === "unlinked" &&
            mapping.generation === request.destination.mappingGeneration;
    }
    return (
      mapping?.state === "ready" &&
      mapping.generation === request.destination.mappingGeneration &&
      mapping.koreyThreadId === request.destination.koreyThreadId
    );
  }

  function requestMappingMatches(
    request: OperationRequest,
    mapping: MappingRecord,
  ): boolean {
    if (request.destination.kind === "new-private-thread") {
      return (
        mapping.state === "ready" &&
        mapping.koreyThreadId !== null &&
        mapping.marker === request.operationId &&
        mapping.generation === request.destination.mappingGeneration + 1
      );
    }
    return (
      mapping.state === "ready" &&
      mapping.generation === request.destination.mappingGeneration &&
      mapping.koreyThreadId === request.destination.koreyThreadId
    );
  }

  function assertNoUnresolvedOperations(
    aliaThreadId: string,
    koreyThreadId: string | null,
  ): void {
    const unresolved = listUnresolvedOperations(db, aliaThreadId, koreyThreadId);
    const [first] = unresolved;
    if (first !== undefined) {
      const details = unresolved
        .map(
          (operation) =>
            `${operation.id} (${operation.status}, originating VesnALIA thread ${operation.aliaThreadId})`,
        )
        .join(", ");
      throw new Error(
        `An earlier Korey operation is unresolved: ${details}. This request was not sent. Inspect it here with korey_get_operation, or use VesnALIA korey operation show ${first.id} --alia-thread ${first.aliaThreadId}, then resume or reconcile it. If the outcome remains unknown, ask the user before using VesnALIA korey operation resolve; do not submit a replacement automatically.`,
      );
    }
  }

  function shortcutPrompt(
    request: Pick<
      ShortcutRequest,
      "action" | "operationId" | "storyId" | "instruction"
    >,
    legacyApproval = false,
  ): string {
    const authorization = legacyApproval
      ? "The user approved this external write through VesnALIA's confirmation UI."
      : "The user requested this Shortcut change from VesnALIA.";
    return request.action === "create"
      ? [
          authorization,
          operationMarker(request.operationId, legacyApproval),
          "Create exactly one Shortcut Story in the connected workspace.",
          "Return the created Story ID and URL. Do not create a duplicate if this operation reference already appears in the conversation.",
          "",
          request.instruction,
        ].join("\n")
      : [
          authorization,
          operationMarker(request.operationId, legacyApproval),
          `Update Shortcut Story ${request.storyId}.`,
          "Preserve unrelated fields. Return the Story ID, URL, and fields changed.",
          "",
          request.instruction,
        ].join("\n");
  }

  function operationPrompt(request: OperationRequest): string {
    if (request.action === "consult") {
      return `${CONSULT_PREFIX}${consultationMarker(request.operationId)}\n\n${request.instruction}`;
    }
    if (request.action !== "change") return shortcutPrompt(request);
    return [
      "The user requested this connector change from VesnALIA.",
      operationMarker(request.operationId),
      "Carry out the requested change using your connected services and workspace conventions.",
      "Change only the requested targets and preserve unrelated settings. If the intended change or destination is unclear, ask for clarification before making changes.",
      "Do not repeat a change if this operation reference already appears in the conversation.",
      "Return the affected resource identifiers or URLs and describe the result.",
      "",
      request.instruction,
    ].join("\n");
  }

  function storedOperationPrompt(operation: OperationRecord): string {
    if (operation.dispatchedText !== null) return operation.dispatchedText;
    // Original journals predate dispatched_text. Preserve the version 1 prompt
    // and validate only the fields it used, independent of today's approval UI.
    const legacy = z
      .object({
        operationId: z.string(),
        action: z.enum(["create", "update"]),
        storyId: z.string().nullable(),
        instruction: z.string(),
      })
      .safeParse(operation.request);
    if (operation.requestVersion !== 1 || !legacy.success) {
      throw new Error(
        "This operation has no recorded message text and its request version cannot be reconciled by this plugin. Inspect Korey and the affected service, then use operation resolve.",
      );
    }
    return shortcutPrompt(legacy.data, true);
  }

  function messageMatchesRequest(
    message: KoreyMessage,
    expectedText: string,
    expectedAttachmentIds: readonly string[],
  ): boolean {
    if (message.role !== "user") return false;
    const text = message.contents.filter((content) => content.type === "text");
    if (text.length !== 1 || text[0]?.text !== expectedText) return false;
    const attachmentIds = message.contents.flatMap((content) =>
      content.type === "image" || content.type === "document"
        ? [content.attachment_id]
        : [],
    );
    return (
      message.contents.length === 1 + attachmentIds.length &&
      attachmentIds.length === expectedAttachmentIds.length &&
      expectedAttachmentIds.every((id) => attachmentIds.includes(id))
    );
  }

  async function findMessageByRequest(
    api: KoreyClient,
    koreyThreadId: string,
    expectedText: string,
    expectedAttachmentIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<string | null> {
    const messages = await api.listAllMessages(koreyThreadId, signal);
    const matches = messages.filter((message) =>
      messageMatchesRequest(message, expectedText, expectedAttachmentIds),
    );
    if (matches.length > 1) {
      throw new Error(
        "Korey conversation contains multiple exact copies of the request; inspect it manually.",
      );
    }
    return matches[0]?.id ?? null;
  }

  async function findOperationMessage(
    api: KoreyClient,
    operation: OperationRecord,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (operation.koreyThreadId === null) return null;
    return findMessageByRequest(
      api,
      operation.koreyThreadId,
      storedOperationPrompt(operation),
      operation.attachmentIds,
      signal,
    );
  }

  async function finishOperationPolling(
    api: KoreyClient,
    operation: OperationRecord,
    signal?: AbortSignal,
  ): Promise<OperationRecord> {
    if (
      (operation.status !== "awaiting-response" &&
        operation.status !== "korey-complete") ||
      operation.koreyThreadId === null ||
      operation.koreyMessageId === null
    ) {
      throw new Error(
        `Korey operation ${operation.id} cannot resume response polling from ${operation.status}.`,
      );
    }
    const { koreyThreadId, koreyMessageId } = operation;
    if (operation.status === "korey-complete") {
      // Older versions could cache an intermediate answer as complete.
      // An explicit resume refreshes it using the recorded message, never POST.
      operation = transitionOperation(db, {
        id: operation.id,
        from: "korey-complete",
        to: "awaiting-response",
        patch: {
          completedAt: null,
          responseText: null,
          responseTruncated: false,
        },
      });
    }
    try {
      const messages = await api.waitForResponse(
        koreyThreadId,
        koreyMessageId,
        signal,
      );
      const response = boundedText(formatKoreyMessages(messages));
      return transitionOperation(db, {
        id: operation.id,
        from: "awaiting-response",
        to: "korey-complete",
        patch: {
          completedAt: Date.now(),
          error: null,
          responseText: response.text,
          responseTruncated: response.truncated,
        },
      });
    } catch (error) {
      if (error instanceof KoreyResponsePendingError || signal?.aborted) {
        return updateOperationError(db, operation.id, null);
      }
      updateOperationError(
        db,
        operation.id,
        `Response polling can be resumed safely: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error(
        `Korey accepted operation ${operation.id}, but response polling did not complete. Use korey_resume_operation or VesnALIA korey operation resume ${operation.id}; do not submit a new request. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function executeOperation(
    api: KoreyClient,
    operation: OperationRecord,
    request: OperationRequest,
    prepared: readonly PreparedAttachment[],
    signal?: AbortSignal,
  ): Promise<OperationRecord> {
    const target = request.action === "change" ? "connector" : "Shortcut";
    transitionOperation(db, {
      id: operation.id,
      from: "requested",
      to: "preparing",
      patch: { error: null },
    });

    let linked: Awaited<ReturnType<typeof ensureMapping>>;
    let koreyThread: KoreyThread;
    try {
      linked = await ensureMapping(
        api,
        operation.aliaThreadId,
        signal,
        request.destination.kind === "new-private-thread"
          ? {
              previousGeneration: request.destination.mappingGeneration,
              marker: operation.id,
            }
          : undefined,
      );
      if (!requestMappingMatches(request, linked.mapping)) {
        throw new Error(
          "The Korey destination changed while preparing the request; inspect the linked conversation before trying again.",
        );
      }
      if (linked.mapping.koreyThreadId === null) {
        throw new Error("Korey mapping is incomplete");
      }
      transitionOperation(db, {
        id: operation.id,
        from: "preparing",
        to: "preparing",
        patch: { koreyThreadId: linked.mapping.koreyThreadId },
      });
      koreyThread = await api.getThread(linked.mapping.koreyThreadId, signal);
      assertPrivateThread(koreyThread);
      if (
        request.destination.kind === "linked-private-thread" &&
        koreyThread.updated_at !== request.destination.koreyThreadRevision
      ) {
        throw new Error(
          "The Korey conversation changed while preparing the request; inspect it before trying again.",
        );
      }
      if (koreyThread.state !== "ready") {
        throw new Error(
          `Linked Korey thread ${koreyThread.id} is ${koreyThread.state}, not ready`,
        );
      }
    } catch (error) {
      transitionOperation(db, {
        id: operation.id,
        from: "preparing",
        to: "definite-failure",
        patch: {
          error: `No ${target} message was dispatched. ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      throw new Error(
        `Korey operation ${operation.id} stopped before sending a ${target} message. Resolve the error before trying again. ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    transitionOperation(db, {
      id: operation.id,
      from: "preparing",
      to: "thread-ready",
      patch: { koreyThreadId: koreyThread.id },
    });

    let attachmentIds: string[] = [];
    if (prepared.length > 0) {
      transitionOperation(db, {
        id: operation.id,
        from: "thread-ready",
        to: "attachment-upload-dispatching",
      });
      try {
        const uploaded = await api.uploadAttachments(
          koreyThread.id,
          prepared.map(({ file }) => file),
          signal,
        );
        attachmentIds = uploaded.map((file) => file.id);
      } catch (error) {
        transitionOperation(db, {
          id: operation.id,
          from: "attachment-upload-dispatching",
          to: "definite-failure",
          patch: {
            error: `No ${target} message was dispatched. Attachment upload outcome may be unknown. ${error instanceof Error ? error.message : String(error)}`,
          },
        });
        throw new Error(
          `Korey operation ${operation.id} sent no ${target} message because attachment upload did not complete. Uploaded files may still consume the thread quota; inspect Korey before starting another operation.`,
        );
      }
      transitionOperation(db, {
        id: operation.id,
        from: "attachment-upload-dispatching",
        to: "attachments-uploaded",
        patch: { attachmentIds },
      });
    } else {
      transitionOperation(db, {
        id: operation.id,
        from: "thread-ready",
        to: "attachments-uploaded",
        patch: { attachmentIds: [] },
      });
    }

    // Recovery in a previous VesnALIA thread can change this conversation's journal
    // while preparation awaits Korey, outside the current alia-thread lock.
    try {
      assertNoUnresolvedOperations(operation.aliaThreadId, koreyThread.id);
      signal?.throwIfAborted();
    } catch (error) {
      transitionOperation(db, {
        id: operation.id,
        from: "attachments-uploaded",
        to: "definite-failure",
        patch: {
          error: `No ${target} message was dispatched. ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      throw error;
    }
    const dispatchedText = operationPrompt(request);
    transitionOperation(db, {
      id: operation.id,
      from: "attachments-uploaded",
      to: "message-dispatching",
      patch: { dispatchedText },
    });
    try {
      const sent = await api.sendMessage(
        koreyThread.id,
        dispatchedText,
        signal,
        attachmentIds,
      );
      operation = transitionOperation(db, {
        id: operation.id,
        from: "message-dispatching",
        to: "awaiting-response",
        patch: { koreyMessageId: sent.message_id },
      });
    } catch (error) {
      if (mutationWasRejected(error)) {
        transitionOperation(db, {
          id: operation.id,
          from: "message-dispatching",
          to: "definite-failure",
          patch: {
            error: `Korey rejected the ${target} message before accepting it. ${error instanceof Error ? error.message : String(error)}`,
          },
        });
        throw new Error(
          `Korey rejected operation ${operation.id}; no ${target}-intended message was accepted. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      operation = transitionOperation(db, {
        id: operation.id,
        from: "message-dispatching",
        to: "reconcile-required",
        patch: {
          error: `Message dispatch outcome is unknown. ${error instanceof Error ? error.message : String(error)}`,
        },
      });
      try {
        const messageId = await findOperationMessage(api, operation, signal);
        if (messageId !== null) {
          operation = transitionOperation(db, {
            id: operation.id,
            from: "reconcile-required",
            to: "awaiting-response",
            patch: { error: null, koreyMessageId: messageId },
          });
        }
      } catch (reconcileError) {
        updateOperationError(
          db,
          operation.id,
          `Message dispatch and reconciliation are unresolved. ${reconcileError instanceof Error ? reconcileError.message : String(reconcileError)}`,
        );
      }
      if (operation.status !== "awaiting-response") {
        throw new Error(
          `Korey operation ${operation.id} has an unknown ${target} outcome. Use korey_reconcile_operation or VesnALIA korey operation reconcile ${operation.id}; never submit a replacement automatically.`,
        );
      }
    }
    return finishOperationPolling(api, operation, signal);
  }

  async function applyChange(
    aliaThreadId: string,
    input: ChangeInput,
    signal?: AbortSignal,
  ): Promise<OperationRecord> {
    const storyId =
      input.action === "update" && input.storyId !== undefined
        ? normalizeStoryId(input.storyId)
        : null;
    if (input.action === "update" && storyId === null) {
      throw new Error(
        `Invalid Shortcut story ID ${JSON.stringify(input.storyId)}`,
      );
    }
    return withThreadLock(aliaThreadId, async () => {
      signal?.throwIfAborted();
      const currentDestination = mappingDestination(aliaThreadId);
      assertNoUnresolvedOperations(
        aliaThreadId,
        currentDestination.koreyThreadId,
      );
      const api = await client();
      const [prepared, identity, destination] = await Promise.all([
        readAttachments(aliaThreadId, input.files ?? [], signal),
        api.identity(signal),
        requestDestination(api, aliaThreadId, signal),
      ]);
      signal?.throwIfAborted();
      const unsigned = {
        operationId: `korey-${randomUUID()}`,
        aliaThreadId,
        action: input.action,
        storyId,
        instruction: input.instruction.trim(),
        koreyOrganization: identity.korey_organization_slug,
        destination,
        attachments: prepared.map(({ summary }) => summary),
      };
      const request = operationRequestSchema.parse({
        ...unsigned,
        requestHash: hash(JSON.stringify(unsigned)),
      });
      if (!mappingStillMatches(request)) {
        throw new Error(
          "The Korey destination changed while preparing the request. Inspect the linked conversation before trying again.",
        );
      }
      assertNoUnresolvedOperations(aliaThreadId, destination.koreyThreadId);
      const operation = createOperation(db, request);
      return executeOperation(api, operation, request, prepared, signal);
    });
  }

  async function askKorey(
    aliaThreadId: string,
    input: z.infer<typeof askInputSchema>,
    signal?: AbortSignal,
  ) {
    if (input.mode === "change") {
      return operationView(
        await applyChange(
          aliaThreadId,
          {
            action: "change",
            instruction: input.prompt,
            files: input.files,
          },
          signal,
        ),
      );
    }
    const result = await sendConsultation(
      aliaThreadId,
      input.prompt,
      signal,
      input.files,
    );
    return {
      ...operationView(result.operation),
      created: result.created,
      koreyThreadId: result.koreyThread.id,
      appUrl: result.koreyThread.app_url,
    };
  }

  function operationForThread(
    aliaThreadId: string,
    operationId: string,
  ): OperationRecord {
    const operation = getOperation(db, operationId);
    const destination = getMapping(db, aliaThreadId)?.koreyThreadId ?? null;
    if (
      operation === null ||
      (operation.aliaThreadId !== aliaThreadId &&
        (destination === null || operation.koreyThreadId !== destination))
    ) {
      throw new Error(`Unknown Korey operation ${operationId}`);
    }
    return operation;
  }

  function operationsForThread(
    aliaThreadId: string,
    limit: number,
  ): OperationRecord[] {
    return listOperations(
      db,
      aliaThreadId,
      limit,
      getMapping(db, aliaThreadId)?.koreyThreadId ?? null,
    );
  }

  async function withOperationLock<T>(
    aliaThreadId: string,
    operationId: string,
    run: (operation: OperationRecord) => Promise<T>,
  ): Promise<T> {
    const operation = operationForThread(aliaThreadId, operationId);
    // Relinked and originating threads must serialize recovery of the same row.
    return withThreadLock(operation.aliaThreadId, async () =>
      run(operationForThread(aliaThreadId, operationId)),
    );
  }

  async function resumeOperation(
    aliaThreadId: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<OperationRecord> {
    return withOperationLock(aliaThreadId, operationId, async (operation) => {
      return finishOperationPolling(await client(), operation, signal);
    });
  }

  async function reconcileOperation(
    aliaThreadId: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<{ reconciled: boolean; operation: OperationRecord }> {
    return withOperationLock(aliaThreadId, operationId, async (current) => {
      let operation = current;
      if (
        operation.status === "awaiting-response" ||
        operation.status === "korey-complete"
      ) {
        operation = await finishOperationPolling(
          await client(),
          operation,
          signal,
        );
        return { reconciled: true, operation };
      }
      if (operation.status !== "reconcile-required") {
        throw new Error(
          `Korey operation ${operation.id} is ${operation.status}, not reconcile-required.`,
        );
      }
      const api = await client();
      const messageId = await findOperationMessage(api, operation, signal);
      if (messageId === null) {
        operation = updateOperationError(
          db,
          operation.id,
          "No matching Korey message is visible. This does not prove the original dispatch failed; inspect Korey and the affected service before any replacement.",
        );
        return { reconciled: false, operation };
      }
      operation = transitionOperation(db, {
        id: operation.id,
        from: "reconcile-required",
        to: "awaiting-response",
        patch: { error: null, koreyMessageId: messageId },
      });
      operation = await finishOperationPolling(api, operation, signal);
      return { reconciled: true, operation };
    });
  }

  async function resolveOperation(
    aliaThreadId: string,
    operationId: string,
    note: string,
    signal?: AbortSignal,
  ): Promise<OperationRecord> {
    const operation = operationForThread(aliaThreadId, operationId);
    if (
      operation.status !== "awaiting-response" &&
      operation.status !== "reconcile-required"
    ) {
      throw new Error(
        `Korey operation ${operation.id} is ${operation.status}; only unresolved operations can be manually resolved.`,
      );
    }
    const resolutionNote =
      operationResolutionPayloadSchema.shape.note.safeParse(note);
    if (!resolutionNote.success) {
      throw new Error(
        "The resolution note must contain 1 to 2000 characters after trimming whitespace.",
      );
    }
    const resolutionHash = (current: OperationRecord) =>
      hash(JSON.stringify({ operation: current, note: resolutionNote.data }));
    const payload = operationResolutionPayloadSchema.parse({
      operationId: operation.id,
      resolutionHash: resolutionHash(operation),
      status: operation.status,
      instruction: storedRequestSummarySchema.parse(operation.request)
        .instruction,
      koreyThreadId: operation.koreyThreadId,
      note: resolutionNote.data,
    });
    const interaction = await alia.ui.requestInput(
      {
        threadId: aliaThreadId,
        rendererId: OPERATION_RESOLUTION_RENDERER_ID,
        title: "Resolve Korey operation manually",
        payload,
        timeoutMs: INTERACTION_TIMEOUT_MS,
      },
      { signal },
    );
    if (interaction.outcome === "cancelled") {
      throw new Error(
        `Operation resolution cancelled (${interaction.reason}); the operation remains unresolved.`,
      );
    }
    const response = operationResolutionResponseSchema.safeParse(
      interaction.value,
    );
    if (
      !response.success ||
      response.data.operationId !== payload.operationId ||
      response.data.resolutionHash !== payload.resolutionHash
    ) {
      throw new Error(
        "Operation resolution was not confirmed for this operation and note.",
      );
    }
    return withOperationLock(aliaThreadId, operationId, async (current) => {
      if (resolutionHash(current) !== payload.resolutionHash) {
        throw new Error(
          "The operation changed while resolution was pending. Inspect it again before resolving.",
        );
      }
      return transitionOperation(db, {
        id: operationId,
        from: operation.status,
        to: "manually-resolved",
        patch: { resolutionNote: payload.note, completedAt: Date.now() },
      });
    });
  }

  alia.cli.register({
    name: "korey",
    summary: "Ask Korey to work with your connected tools",
    commands: CLI_COMMANDS,
    async run(argv, context) {
      const [command, ...rest] = argv;
      if (command === undefined || command === "help" || command === "--help") {
        return { exitCode: 0, stdout: usage() };
      }
      try {
        const parsed = parseCommonCliArgs(rest);
        if (parsed.change && command !== "ask") {
          throw new Error("--change is supported only by ask");
        }
        if (command === "status") {
          if (
            parsed.positional.length > 0 ||
            parsed.aliaThreadId !== undefined ||
            parsed.files.length > 0 ||
            parsed.after !== undefined ||
            parsed.limit !== undefined
          ) {
            throw new Error("status accepts only --json");
          }
          const state = await authState();
          const { method } = state;
          const identity = await clientFor(state).identity(context.signal);
          return cliOutput(
            parsed.json,
            { ...identity, authMethod: method },
            `Authenticated as ${accountLabel(identity)} with ${method === "oauth" ? "OAuth" : "a personal access token"}.`,
          );
        }
        if (command === "login") {
          if (
            parsed.positional.length > 1 ||
            parsed.aliaThreadId !== undefined ||
            parsed.files.length > 0 ||
            parsed.after !== undefined ||
            parsed.limit !== undefined
          ) {
            throw new Error(
              "login accepts only an optional redirect URL and --json",
            );
          }
          const redirectUrl = parsed.positional[0];
          if (redirectUrl !== undefined) {
            await connection.complete(redirectUrl);
            const identity = await (await client()).identity(context.signal);
            return cliOutput(
              parsed.json,
              { ...identity, authMethod: "oauth" },
              `Connected to Korey as ${accountLabel(identity)}.${setupNoticeShown ? ` ${RELOAD_HINT}` : ""}`,
            );
          }
          const { authorizationUrl, expiresAt } = await connection.start();
          return cliOutput(
            parsed.json,
            { authorizationUrl, expiresAt: new Date(expiresAt).toISOString() },
            [
              "Open this URL to connect VesnALIA to your Korey account:",
              "",
              `  ${authorizationUrl}`,
              "",
              "alia finishes connecting when you approve access. If the browser ends on a page that cannot load, for example because VesnALIA runs on another computer, copy that page's address and run:",
              "",
              "  VesnALIA korey login '<address>'",
              "",
              "The link expires in 15 minutes.",
            ].join("\n"),
          );
        }
        if (command === "logout") {
          if (
            parsed.positional.length > 0 ||
            parsed.aliaThreadId !== undefined ||
            parsed.files.length > 0 ||
            parsed.after !== undefined ||
            parsed.limit !== undefined
          ) {
            throw new Error("logout accepts only --json");
          }
          const result = await connection.disconnect();
          const fallback =
            (await authState()).method === "token"
              ? " The personal access token setting is used from now on."
              : "";
          return cliOutput(
            parsed.json,
            result,
            result.wasConnected
              ? `Disconnected your Korey account.${fallback}`
              : `No Korey account was connected.${fallback}`,
          );
        }
        if (command === "threads") {
          if (parsed.aliaThreadId !== undefined || parsed.files.length > 0) {
            throw new Error("threads does not accept --alia-thread or --file");
          }
          const page = await (
            await client()
          ).listThreads({
            after: parsed.after,
            limit: parsed.limit,
            query: parsed.positional.join(" "),
            signal: context.signal,
          });
          return cliOutput(parsed.json, page, plainThreadList(page.data));
        }
        if (command === "show") {
          if (
            parsed.positional.length !== 1 ||
            parsed.aliaThreadId !== undefined ||
            parsed.files.length > 0
          ) {
            throw new Error("show requires exactly one Korey thread ID");
          }
          const api = await client();
          const threadId = parsed.positional[0]!;
          const [thread, messages] = await Promise.all([
            api.getThread(threadId, context.signal),
            api.listMessages(threadId, {
              after: parsed.after,
              limit: parsed.limit,
              signal: context.signal,
            }),
          ]);
          const value = { thread, messages };
          return cliOutput(
            parsed.json,
            value,
            plainConversation(thread, messages.data, messages.has_more),
          );
        }
        if (command === "link") {
          if (
            parsed.positional.length !== 1 ||
            parsed.files.length > 0 ||
            parsed.after !== undefined ||
            parsed.limit !== undefined
          ) {
            throw new Error("link requires exactly one Korey thread ID");
          }
          const aliaThreadId = cliThreadId(parsed.aliaThreadId, context.threadId);
          const thread = await linkThread(
            aliaThreadId,
            parsed.positional[0]!,
            context.signal,
          );
          const value = { aliaThreadId, koreyThread: thread };
          return cliOutput(
            parsed.json,
            value,
            `Linked VesnALIA thread ${aliaThreadId} to ${thread.name ?? thread.id}.`,
          );
        }
        if (command === "unlink") {
          if (
            parsed.positional.length > 0 ||
            parsed.files.length > 0 ||
            parsed.after !== undefined ||
            parsed.limit !== undefined
          ) {
            throw new Error("unlink accepts only --alia-thread and --json");
          }
          const aliaThreadId = cliThreadId(parsed.aliaThreadId, context.threadId);
          const removed = await unlinkThread(aliaThreadId);
          const value = { aliaThreadId, removed };
          return cliOutput(
            parsed.json,
            value,
            removed
              ? `Removed the Korey link for VesnALIA thread ${aliaThreadId}.`
              : `alia thread ${aliaThreadId} had no Korey link.`,
          );
        }
        if (command === "ask") {
          if (
            parsed.positional.length === 0 ||
            parsed.after !== undefined ||
            parsed.limit !== undefined
          ) {
            throw new Error("ask requires a message");
          }
          const aliaThreadId = cliThreadId(parsed.aliaThreadId, context.threadId);
          const result = await askKorey(
            aliaThreadId,
            askInputSchema.parse({
              prompt: parsed.positional.join(" "),
              mode: parsed.change ? "change" : "consult",
              files: parsed.files,
            }),
            context.signal,
          );
          return cliOutput(
            parsed.json,
            result,
            plainOperation(
              result,
              "appUrl" in result ? result.appUrl : undefined,
            ),
          );
        }
        if (command === "shortcut") {
          if (parsed.after !== undefined || parsed.limit !== undefined) {
            throw new Error("shortcut does not accept --after or --limit");
          }
          const [action, ...actionArgs] = parsed.positional;
          if (action !== "create" && action !== "update") {
            throw new Error("shortcut requires create or update");
          }
          const aliaThreadId = cliThreadId(parsed.aliaThreadId, context.threadId);
          let storyId: string | undefined;
          let instruction: string;
          if (action === "update") {
            storyId = actionArgs[0];
            instruction = actionArgs.slice(1).join(" ").trim();
            if (storyId === undefined || instruction.length === 0) {
              throw new Error(
                "shortcut update requires a Story ID and instruction",
              );
            }
          } else {
            instruction = actionArgs.join(" ").trim();
            if (instruction.length === 0) {
              throw new Error("shortcut create requires an instruction");
            }
          }
          const operation = await applyChange(
            aliaThreadId,
            {
              action,
              instruction,
              storyId,
              ...(parsed.files.length > 0 ? { files: parsed.files } : {}),
            },
            context.signal,
          );
          const value = operationView(operation);
          return cliOutput(parsed.json, value, plainOperation(value));
        }
        if (command === "operation") {
          if (parsed.files.length > 0 || parsed.after !== undefined) {
            throw new Error("operation does not accept --file or --after");
          }
          const [action, operationId, ...extra] = parsed.positional;
          const aliaThreadId = cliThreadId(parsed.aliaThreadId, context.threadId);
          if (action === "resolve") {
            if (
              operationId === undefined ||
              extra.length === 0 ||
              parsed.limit !== undefined
            ) {
              throw new Error(
                "operation resolve requires an operation ID and a resolution note",
              );
            }
            const operation = await resolveOperation(
              aliaThreadId,
              operationId,
              extra.join(" "),
              context.signal,
            );
            return cliOutput(
              parsed.json,
              operationView(operation),
              `Operation ${operation.id} was manually resolved. ${operation.resolutionNote}`,
            );
          }
          if (action === "list") {
            if (operationId !== undefined || extra.length > 0) {
              throw new Error("operation list accepts no operation ID");
            }
            const operations = operationsForThread(
              aliaThreadId,
              parsed.limit ?? 20,
            ).map(operationView);
            return cliOutput(
              parsed.json,
              operations,
              operations.length === 0
                ? "No Korey operations found."
                : operations
                    .map(
                      (operation) =>
                        `${operation.operationId}\t${operation.status}\t${operation.action}\t${operation.action === "consult" ? "consultation" : operation.action === "change" ? "connected services" : (operation.storyId ?? "new Story")}`,
                    )
                    .join("\n"),
            );
          }
          if (
            (action !== "show" &&
              action !== "resume" &&
              action !== "reconcile") ||
            operationId === undefined ||
            extra.length > 0 ||
            parsed.limit !== undefined
          ) {
            throw new Error(
              "operation requires list, show <id>, resume <id>, reconcile <id>, or resolve <id> <note>",
            );
          }
          if (action === "show") {
            const operation = operationForThread(aliaThreadId, operationId);
            return cliOutput(
              parsed.json,
              operationView(operation),
              JSON.stringify(operationView(operation), null, 2),
            );
          }
          if (action === "resume") {
            const operation = await resumeOperation(
              aliaThreadId,
              operationId,
              context.signal,
            );
            return cliOutput(
              parsed.json,
              operationView(operation),
              plainOperation(operationView(operation)),
            );
          }
          const result = await reconcileOperation(
            aliaThreadId,
            operationId,
            context.signal,
          );
          return cliOutput(
            parsed.json,
            {
              reconciled: result.reconciled,
              ...operationView(result.operation),
            },
            plainOperation(operationView(result.operation)),
          );
        }
        throw new Error(
          `Unknown command ${JSON.stringify(command)}\n${usage()}`,
        );
      } catch (error) {
        const message =
          error instanceof Error &&
          "code" in error &&
          error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
            ? "Unknown option. See VesnALIA korey --help for supported options. Use -- before positional text starting with a dash."
            : error instanceof Error
              ? error.message
              : String(error);
        return {
          exitCode: 1,
          stderr: `${message}\n`,
        };
      }
    },
  });

  alia.agents.registerTool({
    name: "korey_status",
    description:
      "Check the configured Korey identity and organization without changing anything.",
    parameters: z.object({}).strict(),
    async execute(_input, context) {
      return executeJsonTool(async () =>
        (await client()).identity(context.signal),
      );
    },
  });

  alia.agents.registerTool({
    name: "korey_list_threads",
    description: "List the authenticated user's owned Korey threads.",
    parameters: z
      .object({
        query: z.string().optional(),
        after: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict(),
    async execute({ query, after, limit }, context) {
      return executeJsonTool(async () =>
        (await client()).listThreads({
          query,
          after,
          limit,
          signal: context.signal,
        }),
      );
    },
  });

  alia.agents.registerTool({
    name: "korey_get_thread",
    description: "Read a Korey thread and one paginated message page.",
    parameters: z
      .object({
        threadId: z.string().min(1),
        after: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(200),
      })
      .strict(),
    async execute({ threadId, after, limit }, context) {
      return executeJsonTool(async () => {
        const api = await client();
        const [thread, messages] = await Promise.all([
          api.getThread(threadId, context.signal),
          api.listMessages(threadId, {
            after,
            limit,
            signal: context.signal,
          }),
        ]);
        return { thread, messages };
      });
    },
  });

  alia.agents.registerTool({
    name: "korey_link_thread",
    description:
      "Link an existing private Korey thread to the current VesnALIA thread so future requests continue it.",
    parameters: z.object({ koreyThreadId: z.string().min(1) }).strict(),
    async execute({ koreyThreadId }, context) {
      return executeJsonTool(async () => ({
        aliaThreadId: context.threadId,
        koreyThread: await linkThread(
          context.threadId,
          koreyThreadId,
          context.signal,
        ),
      }));
    },
  });

  alia.agents.registerTool({
    name: "korey_unlink_thread",
    description:
      "Remove the Korey conversation link for the current VesnALIA thread without changing the remote Korey thread.",
    parameters: z.object({}).strict(),
    async execute(_input, context) {
      return executeJsonTool(async () => ({
        aliaThreadId: context.threadId,
        removed: await unlinkThread(context.threadId),
      }));
    },
  });

  alia.agents.registerTool({
    name: "korey_ask",
    description:
      "Ask Korey to research connected services or perform user-requested changes, including feature-flag updates. Use mode change for requested actions and mode consult for research or drafts. Continues this VesnALIA thread's private Korey conversation.",
    instructions:
      'For "Ask Korey ..." requests, delegate the user’s desired outcome and relevant context. Use mode change when the user requested an action in a connected service, including LaunchDarkly feature-flag updates or Sentry issue changes. The user’s explicit request authorizes that change; ask only if its scope or destination is unclear. Use mode consult for research, questions, and drafts without changes. Prefer korey_shortcut_change for Shortcut Story creation or updates. These modes guide Korey through prompts; connector permissions remain in Korey. Never resend a consultation or change to retrieve its answer or retry an unknown outcome. For awaiting-response, use korey_resume_operation with the existing operation ID. For reconcile-required, use korey_reconcile_operation.',
    parameters: askInputSchema,
    async execute(input, context) {
      return executeJsonTool(() =>
        askKorey(context.threadId, input, context.signal),
      );
    },
  });

  alia.agents.registerTool({
    name: "korey_shortcut_change",
    description:
      "Ask Korey to create or update a Shortcut Story using its connector and workspace conventions. An explicit user request authorizes the change; no extra confirmation form is shown.",
    instructions:
      "Call only when the user requested the exact Shortcut create or update. The user’s explicit request is sufficient authorization. Ask for clarification only if the intended change or destination is unclear. Never retry an operation with an unknown outcome by calling this tool again. Inspect it with korey_get_operation, then use korey_resume_operation or korey_reconcile_operation when applicable.",
    parameters: shortcutChangeInputSchema,
    async execute(input, context) {
      return executeJsonTool(async () =>
        operationView(
          await applyChange(context.threadId, input, context.signal),
        ),
      );
    },
  });

  alia.agents.registerTool({
    name: "korey_list_operations",
    description:
      "List recent Korey consultations and changes from this VesnALIA thread or its linked Korey conversation.",
    parameters: z
      .object({ limit: z.number().int().min(1).max(50).default(20) })
      .strict(),
    async execute({ limit }, context) {
      return executeJsonTool(async () =>
        operationsForThread(context.threadId, limit).map(operationView),
      );
    },
  });

  alia.agents.registerTool({
    name: "korey_get_operation",
    description:
      "Inspect one Korey consultation or change operation without sending or retrying it.",
    parameters: z.object({ operationId: z.string().min(1) }).strict(),
    async execute({ operationId }, context) {
      return executeJsonTool(async () =>
        operationView(operationForThread(context.threadId, operationId)),
      );
    },
  });

  alia.agents.registerTool({
    name: "korey_resume_operation",
    description:
      "Resume read-only polling for an awaiting-response consultation or change, or refresh a korey-complete answer, using its recorded message ID. This never resends the request.",
    parameters: z.object({ operationId: z.string().min(1) }).strict(),
    async execute({ operationId }, context) {
      return executeJsonTool(async () =>
        operationView(
          await resumeOperation(context.threadId, operationId, context.signal),
        ),
      );
    },
  });

  alia.agents.registerTool({
    name: "korey_reconcile_operation",
    description:
      "Read the linked Korey conversation to reconcile an ambiguous message dispatch. This never resends the request.",
    parameters: z.object({ operationId: z.string().min(1) }).strict(),
    async execute({ operationId }, context) {
      return executeJsonTool(async () => {
        const result = await reconcileOperation(
          context.threadId,
          operationId,
          context.signal,
        );
        return {
          reconciled: result.reconciled,
          ...operationView(result.operation),
        };
      });
    },
  });

  alia.agents.configure(() => ({
    tools: [
      "korey_status",
      "korey_list_threads",
      "korey_get_thread",
      "korey_link_thread",
      "korey_unlink_thread",
      "korey_ask",
      "korey_shortcut_change",
      "korey_list_operations",
      "korey_get_operation",
      "korey_resume_operation",
      "korey_reconcile_operation",
    ],
    skills: ["korey"],
    instructions:
      'Korey brings its connected services to every VesnALIA harness. For "Ask Korey ..." requests, delegate the user’s goal and context. Use korey_ask with mode change for user-requested connector actions, including feature-flag updates, and mode consult for research, analysis, and drafts. Prefer korey_shortcut_change for Shortcut Story creation or updates. An explicit user request authorizes its change without a second confirmation. Connector setup, permissions, and reauthentication remain in Korey; request modes guide Korey through prompts. Consultations and changes return operation IDs. If a response is still pending, use korey_resume_operation with that ID to retrieve the answer. Never resend a request to retrieve its answer or retry an unknown outcome; inspect or reconcile the existing operation.',
  }));
}
