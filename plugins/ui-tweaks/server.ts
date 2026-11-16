import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import {
  PREFERENCES_KV_KEY,
  preferencesRpcContract,
} from "./lib/preferences-rpc.js";

export default function plugin(alia: AliaPluginApi) {
  alia.rpc.register(preferencesRpcContract, {
    async getPreferences() {
      const stored = await alia.storage.kv.get<Record<string, unknown>>(
        PREFERENCES_KV_KEY,
      );
      return { preferences: stored ?? null };
    },
    async setPreferences({ preferences }) {
      await alia.storage.kv.set(PREFERENCES_KV_KEY, preferences);
      return { ok: true as const };
    },
  });
  alia.log.info("loaded");
}
