import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { hostContract, rpcContract } from "../shared/contracts";
import { settingDescriptors } from "../shared/settings";

export default function plugin(alia: AliaPluginApi) {
  alia.settings.define(settingDescriptors);
  const lifecycle = new AbortController();
  alia.onDispose(() => lifecycle.abort());
  const host = alia.hosts.experimental_client({ contract: hostContract });
  async function workspace(environmentId: string) {
    const environment = await alia.sdk.environments.get({ environmentId, signal: lifecycle.signal });
    if (!environment.path || !environment.isGitRepo) throw new Error("This environment has no Git workspace.");
    return { path: environment.path, hostId: environment.hostId };
  }
  alia.rpc.register(rpcContract, {
    imageDiff: async ({ environmentId, ...input }) => {
      const target = await workspace(environmentId);
      return host.call("imageDiff", { workspace: target.path, ...input }, { hostId: target.hostId, signal: lifecycle.signal });
    },
    imageFile: async ({ environmentId, path }) => {
      const target = await workspace(environmentId);
      return host.call("imageFile", { workspace: target.path, path }, { hostId: target.hostId, signal: lifecycle.signal });
    },
    history: async ({ environmentId }) => {
      const target = await workspace(environmentId);
      return host.call("history", { workspace: target.path }, { hostId: target.hostId, signal: lifecycle.signal });
    },
    committedChanges: async ({ environmentId, selection }) => {
      const target = await workspace(environmentId);
      return host.call("changes", { workspace: target.path, selection }, { hostId: target.hostId, signal: lifecycle.signal });
    },
    committedPatch: async ({ environmentId, ...input }) => {
      const target = await workspace(environmentId);
      return host.call("patch", { workspace: target.path, ...input }, { hostId: target.hostId, signal: lifecycle.signal });
    },
    committedContents: async ({ environmentId, ...input }) => {
      const target = await workspace(environmentId);
      return host.call("contents", { workspace: target.path, ...input }, { hostId: target.hostId, signal: lifecycle.signal });
    },
  });
}
