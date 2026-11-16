import type { defineRpcContract } from "@vesnalia/plugin-sdk";

// The SDK's defineRpcContract only returns its argument. The UI bundle cannot import the SDK's root
// entry in a git install, which leaves dev dependencies out, so the same identity lives here.
export const defineContract: typeof defineRpcContract = ((contract: unknown) => contract) as typeof defineRpcContract;
