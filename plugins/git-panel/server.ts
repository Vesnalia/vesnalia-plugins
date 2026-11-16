import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract.js";

const lines = z.object({ added: z.number().nullable(), removed: z.number().nullable() }).nullable();
const file = z.object({ path: z.string(), index: z.string(), worktree: z.string(), stagedLines: lines, worktreeLines: lines });
const state = z.object({ branch: z.string().nullable(), branches: z.array(z.object({ name: z.string(), scope: z.enum(["local", "remote"]), sha: z.string(), subject: z.string() })), hostId: z.string(), projectId: z.string(), files: z.array(file), remote: z.object({ ahead: z.number(), behind: z.number(), upstream: z.string().nullable() }), stashCount: z.number(), lastCommit: z.object({ sha: z.string(), subject: z.string() }).nullable() });

export const rpcContract = defineRpcContract({
  status: { input: z.object({ threadId: z.string() }).strict(), output: state },
  stage: { input: z.object({ threadId: z.string(), paths: z.array(z.string()).max(200) }).strict(), output: state },
  unstage: { input: z.object({ threadId: z.string(), paths: z.array(z.string()).max(200) }).strict(), output: state },
  commit: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ commitSubject: z.string() }) },
  switchBranch: { input: z.object({ threadId: z.string(), branch: z.string().min(1) }).strict(), output: state },
  createBranch: { input: z.object({ threadId: z.string(), branch: z.string().min(1) }).strict(), output: state },
  renameBranch: { input: z.object({ threadId: z.string(), branch: z.string().min(1), name: z.string().min(1) }).strict(), output: state },
  pull: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ syncMessage: z.string() }) },
  push: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ syncMessage: z.string() }) },
  fetch: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ syncMessage: z.string() }) },
  sync: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ syncMessage: z.string() }) },
  undoCommit: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ syncMessage: z.string() }) },
  stash: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ syncMessage: z.string() }) },
  stashPop: { input: z.object({ threadId: z.string() }).strict(), output: state.extend({ syncMessage: z.string() }) },
});

export default async function plugin(alia: AliaPluginApi) {
  const host = alia.hosts.experimental_client({ contract: hostContract });
  async function workspace(threadId: string) {
    const thread = await alia.sdk.threads.get({ threadId });
    if (!thread.environmentId) throw new Error("This thread has no workspace.");
    const environment = await alia.sdk.environments.get({ environmentId: thread.environmentId });
    if (!environment.isGitRepo || !environment.path) throw new Error("This workspace is not a Git repository.");
    return { environmentId: environment.id, hostId: environment.hostId, cwd: environment.path };
  }
  async function status(threadId: string) {
    const place = await workspace(threadId);
    const gitStatus = await host.call("status", { cwd: place.cwd }, { hostId: place.hostId });
    return { ...gitStatus, hostId: place.hostId, projectId: (await alia.sdk.environments.get({ environmentId: place.environmentId })).projectId };
  }
  alia.rpc.register(rpcContract, {
    status: ({ threadId }) => status(threadId),
    async stage({ threadId, paths }) { const place = await workspace(threadId); await host.call("stage", { cwd: place.cwd, paths }, { hostId: place.hostId }); return status(threadId); },
    async unstage({ threadId, paths }) { const place = await workspace(threadId); await host.call("unstage", { cwd: place.cwd, paths }, { hostId: place.hostId }); return status(threadId); },
    async commit({ threadId }) {
      const place = await workspace(threadId);
      const committed = await alia.sdk.environments.commit({ environmentId: place.environmentId });
      return { ...(await status(threadId)), commitSubject: committed.commitSubject };
    },
    async switchBranch({ threadId, branch }) { const place = await workspace(threadId); await host.call("switchBranch", { cwd: place.cwd, branch }, { hostId: place.hostId }); return status(threadId); },
    async createBranch({ threadId, branch }) { const place = await workspace(threadId); await host.call("createBranch", { cwd: place.cwd, branch }, { hostId: place.hostId }); return status(threadId); },
    async renameBranch({ threadId, branch, name }) { const place = await workspace(threadId); await host.call("renameBranch", { cwd: place.cwd, branch, name }, { hostId: place.hostId }); return status(threadId); },
    async pull({ threadId }) { const place = await workspace(threadId); const result = await host.call("pull", { cwd: place.cwd }, { hostId: place.hostId }); return { ...(await status(threadId)), syncMessage: result.message }; },
    async push({ threadId }) { const place = await workspace(threadId); const result = await host.call("push", { cwd: place.cwd }, { hostId: place.hostId }); return { ...(await status(threadId)), syncMessage: result.message }; },
    async fetch({ threadId }) { const place = await workspace(threadId); const result = await host.call("fetch", { cwd: place.cwd }, { hostId: place.hostId }); return { ...(await status(threadId)), syncMessage: result.message }; },
    async sync({ threadId }) { const place = await workspace(threadId); const result = await host.call("sync", { cwd: place.cwd }, { hostId: place.hostId }); return { ...(await status(threadId)), syncMessage: result.message }; },
    async undoCommit({ threadId }) { const place = await workspace(threadId); const result = await host.call("undoCommit", { cwd: place.cwd }, { hostId: place.hostId }); return { ...(await status(threadId)), syncMessage: result.message }; },
    async stash({ threadId }) { const place = await workspace(threadId); const result = await host.call("stash", { cwd: place.cwd }, { hostId: place.hostId }); return { ...(await status(threadId)), syncMessage: result.message }; },
    async stashPop({ threadId }) { const place = await workspace(threadId); const result = await host.call("stashPop", { cwd: place.cwd }, { hostId: place.hostId }); return { ...(await status(threadId)), syncMessage: result.message }; },
  });
  alia.log.info("loaded");
}
