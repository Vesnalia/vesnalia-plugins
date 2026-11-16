import { defineRpcContract } from "@vesnalia/plugin-sdk";
import { z } from "zod";

const lines = z.object({ added: z.number().nullable(), removed: z.number().nullable() }).nullable();
const file = z.object({ path: z.string(), index: z.string(), worktree: z.string(), stagedLines: lines, worktreeLines: lines });
const remote = z.object({ ahead: z.number(), behind: z.number(), upstream: z.string().nullable() });
const lastCommit = z.object({ sha: z.string(), subject: z.string() }).nullable();
const cwdOnly = z.object({ cwd: z.string() }).strict();
const message = z.object({ message: z.string() });

export const hostContract = defineRpcContract({
  status: { input: z.object({ cwd: z.string() }).strict(), output: z.object({ branch: z.string().nullable(), branches: z.array(z.object({ name: z.string(), scope: z.enum(["local", "remote"]), sha: z.string(), subject: z.string() })), files: z.array(file), remote, stashCount: z.number(), lastCommit }) },
  stage: { input: z.object({ cwd: z.string(), paths: z.array(z.string()).max(200) }).strict(), output: z.object({ ok: z.literal(true) }) },
  unstage: { input: z.object({ cwd: z.string(), paths: z.array(z.string()).max(200) }).strict(), output: z.object({ ok: z.literal(true) }) },
  switchBranch: { input: z.object({ cwd: z.string(), branch: z.string().min(1) }).strict(), output: z.object({ ok: z.literal(true) }) },
  createBranch: { input: z.object({ cwd: z.string(), branch: z.string().min(1) }).strict(), output: z.object({ ok: z.literal(true) }) },
  renameBranch: { input: z.object({ cwd: z.string(), branch: z.string().min(1), name: z.string().min(1) }).strict(), output: z.object({ ok: z.literal(true) }) },
  pull: { input: z.object({ cwd: z.string() }).strict(), output: z.object({ message: z.string() }) },
  push: { input: z.object({ cwd: z.string() }).strict(), output: z.object({ message: z.string() }) },
  fetch: { input: cwdOnly, output: message },
  sync: { input: cwdOnly, output: message },
  undoCommit: { input: cwdOnly, output: message },
  stash: { input: cwdOnly, output: message },
  stashPop: { input: cwdOnly, output: message },
});
