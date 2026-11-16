// Which model runs PR X-ray's agents. Nothing is selected by default: the spawn
// then carries no model, so VesnALIA applies the user's own defaults.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { modelSelectionSchema, type ModelPurpose, type ModelSelection } from "../shared/schema";

const STORAGE_KEYS: Record<ModelPurpose, string> = {
  analysis: "modelSelection",
  tagging: "taggingModelSelection",
};

export function createModels(alia: AliaPluginApi) {
  async function selected(purpose: ModelPurpose): Promise<ModelSelection | null> {
    const parsed = modelSelectionSchema.safeParse(await alia.storage.kv.get(STORAGE_KEYS[purpose]));
    return parsed.success ? parsed.data : null;
  }

  async function select(purpose: ModelPurpose, selection: ModelSelection | null) {
    if (selection === null) await alia.storage.kv.delete(STORAGE_KEYS[purpose]);
    else await alia.storage.kv.set(STORAGE_KEYS[purpose], selection);
  }

  /** A valid starting value for the model picker, for when the user first overrides VesnALIA's default. */
  async function pickerSeed(): Promise<ModelSelection | null> {
    const providers = await alia.sdk.providers.list();
    for (const provider of providers) {
      // One logged-out provider shouldn't hide the picker from the others.
      const models = await alia.sdk.providers.models({ providerId: provider.id }).then(
        (result) => result.models,
        () => [],
      );
      const model = models.find((candidate) => candidate.isDefault) ?? models[0];
      if (model !== undefined) {
        return { providerId: provider.id, model: model.model, reasoningLevel: model.defaultReasoningEffort };
      }
    }
    return null;
  }

  return { selected, select, pickerSeed };
}

export type Models = ReturnType<typeof createModels>;

export function spawnModelArgs(selection: ModelSelection | null) {
  if (selection === null) return {};
  return {
    providerId: selection.providerId,
    model: selection.model,
    reasoningLevel: selection.reasoningLevel,
    ...(selection.serviceTier ? { serviceTier: selection.serviceTier } : {}),
  };
}
