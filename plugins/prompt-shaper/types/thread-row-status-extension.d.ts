import type { PluginComposerThreadRowStatus } from "@vesnalia/plugin-sdk/app";

declare module "@vesnalia/plugin-sdk/app" {
  interface PluginContentScriptContext {
    /**
     * Persistently decorate any thread row for this plugin generation.
     *
     * Optional so the plugin can feature-detect the companion experimental
     * host API while remaining load-safe on older VesnALIA 0.34 clients.
     */
    readonly experimental_setThreadRowStatus?: (
      threadId: string,
      status: PluginComposerThreadRowStatus | null,
    ) => void;
  }
}
