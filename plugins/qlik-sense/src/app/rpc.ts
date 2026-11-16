import type { useRpc } from "@vesnalia/plugin-sdk/app";
import type { rpcContract } from "../../server";

export type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
