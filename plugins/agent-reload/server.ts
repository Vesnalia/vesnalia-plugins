import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type AliaPluginApi,
} from "@vesnalia/plugin-sdk";
import { z } from "zod";

// Each of these bridges rebuilds a thread's session, keeping its
// conversation, whenever that thread's contributed environment changes.
// Codex is absent: its rebuild check ignores contributed environment.
const BUILT_IN_PROVIDER_IDS = [
  "claude-code",
  "pi",
  "acp-opencode",
  "acp-omp",
  "acp-grok",
  "acp-hermes-agent",
  "acp-cursor",
];

// Changing this per-thread value is what forces the rebuild.
const RELOAD_NONCE_ENV = "AGENT_RELOAD_NONCE";

const nonceKey = (threadId: string) => `nonce:${threadId}`;

const threadInput = z.object({ threadId: z.string().min(1) });

const refusalSchema = z.object({
  reason: z.enum(["unsupported_provider", "thread_not_found", "thread_deleted"]),
  message: z.string(),
});
type Refusal = z.infer<typeof refusalSchema>;

export const rpcContract = defineRpcContract({
  reload_supported: {
    input: threadInput,
    output: z.object({ supported: z.boolean() }),
  },
  reload: {
    input: threadInput,
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true) }),
      refusalSchema.extend({ ok: z.literal(false) }),
    ]),
  },
});

function parseProviderIds(value: string): string[] {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

// alia.sdk rejects failed API calls with an error carrying the HTTP status;
// its class is not exported by the SDK.
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    extraProviderIds: {
      type: "string",
      label: "Additional provider IDs",
      description:
        "Comma-separated provider IDs of custom ACP agents, such as acp-my-agent.",
      default: "",
    },
  });

  const supportedProviderIds = new Set<string>();
  const contributedProviderIds = new Set<string>();

  function contributeNonce(providerId: string) {
    alia.providers.experimental_contributeEnv(providerId, async ({ threadId }) => {
      if (!supportedProviderIds.has(providerId)) return [];
      const nonce = await alia.storage.kv.get<string>(nonceKey(threadId));
      if (typeof nonce !== "string") return [];
      return [
        {
          name: RELOAD_NONCE_ENV,
          value: nonce,
          reason: "Rebuild the agent session after an Agent Reload request",
        },
      ];
    });
  }

  // A contribution cannot be unregistered or registered twice for one id, so
  // removed ids stay registered and their resolvers return nothing.
  function applyProviderIds(extraProviderIds: string) {
    supportedProviderIds.clear();
    for (const id of [
      ...BUILT_IN_PROVIDER_IDS,
      ...parseProviderIds(extraProviderIds),
    ]) {
      supportedProviderIds.add(id);
      if (contributedProviderIds.has(id)) continue;
      contributeNonce(id);
      contributedProviderIds.add(id);
    }
  }

  applyProviderIds((await settings.get()).extraProviderIds);
  settings.onChange((next) => applyProviderIds(next.extraProviderIds));

  async function findRefusal(
    threadId: string,
    signal?: AbortSignal,
  ): Promise<Refusal | null> {
    let thread;
    try {
      thread = await alia.sdk.threads.get({ threadId, signal });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      return {
        reason: "thread_not_found",
        message: `thread ${threadId} does not exist`,
      };
    }
    if (thread.deletedAt !== null) {
      return {
        reason: "thread_deleted",
        message: `thread ${threadId} is deleted`,
      };
    }
    if (!supportedProviderIds.has(thread.providerId)) {
      return {
        reason: "unsupported_provider",
        message: `thread ${threadId} uses provider ${thread.providerId}, which cannot be reloaded; supported: ${[...supportedProviderIds].join(", ")}`,
      };
    }
    return null;
  }

  async function markForReload(
    threadId: string,
    signal?: AbortSignal,
  ): Promise<Refusal | null> {
    const refusal = await findRefusal(threadId, signal);
    if (refusal) return refusal;
    await alia.storage.kv.set(nonceKey(threadId), new Date().toISOString());
    return null;
  }

  alia.rpc.register(rpcContract, {
    reload_supported: async ({ threadId }) => ({
      supported: (await findRefusal(threadId)) === null,
    }),
    reload: async ({ threadId }) => {
      const refusal = await markForReload(threadId);
      return refusal ? { ok: false as const, ...refusal } : { ok: true as const };
    },
  });

  alia.cli.register(
    defineCli({
      name: "agent-reload",
      summary:
        "Restart a thread's agent session before its next turn, keeping the conversation",
      description:
        "Marks the thread so its agent process is rebuilt before the next turn, rereading MCP servers, settings, instruction files, skills, and plugins. The thread id defaults to the calling thread.",
      commands: {},
      root: cliCommand({
        summary: "Mark a thread's agent session for restart",
        positionals: [
          {
            name: "thread-id",
            description: "Thread to reload; defaults to the calling thread",
          },
        ],
        async run(input, ctx) {
          const threadId = input.positionals["thread-id"] ?? ctx.threadId;
          if (!threadId) {
            throw new PluginCliError("no thread to reload", {
              code: "thread_required",
              hint: "Pass a thread id: `alia agent-reload <thread-id>`.",
            });
          }
          const refusal = await markForReload(threadId, ctx.signal);
          if (refusal) {
            throw new PluginCliError(refusal.message, { code: refusal.reason });
          }
          return {
            exitCode: 0,
            stdout: `Agent session for ${threadId} will restart before its next turn.\n`,
          };
        },
      }),
    }),
  );

  alia.events.on("thread.deleted", async ({ thread }) => {
    await alia.storage.kv.delete(nonceKey(thread.id));
  });
}
