import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { CHANNEL, MODEL_CHANGED, modelSelectionSchema, rpcContract, type ModelSelection, type ModelSettings } from "./contract";
import { PredictionCoordinator, type Source } from "./lib/coordinator";
import { CACHE_MIGRATIONS, SqlitePredictionCache } from "./lib/cache";
import { buildConversation, generationPrompt, parsePrediction, sourceKey, PREDICTION_PROMPT, WORKER_INSTRUCTIONS, type RecordedEvent } from "./lib/prediction";

const WORKER_TITLE = "Composer prediction helper";
type PredictionPermissionMode = "auto" | "accept-edits";
type PredictionSource = Source & { latestSeq: number; execution: { projectId: string; environmentId: string | null; providerId: string; reasoningLevel: string; permissionMode: PredictionPermissionMode; serviceTier?: string } };
const helperSourceSchema = z.object({ sourceThreadId: z.string().min(1), sourceSeq: z.number().int().nonnegative() });
const missingThreadSchema = z.object({ status: z.literal(404), code: z.literal("thread_not_found") });
type Helper = { source: z.infer<typeof helperSourceSchema> | null; archived: boolean; stale: boolean };
const MODEL_KEY = "prediction-model";
const PROMPT_KEY = sourceKey(PREDICTION_PROMPT, WORKER_INSTRUCTIONS);

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    enabled: { type: "boolean", label: "Composer predictions", default: true, description: "Suggest a next message in an empty composer. Tab or a right swipe inserts it without sending." },
    contextCharacters: { type: "number", label: "Conversation character budget", default: 48000, experimental_schema: z.number().int().min(4000).max(120000) },
  });
  let config = await settings.get();
  const database = alia.storage.database();
  alia.storage.migrate(database, CACHE_MIGRATIONS);
  const cache = new SqlitePredictionCache(database);
  const storedModel = modelSelectionSchema.safeParse(await alia.storage.kv.get(MODEL_KEY));
  let modelSelection: ModelSelection | null = storedModel.success ? storedModel.data : null;
  let modelWrite = Promise.resolve();
  const interested = new Set<string>();
  const workers = new Map<string, Helper>();
  const rejectedWorkers = new Set<string>();
  // Helpers whose provider cannot approve automatically. An approval they raise
  // is shown to the user instead of failing the prediction.
  const promptedWorkers = new Set<string>();
  const approvalRequested = new Set<string>();
  const revealedWorkers = new Set<string>();
  const presentingApproval = new Map<string, Promise<void>>();
  const wakeups = new Map<string, () => void>();
  type Catalog = Awaited<ReturnType<typeof alia.sdk.providers.models>>;
  // `auto` stays unattended. Otherwise ask in the workspace mode. `full` never
  // asks, so it is not a stand-in for a provider that cannot approve automatically.
  function predictionPermissionMode(modes: readonly string[] | undefined): PredictionPermissionMode {
    if (modes?.includes("auto")) return "auto";
    if (modes?.includes("accept-edits")) return "accept-edits";
    throw new Error("This prediction provider cannot approve automatically or ask you for approval.");
  }
  function usablePredictionProvider(provider: Catalog["providers"][number]): boolean {
    return provider.available && provider.capabilities.permissionModes.some(mode => mode === "auto" || mode === "accept-edits");
  }
  function resolveModel(catalog: Catalog, preferred: ModelSelection): ModelSelection {
    const provider = catalog.providers.find(row => row.id === preferred.providerId);
    if (!provider) throw new Error(`Prediction model ${preferred.model} is unavailable for ${preferred.providerId} on this machine.`);
    predictionPermissionMode(provider.capabilities.permissionModes);
    const model = catalog.models.find(row => row.model === preferred.model || row.id === preferred.model);
    if (!model) throw new Error(`Prediction model ${preferred.model} is unavailable for ${preferred.providerId} on this machine.`);
    const efforts = model.supportedReasoningEfforts.map(row => row.reasoningEffort);
    const reasoningLevel = efforts.length === 0 || efforts.includes(preferred.reasoningLevel) ? preferred.reasoningLevel : model.defaultReasoningEffort;
    if (preferred.serviceTier && preferred.serviceTier !== "default" && !model.supportedServiceTiers?.some(tier => tier.id === preferred.serviceTier)) throw new Error(`This prediction model does not support the ${preferred.serviceTier} service tier.`);
    return modelSelectionSchema.parse({ providerId: preferred.providerId, model: model.model, reasoningLevel,
      ...(preferred.serviceTier && model.supportedServiceTiers?.length ? { serviceTier: preferred.serviceTier } : {}) });
  }
  async function readModelSettings(): Promise<ModelSettings> {
    if (modelSelection) return { selection: modelSelection, pickerDefault: modelSelection, catalogError: null };
    let pickerDefault: ModelSelection | null = null;
    const errors: string[] = [];
    const report = (message: string) => { errors.push(message); alia.log.warn(`Prediction model catalog: ${message}`); };
    try {
      const providers = await alia.sdk.providers.list();
      for (const provider of providers) {
        if (!usablePredictionProvider(provider)) continue;
        try {
          // An unscoped execution-options lookup loads only the first provider's
          // models. Ask each usable provider explicitly so it cannot block the rest.
          const catalog = await alia.sdk.providers.models({ providerId: provider.id });
          if (catalog.modelLoadError) {
            const failure = catalog.modelLoadError;
            report(`${provider.id}: ${failure.code}${failure.detail ? `: ${failure.detail}` : ""}`);
            continue;
          }
          const models = [...catalog.models].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
          for (const model of models) {
            const providerId = model.routeProviderId ?? provider.id;
            if (!catalog.providers.some(row => row.id === providerId && usablePredictionProvider(row))) continue;
            const seed = modelSelectionSchema.safeParse({ providerId, model: model.model, reasoningLevel: model.defaultReasoningEffort });
            if (seed.success) { pickerDefault = seed.data; break; }
          }
          if (pickerDefault) break;
          report(`${provider.id}: No usable prediction models were returned.`);
        } catch (error) { report(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    } catch (error) { report(`Could not list prediction providers: ${error instanceof Error ? error.message : String(error)}`); }
    if (!pickerDefault && errors.length === 0) report("No available prediction provider supports automatic approval or approval prompts on this machine.");
    return { selection: null, pickerDefault, catalogError: errors.join("\n") || null };
  }
  function changeModel(next: ModelSelection | null): Promise<ModelSettings> {
    const result = modelWrite.then(async () => {
      const saved = next ? resolveModel(await alia.sdk.providers.models({ providerId: next.providerId }), next) : null;
      if (saved) await alia.storage.kv.set(MODEL_KEY, saved);
      else await alia.storage.kv.delete(MODEL_KEY);
      modelSelection = saved;
      clearPredictions();
      alia.realtime.publish(MODEL_CHANGED, {});
      return readModelSettings();
    });
    modelWrite = result.then(() => {}, () => {});
    return result;
  }
  function clearPredictions() {
    try { cache.clear(); }
    catch (error) { alia.log.warn(`Prediction cache unavailable: ${String(error)}`); }
    for (const threadId of interested) coordinator.clear(threadId);
    for (const [threadId, helper] of workers) { helper.stale = true; releaseInBackground(threadId); }
  }
  function staleHelpers(sourceThreadId: string, currentSeq?: number) {
    for (const [threadId, helper] of workers) {
      if (helper.source?.sourceThreadId !== sourceThreadId || helper.source.sourceSeq === currentSeq) continue;
      helper.stale = true;
      releaseInBackground(threadId);
    }
  }
  function clearPrediction(threadId: string) {
    if (interested.has(threadId)) coordinator.clear(threadId);
    staleHelpers(threadId);
  }

  async function predictionEnvironmentId(threadId: string, projectId: string, environmentId: string | null, signal: AbortSignal): Promise<string | null> {
    if (environmentId) return environmentId;
    const project = await alia.sdk.projects.get({ projectId, signal });
    if (project.kind !== "personal") return null;
    type Environment = Awaited<ReturnType<typeof alia.sdk.environments.get>>;
    const usable = (environment: Environment) => environment.projectId === projectId && environment.environmentProviderId !== null
      && environment.status === "ready" && environment.lifecycle.phase === "active" && environment.hostLifecycle === "active";
    // Provisioning events identify the source's workspace even when a custom
    // provider uses an opaque instance key, or a restore created a new attempt.
    const provisioned = z.object({ environmentId: z.string().min(1) });
    let beforeSeq: string | undefined;
    for (;;) {
      signal.throwIfAborted();
      const rows = await alia.sdk.threads.events.list({ threadId, order: "desc", limit: "100", types: ["system/thread-provisioning"], ...(beforeSeq ? { beforeSeq } : {}), signal });
      for (const row of rows) {
        const parsed = row.type === "system/thread-provisioning" ? provisioned.safeParse(row.data) : null;
        if (!parsed?.success) continue;
        const environment = await alia.sdk.environments.get({ environmentId: parsed.data.environmentId, signal });
        if (!usable(environment)) throw new Error("The source thread's personal workspace is not ready for predictions.");
        return environment.id;
      }
      if (rows.length < 100) break;
      beforeSeq = String(rows[rows.length - 1].seq);
    }
    // Older histories may lack provisioning events. VesnALIA's initial per-thread
    // workspace instance key is the thread id; never reuse another chat's workspace.
    const candidates: string[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      signal.throwIfAborted();
      const environments = await alia.sdk.environments.list({ projectId, instanceKey: threadId, limit, offset, signal });
      for (const environment of environments) {
        if (environment.environmentProviderInstanceKey === threadId && usable(environment)) candidates.push(environment.id);
      }
      if (candidates.length > 1) throw new Error("Multiple personal workspaces match the source thread. Attach the thread to its workspace before requesting predictions.");
      if (environments.length < limit) break;
    }
    if (!candidates.length) throw new Error("No ready personal workspace could be identified for the source thread. Attach the thread to its workspace before requesting predictions.");
    return candidates[0];
  }

  async function source(threadId: string, signal: AbortSignal): Promise<PredictionSource | null> {
    if (!config.enabled) return null;
    const override = modelSelection;
    const thread = await alia.sdk.threads.get({ threadId, signal });
    if (thread.status !== "idle" || thread.visibility === "hidden" || thread.archivedAt || thread.deletedAt || thread.queuedMessageCount > 0 || thread.activeBackgroundAgentCount > 0) return null;
    const options = override ? null : await alia.sdk.threads.defaultExecutionOptions({ threadId, signal });
    if (!override && !options?.model) return null;
    const environmentId = await predictionEnvironmentId(threadId, thread.projectId, thread.environmentId, signal);
    const providerId = override?.providerId ?? thread.providerId;
    const wantedModel = override?.model ?? options!.model;
    const catalog = await alia.sdk.providers.models(environmentId
      ? { providerId, environmentId, signal }
      : { providerId, projectId: thread.projectId, signal });
    const model = catalog.models.find(row => row.model === wantedModel || row.id === wantedModel);
    const efforts = model?.supportedReasoningEfforts.map(row => row.reasoningEffort) ?? [];
    const automaticEffort = ["low", "none", "medium"].find(effort => efforts.includes(effort)) ?? model?.defaultReasoningEffort ?? "low";
    const executionModel = resolveModel(catalog, override ?? modelSelectionSchema.parse({ providerId, model: wantedModel, reasoningLevel: automaticEffort }));
    const permissionMode = predictionPermissionMode(catalog.providers.find(row => row.id === executionModel.providerId)?.capabilities.permissionModes);
    const events: RecordedEvent[] = [];
    let beforeSeq: string | undefined;
    for (let page = 0; page < 4; page++) {
      const rows = await alia.sdk.threads.events.list({ threadId, order: "desc", limit: "100", types: ["client/turn/requested", "item/completed"], ...(beforeSeq ? { beforeSeq } : {}), signal });
      events.push(...rows);
      if (rows.length < 100) break;
      beforeSeq = String(rows[rows.length - 1].seq);
    }
    const conversation = buildConversation(events, config.contextCharacters);
    if (!conversation) return null;
    const latestSeq = Math.max(...events.map(event => event.seq));
    staleHelpers(threadId, latestSeq);
    const identity = { version: 1, prompt: PROMPT_KEY, execution: executionModel, contextCharacters: config.contextCharacters,
      projectId: thread.projectId, environmentId, latestSeq };
    return { key: sourceKey(JSON.stringify(identity), conversation), model: executionModel.model, conversation, latestSeq,
      execution: { projectId: thread.projectId, environmentId, providerId: executionModel.providerId, reasoningLevel: executionModel.reasoningLevel, permissionMode, ...(executionModel.serviceTier ? { serviceTier: executionModel.serviceTier } : {}) } };
  }
  const workerReleases = new Map<string, Promise<void>>();
  // Stop before archive. VesnALIA forwards an archive to the provider only once the
  // helper is idle; archiving a running helper leaves that provider chat open.
  // Keep the VesnALIA thread until archive succeeds; stale helpers can then be deleted.
  function releaseWorker(threadId: string): Promise<void> {
    const current = workerReleases.get(threadId);
    if (current) return current;
    const helper = workers.get(threadId);
    if (!helper || (helper.archived && !helper.stale)) return Promise.resolve();
    const release = (async () => {
      try {
        if (!helper.archived) {
          try { await alia.sdk.threads.stop({ threadId }); }
          catch (error) { alia.log.warn(`Prediction helper stop: ${String(error)}`); }
          if (revealedWorkers.has(threadId)) {
            try { await alia.sdk.threads.update({ threadId, visibility: "hidden" }); }
            catch (error) { alia.log.warn(`Prediction helper hide: ${String(error)}`); }
          }
          try {
            await alia.sdk.threads.archive({ threadId });
            helper.archived = true;
          } catch (error) { alia.log.warn(`Prediction helper archive: ${String(error)}`); }
        }
        if (helper.stale) {
          // Preserve explicit invalidation across reload even when the source
          // sequence is unchanged, such as after a regeneration.
          await alia.sdk.threads.updatePluginMetadata({ threadId, pluginId: alia.pluginId, set: { predictionStale: true } });
          if (!helper.archived) return;
          const current = await alia.sdk.threads.get({ threadId });
          if (current.deletedAt) { workers.delete(threadId); return; }
          if (current.status !== "idle" && current.status !== "error") return;
          await alia.sdk.threads.delete({ threadId, childThreadsConfirmed: false });
          workers.delete(threadId);
        }
      } catch (error) {
        if (missingThreadSchema.safeParse(error).success) workers.delete(threadId);
        else alia.log.warn(`Prediction helper cleanup: ${String(error)}`);
      }
      finally {
        workerReleases.delete(threadId);
        rejectedWorkers.delete(threadId); promptedWorkers.delete(threadId); approvalRequested.delete(threadId);
        revealedWorkers.delete(threadId); presentingApproval.delete(threadId); wakeups.delete(threadId);
      }
    })();
    workerReleases.set(threadId, release);
    return release;
  }
  // Provider archive can take a while. The suggestion does not wait for it.
  function releaseInBackground(threadId: string): void {
    void releaseWorker(threadId);
  }
  // Hidden threads are not in the sidebar, so the approval card would never
  // appear. Show the helper and open it beside the conversation.
  function presentApproval(threadId: string): Promise<void> {
    const current = presentingApproval.get(threadId);
    if (current) return current;
    const task = (async () => {
      await alia.sdk.threads.update({ threadId, visibility: "visible" });
      revealedWorkers.add(threadId);
      await alia.sdk.threads.open({ threadId, file: null, split: "right" });
    })();
    presentingApproval.set(threadId, task);
    void task.then(() => {}, () => { if (presentingApproval.get(threadId) === task) presentingApproval.delete(threadId); });
    return task;
  }
  async function waitForWorker(threadId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    await new Promise<void>(resolve => {
      const wake = () => { clearTimeout(timer); wakeups.delete(threadId); signal.removeEventListener("abort", wake); resolve(); };
      const timer = setTimeout(wake, 2000);
      wakeups.set(threadId, wake);
      signal.addEventListener("abort", wake, { once: true });
    });
  }
  const coordinator = new PredictionCoordinator<PredictionSource>({
    cache,
    source,
    async generate(threadId, snapshot, parentSignal) {
      const execution = snapshot.execution;
      const asksForApproval = execution.permissionMode !== "auto";
      let signal = parentSignal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timeout = new AbortController();
      let holdingForApproval = false;
      // The 60s bound covers the model request. It does not cover a person
      // answering an approval; that wait ends when they answer or the conversation moves on.
      const armTimeout = () => {
        clearTimeout(timer);
        if (timeout.signal.aborted) timeout = new AbortController();
        timer = setTimeout(() => timeout.abort(), 60_000);
        signal = AbortSignal.any([parentSignal, timeout.signal]);
      };
      const holdForApproval = () => {
        clearTimeout(timer);
        timer = undefined;
        signal = parentSignal;
        holdingForApproval = true;
      };
      armTimeout();
      try {
        signal.throwIfAborted();
        const worker = await alia.sdk.threads.spawn({
          projectId: execution.projectId,
          environment: execution.environmentId ? { type: "reuse", environmentId: execution.environmentId } : { type: "project-default" },
          providerId: execution.providerId, model: snapshot.model, reasoningLevel: execution.reasoningLevel,
          ...(execution.serviceTier ? { serviceTier: execution.serviceTier } : {}),
          permissionMode: execution.permissionMode, visibility: "hidden", title: WORKER_TITLE,
          pluginMetadata: { predictionWorker: true, sourceThreadId: threadId, sourceSeq: snapshot.latestSeq }, prompt: generationPrompt(snapshot.conversation),
        });
        workers.set(worker.id, { source: { sourceThreadId: threadId, sourceSeq: snapshot.latestSeq }, archived: false, stale: parentSignal.aborted });
        if (asksForApproval) promptedWorkers.add(worker.id);
        try {
          // An interaction can be committed before spawn() resolves, before the
          // event listener can recognise this id as one of our workers.
          const pendingAtStart = await alia.sdk.threads.interactions.list({ threadId: worker.id, signal });
          if (pendingAtStart.length > 0) {
            if (!asksForApproval) throw new Error("Prediction helper requested an interaction");
            approvalRequested.add(worker.id);
          }
          for (;;) {
            parentSignal.throwIfAborted();
            if (asksForApproval && approvalRequested.has(worker.id) && !holdingForApproval) holdForApproval();
            const pending = asksForApproval && (await alia.sdk.threads.interactions.list({ threadId: worker.id, signal })).length > 0;
            if (pending) {
              approvalRequested.add(worker.id);
              if (!holdingForApproval) holdForApproval();
              try { await presentApproval(worker.id); }
              catch (error) { alia.log.warn(`Prediction helper approval: ${String(error)}`); }
            } else {
              if (asksForApproval) approvalRequested.delete(worker.id);
              if (holdingForApproval) { holdingForApproval = false; armTimeout(); }
              signal.throwIfAborted();
              if (rejectedWorkers.has(worker.id)) throw new Error("Prediction helper requested an interaction");
              const current = await alia.sdk.threads.get({ threadId: worker.id, signal });
              if (current.status === "error" || current.archivedAt || current.deletedAt) throw new Error("Prediction helper failed");
              if (current.status === "idle") {
                const { output } = await alia.sdk.threads.output({ threadId: worker.id, signal });
                if (output?.trim()) return parsePrediction(output);
              }
            }
            await waitForWorker(worker.id, signal);
          }
        } finally { releaseInBackground(worker.id); }
      } finally { clearTimeout(timer); }
    },
    changed: threadId => alia.realtime.publish(CHANNEL, { threadId }),
    log: error => alia.log.warn(`Prediction unavailable: ${String(error)}`),
  });
  settings.onChange(next => {
    config = next;
    clearPredictions();
  });
  alia.agents.configure(({ thread, pluginMetadata }) =>
    thread.title === WORKER_TITLE && pluginMetadata.predictionWorker === true
      ? { tools: [], skills: [], instructions: WORKER_INSTRUCTIONS }
      : { tools: [], skills: ["composer-predictions"] });

  function watch(threadId: string) {
    interested.add(threadId);
    if (interested.size > 1000) {
      const oldest = interested.values().next().value;
      if (oldest) { clearPrediction(oldest); interested.delete(oldest); }
    }
  }
  alia.events.on("thread.idle", ({ thread }) => {
    wakeups.get(thread.id)?.();
    if (workers.get(thread.id)?.stale) releaseInBackground(thread.id);
    if (interested.has(thread.id)) coordinator.request(thread.id);
  });
  alia.events.on("thread.failed", ({ thread }) => { wakeups.get(thread.id)?.(); clearPrediction(thread.id); if (workers.get(thread.id)?.stale) releaseInBackground(thread.id); });
  for (const name of ["thread.active", "thread.archived", "thread.deleted"] as const) {
    alia.events.on(name, ({ thread }) => {
      clearPrediction(thread.id);
      if (name === "thread.deleted") workers.delete(thread.id);
      if (name !== "thread.active") interested.delete(thread.id);
    });
  }
  for (const name of ["message.queued", "message.dispatched"] as const) {
    alia.events.on(name, ({ entry }) => clearPrediction(entry.threadId));
  }
  alia.events.on("interaction.pending", async ({ thread }) => {
    if (promptedWorkers.has(thread.id)) {
      approvalRequested.add(thread.id); wakeups.get(thread.id)?.();
      try { await presentApproval(thread.id); }
      catch (error) { alia.log.warn(`Prediction helper approval: ${String(error)}`); }
      return;
    }
    if (workers.has(thread.id)) {
      rejectedWorkers.add(thread.id); wakeups.get(thread.id)?.();
      // The generation's own cleanup stops the helper again, so a failure here only needs logging.
      try { await alia.sdk.threads.stop({ threadId: thread.id }); }
      catch (error) { alia.log.warn(`Prediction helper stop: ${String(error)}`); }
    } else clearPrediction(thread.id);
  });
  alia.rpc.register(rpcContract, {
    model_get: () => readModelSettings(),
    model_set: selection => changeModel(selection),
    model_clear: () => changeModel(null),
    get: ({ threadId }) => coordinator.get(threadId),
    ensure: ({ threadId }) => { watch(threadId); return coordinator.request(threadId); },
    regenerate: ({ threadId }) => { watch(threadId); clearPrediction(threadId); return coordinator.request(threadId, true); },
    dismiss: ({ threadId, generationId }) => coordinator.dismiss(threadId, generationId),
  });
  alia.cli.register({
    name: "composer-predictions", summary: "Inspect or regenerate composer suggestions",
    commands: ["show", "regenerate", "dismiss"].map(name => ({ name, summary: `${name} a prediction`, usage: `alia composer-predictions ${name} <thread-id> [--json]` })),
    async run(argv) {
      const [command, threadId] = argv.filter(value => value !== "--json");
      if (!threadId || !["show", "regenerate", "dismiss"].includes(command)) return { exitCode: 0, stdout: "alia composer-predictions show|regenerate|dismiss <thread-id> [--json]" };
      if (command === "regenerate") { watch(threadId); clearPrediction(threadId); coordinator.request(threadId, true); }
      if (command === "dismiss") coordinator.dismiss(threadId, coordinator.get(threadId).generationId);
      const state = coordinator.get(threadId);
      return { exitCode: 0, stdout: argv.includes("--json") ? JSON.stringify(state) : state.suggestion ?? state.status };
    },
  });
  alia.onDispose(async () => {
    await coordinator.dispose();
    await Promise.allSettled([...workers.keys()].map(threadId => releaseWorker(threadId)));
  });
  // Backlogs can exceed VesnALIA's factory timeout. Recover after load, with reads
  // cancelled on disposal, and keep current conversations and helpers alone.
  alia.background.service("helper-cleanup", { start: recoverHelpers });
  async function recoverHelpers(signal: AbortSignal) {
    const discovered = new Map<string, Awaited<ReturnType<typeof alia.sdk.threads.list>>[number]>();
    async function checkSource(threadId: string) {
      try {
        const thread = await alia.sdk.threads.get({ threadId, signal });
        const moved = thread.status !== "idle" || !!thread.archivedAt || !!thread.deletedAt || thread.queuedMessageCount > 0;
        if (moved) return { moved, latestSeq: 0 };
        const events = await alia.sdk.threads.events.list({ threadId, order: "desc", limit: "1", types: ["client/turn/requested", "item/completed"], signal });
        return { moved: false, latestSeq: Math.max(0, ...events.map(event => event.seq)) };
      } catch (error) {
        if (missingThreadSchema.safeParse(error).success) return { moved: true, latestSeq: 0 };
        throw error;
      }
    }
    try {
      for (const archived of [false, true]) {
        for (let offset = 0; ; offset += 100) {
          if (signal.aborted) return;
          const rows = await alia.sdk.threads.list({ originPluginId: alia.pluginId, includeHidden: true, archived, limit: 100, offset, signal });
          for (const row of rows) if (!discovered.has(row.id)) discovered.set(row.id, row);
          if (rows.length < 100) break;
        }
      }
    } catch (error) { if (signal.aborted) return; alia.log.warn(`Prediction helper recovery: ${String(error)}`); }
    for (const row of discovered.values()) {
      if (signal.aborted) return;
      if (row.originPluginId !== alia.pluginId || row.title !== WORKER_TITLE || row.deletedAt || workers.has(row.id)) continue;
      try {
        const metadata = await alia.sdk.threads.getPluginMetadata({ threadId: row.id, pluginId: alia.pluginId, signal });
        if (metadata?.predictionWorker !== true) continue;
        const finished = row.status === "idle" || row.status === "error";
        const parsed = helperSourceSchema.safeParse(metadata);
        if (!finished && !parsed.success) continue;
        const helper: Helper = { source: parsed.success ? parsed.data : null, archived: !!row.archivedAt, stale: metadata.predictionStale === true || !parsed.success };
        workers.set(row.id, helper);
        if (helper.source && !helper.stale) {
          try {
            const current = await checkSource(helper.source.sourceThreadId);
            helper.stale ||= current.moved || current.latestSeq !== helper.source.sourceSeq;
          } catch (error) { if (signal.aborted) return; alia.log.warn(`Prediction helper source check ${row.id}: ${String(error)}`); }
        }
        if (!finished && !helper.stale) { workers.delete(row.id); continue; }
        if (row.visibility === "visible") revealedWorkers.add(row.id);
        if (signal.aborted) return;
        await releaseWorker(row.id);
      } catch (error) { if (signal.aborted) return; alia.log.warn(`Prediction helper recovery skipped ${row.id}: ${String(error)}`); }
    }
  }
}
