import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { configSchema, configPatchSchema, DEFAULT_CONFIG, readStoredConfig, shaderSchema, shaderLibrarySchema } from "./config";
export type { GlassConfig } from "./config";

const CONFIG_KEY = "config";
export const rpcContract = defineRpcContract({
  getConfig: { input: z.null(), output: configSchema },
  setConfig: { input: configPatchSchema, output: configSchema },
  resetConfig: { input: z.null(), output: configSchema },
  saveShader: { input: z.object({ shader: shaderSchema, activate: z.boolean() }).strict(), output: configSchema },
  deleteShader: { input: z.object({ id: z.string().max(64) }).strict(), output: configSchema },
});

export default async function plugin(alia: AliaPluginApi) {
  // Serialize read/modify/write operations across all windows. A rejected
  // storage operation must not poison the queue or publish an unsaved state.
  let writes: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }
  const read = async () => readStoredConfig(await alia.storage.kv.get(CONFIG_KEY));
  alia.rpc.register(rpcContract, {
    getConfig: async () => { await writes; return read(); },
    setConfig: (patch) => enqueue(async () => {
      const stored = await alia.storage.kv.get<Record<string, unknown>>(CONFIG_KEY);
      const record = { ...stored, ...patch };
      const next = readStoredConfig(record);
      if (patch.style === "custom" && !next.customShaders.some((shader) => shader.id === record.activeShaderId)) throw new Error("Choose a saved shader first.");
      // Update only requested keys; retain unknown and legacy stored values.
      await alia.storage.kv.set(CONFIG_KEY, record);
      alia.realtime.publish("glass", {});
      return next;
    }),
    resetConfig: () => enqueue(async () => {
      const { customShaders } = await read();
      if (customShaders.length) await alia.storage.kv.set(CONFIG_KEY, { customShaders });
      else await alia.storage.kv.delete(CONFIG_KEY);
      alia.realtime.publish("glass", {});
      return { ...DEFAULT_CONFIG, customShaders };
    }),
    saveShader: ({ shader, activate }) => enqueue(async () => {
      const stored = await alia.storage.kv.get<Record<string, unknown>>(CONFIG_KEY);
      const current = readStoredConfig(stored);
      const customShaders = shaderLibrarySchema.parse([...current.customShaders.filter((item) => item.id !== shader.id), shader]);
      const record = { ...stored, customShaders, ...(activate ? { style: "custom", activeShaderId: shader.id } : {}) };
      await alia.storage.kv.set(CONFIG_KEY, record);
      alia.realtime.publish("glass", {});
      return readStoredConfig(record);
    }),
    deleteShader: ({ id }) => enqueue(async () => {
      const stored = await alia.storage.kv.get<Record<string, unknown>>(CONFIG_KEY);
      const current = readStoredConfig(stored);
      const record = { ...stored, customShaders: current.customShaders.filter((item) => item.id !== id),
        ...(current.activeShaderId === id ? { activeShaderId: "", ...(current.style === "custom" ? { style: "flow" } : {}) } : {}) };
      await alia.storage.kv.set(CONFIG_KEY, record);
      alia.realtime.publish("glass", {});
      return readStoredConfig(record);
    }),
  });
}
