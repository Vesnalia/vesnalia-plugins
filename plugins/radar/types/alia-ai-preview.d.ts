// Local preview generated from VesnALIA source backend-contract.ts; remove when the installed SDK includes experimental_ai.
import "@vesnalia/plugin-sdk";

declare module "@vesnalia/plugin-sdk" {
export interface ExperimentalPluginAiCompleteInput {
  prompt: string;
  system?: string;
  providerId?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ExperimentalPluginAiCompleteResult {
  text: string;
  providerId: string;
  model: string;
}

export interface ExperimentalPluginAi {
  complete(
    input: ExperimentalPluginAiCompleteInput,
  ): Promise<ExperimentalPluginAiCompleteResult>;
}

interface AliaPluginApi {
  readonly experimental_ai: ExperimentalPluginAi;
}
}
