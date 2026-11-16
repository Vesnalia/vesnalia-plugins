import type { defineRpcContract } from "@vesnalia/plugin-sdk";

export const defineContract: typeof defineRpcContract = ((contract: unknown) => contract) as typeof defineRpcContract;
