import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  gitStats: {
    input: z.object({ environmentIds: z.array(z.string()).max(80) }).strict(),
    output: z.object({ stats: z.record(z.string(), z.string().nullable()) }),
  },
  threadModels: {
    input: z.object({ threadIds: z.array(z.string()).max(120) }).strict(),
    output: z.object({
      models: z.record(
        z.string(),
        z
          .object({
            providerId: z.string(),
            model: z.string().nullable(),
          })
          .strict(),
      ),
    }),
  },
  threadDisplayStatuses: {
    input: z.object({ threadIds: z.array(z.string()).max(120) }).strict(),
    output: z.object({
      statuses: z.record(z.string(), z.string().nullable()),
    }),
  },
});

export default function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded tinted sidebar");

  alia.rpc.register(rpcContract, {
    async gitStats({ environmentIds }) {
      const uniqueIds = [...new Set(environmentIds)];
      const entries = await Promise.all(
        uniqueIds.map(async (environmentId) => {
          try {
            const result = await alia.sdk.environments.diffFiles({
              environmentId,
              target: "uncommitted",
            });
            if (result.outcome !== "available") return [environmentId, null];
            return [environmentId, shortGitStat(result.shortstat)];
          } catch (error) {
            alia.log.debug(
              `could not read git status for ${environmentId}: ${String(error)}`,
            );
            return [environmentId, null];
          }
        }),
      );
      return { stats: Object.fromEntries(entries) };
    },
    async threadModels({ threadIds }) {
      const uniqueIds = [...new Set(threadIds)];
      const entries = await Promise.all(
        uniqueIds.map(async (threadId) => {
          try {
            const thread = await alia.sdk.threads.get({ threadId });
            const options = await alia.sdk.threads.defaultExecutionOptions({
              threadId,
            });
            return [
              threadId,
              {
                providerId: thread.providerId,
                model: options?.model ?? null,
              },
            ];
          } catch (error) {
            alia.log.debug(
              `could not read model for ${threadId}: ${String(error)}`,
            );
            return [
              threadId,
              {
                providerId: "unknown",
                model: null,
              },
            ];
          }
        }),
      );
      return { models: Object.fromEntries(entries) };
    },
    async threadDisplayStatuses({ threadIds }) {
      const uniqueIds = [...new Set(threadIds)];
      const entries = await Promise.all(
        uniqueIds.map(async (threadId) => {
          try {
            const thread = await alia.sdk.threads.get({ threadId });
            return [threadId, thread.runtime?.displayStatus ?? null];
          } catch (error) {
            alia.log.debug(
              `could not read status for ${threadId}: ${String(error)}`,
            );
            return [threadId, null];
          }
        }),
      );
      return { statuses: Object.fromEntries(entries) };
    },
  });
}

function shortGitStat(shortstat: string): string | null {
  const changed = numberBefore(shortstat, "file");
  const insertions = numberBefore(shortstat, "insertion");
  const deletions = numberBefore(shortstat, "deletion");
  if (changed === null && insertions === null && deletions === null) return null;

  const prefix = changed !== null ? `${changed}f ` : "";
  return `${prefix}+${insertions ?? 0} -${deletions ?? 0}`;
}

function numberBefore(source: string, word: string): number | null {
  const match = source.match(new RegExp(`(\\d+)\\s+${word}`));
  return match ? Number(match[1]) : null;
}
