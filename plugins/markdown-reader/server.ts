import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import {
  createSourceReader,
  readResultSchema,
  targetSchema,
  destinationsInputSchema,
  destinationsResultSchema,
} from "./source";
import { hostContract } from "./host-contract";

export const rpcContract = defineRpcContract({
  read_document: { input: targetSchema, output: readResultSchema },
  resolve_destinations: { input: destinationsInputSchema, output: destinationsResultSchema },
});

export default function plugin(alia: AliaPluginApi) {
  const host = alia.hosts.experimental_client({ contract: hostContract });
  const reader = createSourceReader({
    environment: (environmentId) => alia.sdk.environments.get({ environmentId }),
    project: (projectId) => alia.sdk.projects.get({ projectId }),
    thread: (threadId) => alia.sdk.threads.get({ threadId }),
    storageLocation: (threadId) => alia.sdk.threads.storageLocation({ threadId }),
    resolveHostRoot: async ({ hostId, rootPath }) =>
      (await host.call("resolve_root", { rootPath }, { hostId })).rootPath,
    read: (target) => alia.sdk.files.read(target),
    createPreview: (target) => alia.sdk.files.createPreview(target),
  });
  alia.rpc.register(rpcContract, {
    read_document: (target) => reader.read(target),
    resolve_destinations: (input) => reader.destinations(input),
  });
}
