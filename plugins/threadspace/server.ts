import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { defaultAppearance, type ProjectAppearance } from "./src/preferences";
import { appearanceSchema, appearancePatchSchema } from "./src/appearanceSchema";
import { createTitleRegenerator, titleRegenerationResultSchema } from "./src/titleGeneration";

const projectId = z.string().min(1).max(200);
export const rpcContract = defineRpcContract({
  appearance_get: {
    input: z.object({ projectIds: z.array(projectId).max(2000) }).strict(),
    output: z.record(z.string(), appearanceSchema),
  },
  appearance_set: {
    input: z.object({ projectId, patch: appearancePatchSchema }).strict(),
    output: appearanceSchema,
  },
  project_order_get: {
    input: z.object({}).strict(),
    output: z.array(projectId).max(2000),
  },
  project_order_set: {
    input: z.object({ projectIds: z.array(projectId).max(2000) }).strict(),
    output: z.array(projectId).max(2000),
  },
  sidebar_hover_mode_toggle: {
    input: z.object({}).strict(),
    output: z.object({ enabled: z.boolean() }),
  },
  title_regenerate: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: titleRegenerationResultSchema,
  },
});

export default function plugin(alia: AliaPluginApi) {
  // Read the late-bound SDK in the RPC handler, after the server is listening.
  let titles: ReturnType<typeof createTitleRegenerator> | undefined;
  alia.onDispose(() => titles?.dispose());
  // Serialize read/merge/write so edits from two windows cannot erase each other.
  let writes: Promise<unknown> = Promise.resolve();
  async function read(id: string): Promise<ProjectAppearance> {
    const saved = appearanceSchema.safeParse(await alia.storage.kv.get(`project:${id}`));
    return saved.success ? saved.data : { ...defaultAppearance };
  }
  const sidebarSettings = alia.settings.define({
    sidebarHoverMode: {
      type: "boolean",
      label: "Hide sidebar, show on hover",
      description: "Keeps the left sidebar collapsed and slides it in when the pointer reaches the left edge. Toggle with ⌘⇧S.",
      default: false,
    },
    sidebarHoverSpeed: {
      type: "select",
      label: "Sidebar opening speed",
      description: "How quickly the hidden sidebar slides in.",
      options: ["instant", "fast", "normal", "slow"],
      experimental_optionLabels: { instant: "Instant", fast: "Fast", normal: "Normal", slow: "Slow" },
      default: "fast",
    },
  });
  alia.rpc.register(rpcContract, {
    sidebar_hover_mode_toggle: async () => {
      const { sidebarHoverMode } = await sidebarSettings.get();
      const next = await sidebarSettings.experimental_set({ sidebarHoverMode: !sidebarHoverMode });
      return { enabled: next.sidebarHoverMode };
    },
    title_regenerate: ({ threadId }) => {
      titles ??= createTitleRegenerator(alia.sdk);
      return titles.regenerate(threadId);
    },
    project_order_get: async () => {
      await writes;
      const saved = z.array(projectId).max(2000).safeParse(await alia.storage.kv.get("project-order"));
      return saved.success ? saved.data : [];
    },
    project_order_set: ({ projectIds }) => {
      const next = writes.then(async () => {
        const unique = [...new Set(projectIds)];
        await alia.storage.kv.set("project-order", unique);
        alia.realtime.publish("project-order-changed", {});
        return unique;
      });
      writes = next.catch(() => {});
      return next;
    },
    appearance_get: async ({ projectIds }) => {
      await writes;
      return Object.fromEntries(await Promise.all([...new Set(projectIds)].map(async id => [id, await read(id)])));
    },
    appearance_set: ({ projectId: id, patch }) => {
      const next = writes.then(async () => {
        const value = appearanceSchema.parse({ ...await read(id), ...patch });
        await alia.storage.kv.set(`project:${id}`, value);
        alia.realtime.publish("appearance-changed", { projectId: id });
        return value;
      });
      writes = next.catch(() => {});
      return next;
    },
  });
}
