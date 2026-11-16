import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { ponytailModes, type PonytailMode } from "./lib/modes.ts";
import { isPonytailSkill } from "./lib/ponytail-skill.ts";

const modeSchema = z.enum(ponytailModes);

export const rpcContract = defineRpcContract({
  get_mode: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ mode: modeSchema, available: z.boolean() }).strict(),
  },
  set_mode: {
    input: z.object({ threadId: z.string().min(1), mode: modeSchema }).strict(),
    output: z.object({ mode: modeSchema }).strict(),
  },
});

export default function plugin(alia: AliaPluginApi) {
  const key = (threadId: string) => `mode:${threadId}`;
  const hasPonytail = async (threadId: string) => {
    const thread = await alia.sdk.threads.get({ threadId });
    const { skills } = await alia.sdk.skills.list({
      projectId: thread.projectId,
      environmentId: thread.environmentId,
    });
    return skills.some(isPonytailSkill);
  };

  alia.rpc.register(rpcContract, {
    get_mode: async ({ threadId }) => ({
      mode: (await alia.storage.kv.get<PonytailMode>(key(threadId))) ?? "full",
      available: await hasPonytail(threadId),
    }),
    set_mode: async ({ threadId, mode }) => {
      if (!(await hasPonytail(threadId))) {
        throw new Error("Ponytail is required. Install and enable Ponytail before using Mane Control.");
      }
      await alia.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text: `/ponytail ${mode}`, mentions: [] }],
      });
      await alia.storage.kv.set(key(threadId), mode);
      alia.realtime.publish("mode-changed", { threadId, mode });
      return { mode };
    },
  });
}
