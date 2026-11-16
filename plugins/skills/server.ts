// skills — the server entry.
//
// Resolves a thread to its provider and environment, asks the host entry on
// the environment's machine to scan that provider's skill directories, adds the
// skills VesnALIA itself injects into every thread, and the list VesnALIA's provider
// reports. Holds no state. See AGENTS.md.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";

import { rpcContract } from "./shared/contract";
import { hostContract } from "./shared/host-contract";
import { listSkills, readSkill, workspaceFrom, type SkillsPorts, type ThreadWorkspace } from "./server/skills";

export type { RpcContract } from "./shared/contract";

export default async function plugin(alia: AliaPluginApi) {
  const host = alia.hosts.experimental_client({ contract: hostContract });

  const ports: SkillsPorts = {
    async workspaceOf(threadId) {
      const thread = await alia.sdk.threads.get({ threadId });
      const environment =
        thread.environmentId === null ? null : await alia.sdk.environments.get({ environmentId: thread.environmentId });
      return workspaceFrom(thread, environment);
    },
    discover: (workspace) =>
      host.call("discover", { provider: workspace.provider, cwd: workspace.cwd }, { hostId: workspace.hostId }),
    readDiscovered: (workspace, skillId) =>
      host.call("read", { provider: workspace.provider, cwd: workspace.cwd, skillId }, { hostId: workspace.hostId }),
    async aliaSkills(workspace) {
      const { skills } = await alia.sdk.skills.list(scopeOf(workspace));
      return skills;
    },
    async aliaSkillContent(workspace, skillId) {
      const { content } = await alia.sdk.skills.getContent({ ...scopeOf(workspace), skillId, path: "SKILL.md" });
      return content;
    },
    async commands(workspace) {
      const { commands } = await alia.sdk.projects.commands({
        projectId: workspace.projectId,
        environmentId: workspace.environmentId,
        provider: workspace.provider,
      });
      return commands;
    },
  };

  alia.rpc.register(rpcContract, {
    list: ({ threadId }) => listSkills(ports, threadId),
    read: ({ threadId, skillId }) => readSkill(ports, threadId, skillId),
  });
}

function scopeOf(workspace: ThreadWorkspace) {
  return { projectId: workspace.projectId, environmentId: workspace.environmentId };
}
