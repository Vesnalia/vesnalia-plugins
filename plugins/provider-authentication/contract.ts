import { defineRpcContract } from "@vesnalia/plugin-sdk";
import { z } from "zod";

export const providerIdSchema = z.literal("claude-code");

export const providerStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cli-missing") }).strict(),
  z.object({ kind: z.literal("signed-out") }).strict(),
  z
    .object({
      kind: z.literal("signed-in"),
      identity: z.string().nullable(),
      organization: z.string().nullable(),
      subscription: z.string().nullable(),
    })
    .strict(),
  z
    .object({ kind: z.literal("unavailable"), message: z.string() })
    .strict(),
]);

export const attemptStateSchema = z.enum([
  "starting",
  "awaiting-code",
  "submitting",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
]);

export const authAttemptSchema = z
  .object({
    id: z.string(),
    providerId: providerIdSchema,
    state: attemptStateSchema,
    consentUrl: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict();

export const machineSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["connected", "disconnected"]),
  })
  .strict();

export const overviewSchema = z
  .object({
    status: providerStatusSchema,
    attempt: authAttemptSchema.nullable(),
  })
  .strict();

export const hostSignals = {
  attemptChanged: {
    payload: z
      .object({ attemptId: z.string(), state: attemptStateSchema })
      .strict(),
  },
};

export const hostContract = defineRpcContract({
  inspect: {
    input: z.null(),
    output: providerStatusSchema,
  },
  getAttempt: {
    input: z.null(),
    output: authAttemptSchema.nullable(),
  },
  begin: {
    input: z.object({ attemptId: z.string().min(1) }).strict(),
    output: authAttemptSchema,
  },
  submitCode: {
    input: z
      .object({ attemptId: z.string().min(1), code: z.string().min(1).max(4096) })
      .strict(),
    output: authAttemptSchema,
  },
  cancel: {
    input: z.object({ attemptId: z.string().min(1) }).strict(),
    output: authAttemptSchema,
  },
});

export const rpcContract = defineRpcContract({
  listMachines: {
    input: z.null(),
    output: z.object({ machines: z.array(machineSchema) }).strict(),
  },
  getOverview: {
    input: z.object({ hostId: z.string().min(1) }).strict(),
    output: overviewSchema,
  },
  beginAuthentication: {
    input: z
      .object({ hostId: z.string().min(1), providerId: providerIdSchema })
      .strict(),
    output: authAttemptSchema,
  },
  submitAuthorizationCode: {
    input: z
      .object({
        hostId: z.string().min(1),
        providerId: providerIdSchema,
        attemptId: z.string().min(1),
        code: z.string().min(1).max(4096),
      })
      .strict(),
    output: authAttemptSchema,
  },
  cancelAuthentication: {
    input: z
      .object({
        hostId: z.string().min(1),
        providerId: providerIdSchema,
        attemptId: z.string().min(1),
      })
      .strict(),
    output: authAttemptSchema,
  },
});

export type ProviderId = z.infer<typeof providerIdSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type AttemptState = z.infer<typeof attemptStateSchema>;
export type AuthAttempt = z.infer<typeof authAttemptSchema>;
export type Machine = z.infer<typeof machineSchema>;
export type Overview = z.infer<typeof overviewSchema>;
