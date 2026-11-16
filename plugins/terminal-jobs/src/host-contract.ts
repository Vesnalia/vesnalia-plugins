import { defineRpcContract } from "@vesnalia/plugin-sdk";
import { z } from "zod";

export const RUNNER_PROTOCOL_VERSION = 1;
export const RUNNER_ARGUMENT = "__terminal_job_runner__";

export const terminalJobHostContract = defineRpcContract({
  "runner.readiness": {
    input: z.null(),
    output: z
      .object({
        protocolVersion: z.number().int(),
        supported: z.boolean(),
        execPath: z.string(),
        artifactPath: z.string(),
        nodeVersion: z.string(),
        platform: z.string(),
      })
      .strict(),
  },
});

export type RunnerReadiness = {
  protocolVersion: number;
  supported: boolean;
  execPath: string;
  artifactPath: string;
  nodeVersion: string;
  platform: string;
};
