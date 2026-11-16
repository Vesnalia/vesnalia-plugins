import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { Store } from "./store";
import { completionNotifications } from "./completion-notifications";
import { defaultPreferences, guidePreferencesPrompt, type ReviewPreferences } from "./preferences";

const active = new WeakMap<AliaPluginApi, Set<AbortController>>();
export function hasGuideGenerations(alia: AliaPluginApi) { return (active.get(alia)?.size ?? 0) > 0; }
export function stopGuideGenerations(alia: AliaPluginApi) {
  for (const controller of active.get(alia) ?? []) controller.abort();
}

export function buildGenerationPrompt(targetKey: string, generationId?: string, preferences: ReviewPreferences = defaultPreferences): string {
  return [
    "Author a Guided Review for this change.",
    "Follow the guided-review-generate skill exactly.",
    `The target key is: ${targetKey}`,
    ...(generationId ? [`Pass generationId "${generationId}" to generate_review_guide. It identifies this exact generation run.`] : []),
    "Start by calling read_review_patch, then submit with generate_review_guide.",
    guidePreferencesPrompt(preferences),
  ].join("\n");
}

export async function generateGuide(
  alia: AliaPluginApi,
  store: Store,
  targetKey: string,
  projectId: string,
): Promise<void> {
  let generationId: string | undefined;
  let workerId: string | undefined;
  let threads: AliaPluginApi["sdk"]["threads"] | undefined;
  const controller = new AbortController();
  const runs = active.get(alia) ?? new Set<AbortController>();
  active.set(alia, runs);
  runs.add(controller);
  try {
    generationId = store.beginGeneration(targetKey);
    threads = alia.sdk.threads;
    const worker = await threads.spawn({
      projectId,
      environment: { type: "project-default" },
      prompt: buildGenerationPrompt(targetKey, generationId, store.getPreferences().preferences),
      title: `Generate guide: ${targetKey}`,
      visibility: "hidden",
    });
    workerId = worker.id;
    await threads.wait({ threadId: worker.id, status: "idle", timeoutMs: 600_000, signal: controller.signal });
  } catch {
    // spawn/wait failed — fall through and finalize as error below
  } finally {
    if (workerId && threads) {
      try { await threads.archive({ threadId: workerId }); } catch { /* best effort */ }
      try { await threads.stop({ threadId: workerId }); } catch { /* best effort */ }
    }
  }
  try {
    if (!generationId || !store.isCurrentGeneration(targetKey, generationId)) return;
    const ok = !controller.signal.aborted && store.getGuide(targetKey) !== null;
    store.setStatus(targetKey, ok ? "ready" : "error");
    alia.realtime.publish(`review:${targetKey}`, { status: ok ? "ready" : "error" });
    alia.realtime.publish("reviews", { ts: Date.now() });
    if (!controller.signal.aborted) await completionNotifications(alia, store).queue({
      targetKey, generationId, projectId, status: ok ? "ready" : "error",
    });
  } catch {
    // A plugin reload can dispose storage/realtime while a worker is finishing.
    // The next factory marks interrupted runs as errors without reusing a guide.
  } finally {
    runs.delete(controller);
  }
}
