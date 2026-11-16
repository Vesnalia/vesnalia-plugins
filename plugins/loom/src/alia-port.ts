// Adapts alia.sdk to Loom's AliaPort. alia.sdk is read inside each call, never at load.
import type { AliaPluginApi, JsonValue } from "@vesnalia/plugin-sdk";
import { callTimeoutMs } from "./host-budget";
import { hostContract, type HostInput, type HostMethod, type HostOutput } from "./host-contract";
import { SectionNameConflictError, SpawnRefusedError, SpawnUnavailableError, type AliaPort, type HostPort } from "./ports";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isNotFound = (error: unknown) => /\b404\b|not[ _]found/iu.test(message(error));
const isNameConflict = (error: unknown) => /\b409\b|section_name_conflict/iu.test(message(error));
/**
 * VesnALIA's SDK throws AliaHttpError, whose `status` is the HTTP status, `code` VesnALIA's error code and `body` the parsed error. A
 * provider whose availability check answers "unavailable" makes VesnALIA refuse with 409 environment_provider_rejected and
 * details.availabilityStatus; a machine provider that cannot start a machine now, such as a full pool, makes it refuse
 * with 409 machine_provider_rejected. Those, and any error VesnALIA marks retryable, are a wait rather than a failure.
 */
export function spawnErrorOf(error: unknown): unknown {
  const http = (error ?? {}) as { status?: unknown; code?: unknown; body?: unknown };
  const body = (http.body ?? {}) as { retryable?: unknown; details?: { availabilityStatus?: unknown } | null };
  const status = http.status;
  const unavailable = status === 409 && ((http.code === "environment_provider_rejected" && body.details?.availabilityStatus === "unavailable") || http.code === "machine_provider_rejected");
  if (body.retryable === true || unavailable) return new SpawnUnavailableError(message(error));
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429 ? new SpawnRefusedError(status, message(error)) : error;
}

export function createAliaPort(alia: AliaPluginApi): AliaPort {
  return {
    async threadHostId(threadId) {
      const thread = await alia.sdk.threads.get({ threadId });
      if (thread.environmentId !== null) return (await alia.sdk.environments.get({ environmentId: thread.environmentId })).hostId;
      return (await alia.sdk.system.config()).primaryHostId ?? null;
    },
    async ensureSection(sectionId, name) {
      const sections = await alia.sdk.threadSections.list();
      if (sectionId !== null && sections.some((section) => section.id === sectionId)) return sectionId;
      try {
        return (await alia.sdk.threadSections.create({ name })).id;
      } catch (error) {
        if (isNameConflict(error)) throw new SectionNameConflictError(name);
        throw error;
      }
    },
    async renameSection(sectionId, name) {
      await alia.sdk.threadSections.update({ id: sectionId, name });
    },
    async deleteSection(sectionId) {
      try {
        await alia.sdk.threadSections.delete({ id: sectionId });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
    async moveThread(threadId, sectionId) {
      await alia.sdk.threads.update({ threadId, sectionId });
    },
    async setMetadata(threadId, set) {
      await alia.sdk.threads.updatePluginMetadata({ threadId, set });
    },
    log(level, text) {
      alia.log[level](text);
    },
    async projectCheckout(aliaProjectId, hostId) {
      const project = await alia.sdk.projects.get({ projectId: aliaProjectId });
      const sources = project.sources.filter((source) => source.hostId === hostId);
      return (sources.find((source) => source.isDefault) ?? sources[0])?.path ?? null;
    },
    async spawnThread(args) {
      const thread = await alia.sdk.threads.spawn({
        projectId: args.aliaProjectId,
        environment:
          args.workspace !== undefined
            ? { type: "host", hostId: args.hostId, workspace: { type: "unmanaged", path: args.workspace.path } }
            : args.environment === undefined
            ? { type: "host", hostId: args.hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: args.baseBranch } } }
            : {
                type: "provider",
                environmentProviderId: args.environment.providerId,
                inputs: args.environment.inputs as JsonValue,
                machine: args.environment.machine === undefined ? { type: "existing", hostId: args.hostId } : { type: "new", machineProviderId: args.environment.machine.providerId, inputs: args.environment.machine.inputs as JsonValue },
              },
        ...(args.detail === undefined
          ? { prompt: args.prompt }
          : { input: [{ type: "text" as const, text: args.prompt, mentions: [] }, { type: "text" as const, text: args.detail, mentions: [], visibility: "agent-only" as const }] }),
        title: args.title,
        ...(args.sectionId === null ? {} : { sectionId: args.sectionId }),
        pluginMetadata: { ...args.metadata },
        ...(args.providerId === undefined ? {} : { providerId: args.providerId }),
        ...(args.model === undefined ? {} : { model: args.model }),
        ...(args.reasoningLevel === undefined ? {} : { reasoningLevel: args.reasoningLevel }),
        ...(args.permissionMode === undefined ? {} : { permissionMode: args.permissionMode }),
      }).catch((error: unknown) => {
        throw spawnErrorOf(error);
      });
      return { threadId: thread.id, environmentId: thread.environmentId };
    },
    async send(threadId, message) {
      const input =
        typeof message === "string"
          ? [{ type: "text" as const, text: message, mentions: [] }]
          : [
              { type: "text" as const, text: message.summary, mentions: [] },
              { type: "text" as const, text: message.detail, mentions: [], visibility: "agent-only" as const },
            ];
      await alia.sdk.threads.send({ threadId, mode: "auto", input });
    },
    async stop(threadId) {
      await alia.sdk.threads.stop({ threadId });
    },
    async archive(threadId) {
      await alia.sdk.threads.archive({ threadId });
    },
    async unarchive(threadId) {
      await alia.sdk.threads.unarchive({ threadId });
    },
    async restoreEnvironment(threadId) {
      await alia.sdk.threads.restoreEnvironment({ threadId }).catch((error: unknown) => {
        throw spawnErrorOf(error);
      });
    },
    async getThread(threadId) {
      try {
        const thread = await alia.sdk.threads.get({ threadId });
        return {
          id: thread.id,
          status: thread.status,
          archivedAt: thread.archivedAt,
          deletedAt: thread.deletedAt,
          environmentId: thread.environmentId,
          canRestoreEnvironment: thread.canRestoreEnvironment === true,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async getEnvironment(environmentId) {
      try {
        const environment = await alia.sdk.environments.get({ environmentId });
        return { path: environment.path, branchName: environment.branchName, hostId: environment.hostId, status: environment.status };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async hostKnown(hostId) {
      try {
        await alia.sdk.hosts.get({ hostId });
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
    async findSpawnedThread(spawnToken) {
      const threads = await alia.sdk.threads.list({ originPluginId: alia.pluginId, includeHidden: true, limit: 200 });
      for (const thread of threads) {
        const metadata = (await alia.sdk.threads.getPluginMetadata({ threadId: thread.id }).catch(() => ({}))) as Record<string, unknown>;
        if (metadata.spawnToken === spawnToken) return thread.id;
      }
      return null;
    },
    async threadTokens(threadId) {
      const rows = await alia.sdk.threads.events.list({ threadId, types: ["thread/tokenUsage/updated"], order: "desc", limit: "1" });
      const total = (rows[0] as { data?: { tokenUsage?: { total?: { totalTokens?: number } } } } | undefined)?.data?.tokenUsage?.total?.totalTokens;
      return typeof total === "number" && Number.isFinite(total) ? total : null;
    },
    async latestSystemError(threadId) {
      const rows = await alia.sdk.threads.events.list({ threadId, types: ["system/error"], order: "desc", limit: "1" });
      const row = rows[0] as { seq: number; createdAt: number; data?: { code?: string; message?: string; detail?: string } } | undefined;
      const data = row?.data;
      return data === undefined ? null : { code: data.code ?? null, message: data.message ?? "", detail: data.detail ?? null, seq: row!.seq, at: row!.createdAt };
    },
    async retryTurn(threadId, turnRequestId, sendAt) {
      await alia.sdk.threads.retry({ threadId, turnRequestId, sendAt, reason: "Rate limited (Loom retry)" });
    },
    async projectKind(aliaProjectId) {
      try {
        return (await alia.sdk.projects.get({ projectId: aliaProjectId })).kind;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async listProjects() {
      const projects = await alia.sdk.projects.list({ includePersonal: true });
      return projects.map((project) => ({
        id: project.id,
        name: project.name,
        kind: project.kind,
        gitRemoteUrl: project.gitRemoteUrl,
        sources: project.sources.map((source) => ({ hostId: source.hostId, path: source.path, isDefault: source.isDefault })),
      }));
    },
    async spawnPlanner({ request, title, kickoff }) {
      const thread = await alia.sdk.threads.spawn({ ...request, title, input: [...request.input, { type: "text", text: kickoff, mentions: [], visibility: "agent-only" }] });
      return thread.id;
    },
    async providerIds() {
      return (await alia.sdk.providers.list()).map((provider) => provider.id);
    },
    async environmentCompositions(aliaProjectId) {
      const providers = await alia.sdk.environments.listProviders({ projectId: aliaProjectId });
      return providers.flatMap((provider) =>
        provider.machineProviderId == null
          ? []
          : [{
              id: provider.id,
              displayName: provider.displayName,
              description: provider.description,
              pluginId: provider.pluginId,
              acceptsEmptyInputs: provider.acceptsEmptyInputs,
              inputs: provider.inputs,
              available: provider.availability === null || provider.availability.status === "available",
              unavailableReason: provider.availability === null || provider.availability.status === "available" ? null : provider.availability.message,
              machineProviderId: provider.machineProviderId,
            }],
      );
    },
    async environmentProviders(aliaProjectId, hostId) {
      return (await alia.sdk.environments.listProviders({ projectId: aliaProjectId, hostId })).map((provider) => {
        // The machine's own answer wins; null from VesnALIA means nothing stands in the way.
        const availability = provider.machineAvailability[hostId] ?? provider.availability;
        return {
          id: provider.id,
          displayName: provider.displayName,
          description: provider.description,
          pluginId: provider.pluginId,
          acceptsEmptyInputs: provider.acceptsEmptyInputs,
          inputs: provider.inputs,
          available: availability === null || availability.status === "available",
          unavailableReason: availability === null || availability.status === "available" ? null : availability.message,
          ...(provider.machineProviderId == null ? {} : { machineProviderId: provider.machineProviderId }),
        };
      });
    },
    async machineProviders() {
      return (await alia.sdk.hosts.experimental_listProviders()).map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        description: provider.description,
        pluginId: provider.pluginId,
        acceptsEmptyInputs: provider.acceptsEmptyInputs,
        inputs: provider.inputs,
      }));
    },
    async plugins() {
      return (await alia.sdk.plugins.list()).plugins.map((plugin) => ({ id: plugin.id, enabled: plugin.enabled, builtin: plugin.provenance === "builtin" }));
    },
    async waitingOnUser(threadIds) {
      const waiting = await Promise.all(
        threadIds.map(async (threadId) => {
          try {
            return (await alia.sdk.threads.interactions.list({ threadId })).some((row) => row.status === "pending");
          } catch (error) {
            if (isNotFound(error)) return false;
            throw error;
          }
        }),
      );
      return threadIds.filter((_, index) => waiting[index]);
    },
    async threadOutput(threadId) {
      return (await alia.sdk.threads.output({ threadId })).output;
    },
    async environmentFiles(environmentId, base) {
      try {
        const result = await alia.sdk.environments.diffFiles({ environmentId, target: "all", mergeBaseBranch: base });
        if (result.outcome === "not_applicable") return { outcome: "unavailable", message: result.message };
        if (result.outcome === "unavailable") return { outcome: "unavailable", message: result.failure.message };
        const files = result.files.map((file) => ({
          path: file.path,
          previousPath: file.previousPath,
          status: file.changeKind,
          additions: file.additions,
          deletions: file.deletions,
          binary: file.binary,
          untracked: file.origin === "untracked",
        }));
        return { outcome: "ok", files, truncated: result.truncated };
      } catch (error) {
        return { outcome: "unavailable", message: message(error) };
      }
    },
    async environmentPatch(environmentId, base, path) {
      try {
        const result = await alia.sdk.environments.diffPatch({ environmentId, paths: [path], target: { type: "all", mergeBaseBranch: base } });
        if (result.outcome === "not_applicable") return { outcome: "unavailable", message: result.message };
        if (result.outcome === "unavailable") return { outcome: "unavailable", message: result.failure.message };
        const patch = result.patches.find((entry) => entry.path === path) ?? result.patches[0];
        return { outcome: "ok", patch: patch?.patch ?? "", truncated: patch?.truncated ?? false };
      } catch (error) {
        return { outcome: "unavailable", message: message(error) };
      }
    },
  };
}

/**
 * The host entry client. Local git calls get 30 s; gh, forge commands and ensureWorktree (a first checkout) get 150 s; a call
 * that fetches, runs ls-remote or pushes gets twice its git network timeout plus 30 s (270 s by default), and one with index
 * and tree steps its git index timeout on top (330 s for mergeOnto, 570 s for importCommit and stackBase by default); a command forge's
 * retarget gets its 5 minutes plus 30 s; exec gets its own timeout plus 30 s. All stay under VesnALIA's 30-minute host call cap.
 */
export function createHostPort(alia: AliaPluginApi): HostPort {
  const client = alia.hosts.experimental_client({ contract: hostContract });
  return {
    call: <M extends HostMethod>(hostId: string, method: M, input: HostInput<M>) => {
      const timeoutMs = callTimeoutMs(method, input);
      return client.call(method, input, { hostId, timeoutMs }) as Promise<HostOutput<M>>;
    },
  };
}

export { callTimeoutMs };
