import { defineRpcContract } from "@vesnalia/plugin-sdk";
import { z } from "zod";

const captureId = z.uuid();
const localBridgeSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1),
  identity: z.string().min(1),
});
export type LocalBridge = z.infer<typeof localBridgeSchema> & {
  hostId: string;
};
export const hostContract = defineRpcContract({
  localBridge: {
    input: z.null(),
    output: localBridgeSchema.nullable(),
  },
  capture: {
    input: z.object({ captureId }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("cancelled") }),
      z.object({
        status: z.literal("captured"),
        path: z.string(),
        sizeBytes: z.number().int().positive(),
      }),
    ]),
  },
  release: { input: z.object({ captureId }).strict(), output: z.null() },
});
export const rpcContract = defineRpcContract({
  localBridges: {
    input: z.null(),
    output: z.array(localBridgeSchema.extend({ hostId: z.string().min(1) })),
  },
  capture: {
    input: z
      .object({
        captureId,
        hostId: z.string().min(1),
        projectId: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("cancelled") }),
      z.object({
        status: z.literal("captured"),
        path: z.string(),
        name: z.string(),
        sizeBytes: z.number().int().positive(),
      }),
    ]),
  },
  cancel: { input: z.object({ captureId }).strict(), output: z.null() },
});
